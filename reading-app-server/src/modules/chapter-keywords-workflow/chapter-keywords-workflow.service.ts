import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { SentenceRef } from '../../../../packages/contracts/src';
import { BookIngestionRepository } from '../book-ingestion/book-ingestion.repository';
import { WorkflowQueueService } from '../workflow-queue/workflow-queue.service';
import { workflowLog } from '../workflow.logger';
import {
  analyzeChapterKeywordsChunk,
  type ChapterKeywordSentenceInput,
} from './chapter-keywords-llm';
import type {
  GetChapterKeywordsWorkflowResultResponseDto,
  GetChapterKeywordsWorkflowStatusResponseDto,
  GetLatestChapterKeywordsResponseDto,
  SubmitChapterKeywordsWorkflowRequestDto,
  SubmitChapterKeywordsWorkflowResponseDto,
} from './chapter-keywords-workflow.dto';
import { ChapterKeywordsWorkflowRepository } from './chapter-keywords-workflow.repository';
import type {
  ChapterKeywordsWorkflowRunRecord,
  ChapterKeywordsWorkflowStoredResult,
  SubmitChapterKeywordsWorkflowInput,
} from './chapter-keywords-workflow.types';

const WORKFLOW_VERSION = 'v1';
const TARGET_CHUNK_CHARACTERS = 2400;
const MAX_PARAGRAPHS_PER_CHUNK = 6;
const OVERLAP_PARAGRAPHS = 1;

type ParagraphSentenceGroup = {
  pageIndex: number;
  paragraphIndex: number;
  paragraphId: number;
  paragraphText: string;
  sentences: ChapterKeywordSentenceInput[];
};

type PlannedChunk = {
  id: string;
  index: number;
  total: number;
  chunkText: string;
  sentences: ChapterKeywordSentenceInput[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const refKey = (ref: SentenceRef): string =>
  `${ref.page_index}:${ref.paragraph_index}:${ref.paragraph_id}:${ref.sentence_id}`;

const paragraphKey = (ref: SentenceRef): string =>
  `${ref.page_index}:${ref.paragraph_index}:${ref.paragraph_id}`;

const compareSentenceRefs = (left: SentenceRef, right: SentenceRef): number => {
  if (left.page_index !== right.page_index) {
    return left.page_index - right.page_index;
  }
  if (left.paragraph_index !== right.paragraph_index) {
    return left.paragraph_index - right.paragraph_index;
  }
  if (left.paragraph_id !== right.paragraph_id) {
    return left.paragraph_id - right.paragraph_id;
  }
  return left.sentence_id - right.sentence_id;
};

const stableParagraphId = (raw: string, paragraphIndex: number): number => {
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && String(numeric) === raw.trim()) {
    return numeric;
  }
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  const bounded = Number.parseInt(hash, 16) % 1_000_000;
  return bounded === 0 ? paragraphIndex + 1 : bounded;
};

const splitSentences = (text: string): string[] => {
  const matches = text.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g);
  const sentences = (matches ?? [text])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return sentences.length ? sentences : [text.trim()].filter(Boolean);
};

const sortParagraphEntries = (pageParagraphs: Record<string, string>): Array<{ key: string; value: string }> =>
  Object.entries(pageParagraphs)
    .sort(([left], [right]) => {
      const leftNum = Number(left);
      const rightNum = Number(right);
      const leftNumeric = Number.isInteger(leftNum) && String(leftNum) === left.trim();
      const rightNumeric = Number.isInteger(rightNum) && String(rightNum) === right.trim();
      if (leftNumeric && rightNumeric) return leftNum - rightNum;
      if (leftNumeric) return -1;
      if (rightNumeric) return 1;
      return left.localeCompare(right);
    })
    .map(([key, value]) => ({ key, value }));

@Injectable()
export class ChapterKeywordsWorkflowService {
  constructor(
    @Inject(BookIngestionRepository)
    private readonly bookIngestionRepository: BookIngestionRepository,
    @Inject(ChapterKeywordsWorkflowRepository)
    private readonly chapterKeywordsWorkflowRepository: ChapterKeywordsWorkflowRepository,
    @Inject(WorkflowQueueService)
    private readonly workflowQueueService: WorkflowQueueService,
  ) {}

  parseSubmitRequest(rawBody: string | undefined): SubmitChapterKeywordsWorkflowRequestDto {
    if (!rawBody || rawBody.trim() === '') {
      workflowLog('request.parse_failed', {
        workflowKind: 'chapter_keywords',
        reason: 'empty_body',
      });
      throw new BadRequestException('Request body cannot be empty');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      workflowLog('request.parse_failed', {
        workflowKind: 'chapter_keywords',
        reason: 'invalid_json',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(parsed)) {
      workflowLog('request.parse_failed', {
        workflowKind: 'chapter_keywords',
        reason: 'non_object_body',
      });
      throw new BadRequestException('Request body must be a JSON object');
    }

    const request = {
      bookId: this.requireString(parsed.bookId, 'bookId'),
      chapterId: this.requireString(parsed.chapterId, 'chapterId'),
      chapterIndex: this.requireNonNegativeInteger(parsed.chapterIndex, 'chapterIndex'),
      workflowVersion: parsed.workflowVersion === undefined
        ? WORKFLOW_VERSION
        : this.requireString(parsed.workflowVersion, 'workflowVersion'),
      idempotencyKey: parsed.idempotencyKey === undefined
        ? undefined
        : this.requireString(parsed.idempotencyKey, 'idempotencyKey'),
      expectedSnapshotVersion: parsed.expectedSnapshotVersion === undefined
        ? undefined
        : this.requireNonNegativeInteger(parsed.expectedSnapshotVersion, 'expectedSnapshotVersion'),
      expectedChapterContentHash: parsed.expectedChapterContentHash === undefined
        ? undefined
        : this.requireString(parsed.expectedChapterContentHash, 'expectedChapterContentHash'),
      requestedByUserId: parsed.requestedByUserId === undefined
        ? undefined
        : this.requireString(parsed.requestedByUserId, 'requestedByUserId'),
    };

    workflowLog('request.parsed', {
      workflowKind: 'chapter_keywords',
      bookId: request.bookId,
      chapterId: request.chapterId,
      chapterIndex: request.chapterIndex,
      workflowVersion: request.workflowVersion,
      hasIdempotencyKey: request.idempotencyKey !== undefined,
      expectedSnapshotVersion: request.expectedSnapshotVersion,
      expectedChapterContentHash: request.expectedChapterContentHash,
      requestedByUserId: request.requestedByUserId,
    });

    return request;
  }

  submitChapterKeywordsWorkflow(
    request: SubmitChapterKeywordsWorkflowRequestDto,
  ): SubmitChapterKeywordsWorkflowResponseDto {
    const book = this.bookIngestionRepository.getBook(request.bookId);
    const chapter = this.bookIngestionRepository.getChapter(request.bookId, request.chapterId);

    if (!book || !chapter) {
      throw new NotFoundException('Chapter not found in canonical ingestion state');
    }
    if (chapter.chapterIndex !== request.chapterIndex) {
      throw new ConflictException('chapterIndex does not match canonical chapter state');
    }
    if (
      request.expectedSnapshotVersion !== undefined
      && request.expectedSnapshotVersion !== book.snapshotVersion
    ) {
      throw new ConflictException('expectedSnapshotVersion does not match canonical book state');
    }
    if (
      request.expectedChapterContentHash !== undefined
      && request.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      throw new ConflictException('expectedChapterContentHash does not match canonical chapter state');
    }
    if (chapter.chapterTextMaterialized.trim().length === 0) {
      throw new ConflictException(
        'Canonical chapter text is empty; ingest pages before submitting chapter keywords workflow',
      );
    }

    const input: SubmitChapterKeywordsWorkflowInput = {
      ...request,
      idempotencyKey: request.idempotencyKey ?? this.buildDefaultIdempotencyKey(
        request.bookId,
        request.chapterId,
        request.workflowVersion,
        chapter.chapterContentHash,
      ),
      expectedSnapshotVersion: request.expectedSnapshotVersion ?? book.snapshotVersion,
      expectedChapterContentHash: request.expectedChapterContentHash ?? chapter.chapterContentHash,
    };

    const { run, deduped } = this.chapterKeywordsWorkflowRepository.createOrReuseRun(input);
    if (!deduped) {
      this.workflowQueueService.enqueue(() => this.executeRun(run.id));
    }

    const canonicalRun = deduped
      ? this.chapterKeywordsWorkflowRepository.getRun(run.id) ?? run
      : run;
    workflowLog('run.submitted', {
      workflowKind: canonicalRun.kind,
      workflowRunId: canonicalRun.id,
      bookId: canonicalRun.bookId,
      chapterId: canonicalRun.chapterId,
      chapterIndex: canonicalRun.chapterIndex,
      workflowVersion: canonicalRun.workflowVersion,
      deduped,
      status: canonicalRun.status,
    });
    return this.toSubmitResponse(canonicalRun, deduped);
  }

  getWorkflowStatus(workflowRunId: string): GetChapterKeywordsWorkflowStatusResponseDto {
    const run = this.requireRun(workflowRunId);
    return this.toStatusResponse(run);
  }

  getWorkflowResult(workflowRunId: string): GetChapterKeywordsWorkflowResultResponseDto {
    const run = this.requireRun(workflowRunId);
    if (
      run.status !== 'completed'
      || !run.output
      || run.snapshotVersion === undefined
      || !run.chapterContentHash
    ) {
      throw new ConflictException('Chapter keywords workflow result is not available yet');
    }

    return {
      workflowRunId: run.id,
      kind: run.kind,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      resultVersion: run.resultVersion,
      producer: run.producer,
      qualityTier: run.qualityTier,
      snapshotVersion: run.snapshotVersion,
      chapterContentHash: run.chapterContentHash,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      result: run.output,
    };
  }

  getLatestChapterKeywords(bookId: string, chapterId: string): GetLatestChapterKeywordsResponseDto {
    const result = this.chapterKeywordsWorkflowRepository.getLatestResult(bookId, chapterId);
    if (!result) {
      throw new NotFoundException('No completed chapter keywords workflow result found for chapter');
    }
    return this.toLatestResponse(result);
  }

  private async executeRun(workflowRunId: string): Promise<void> {
    const runningRun = this.chapterKeywordsWorkflowRepository.markRunning(workflowRunId);
    if (!runningRun) return;

    const book = this.bookIngestionRepository.getBook(runningRun.bookId);
    const chapter = this.bookIngestionRepository.getChapter(runningRun.bookId, runningRun.chapterId);

    if (!book || !chapter) {
      this.chapterKeywordsWorkflowRepository.failRun(
        workflowRunId,
        'CHAPTER_KEYWORDS_CHAPTER_NOT_FOUND',
        'Canonical chapter state was not found during workflow execution.',
      );
      return;
    }
    if (
      runningRun.expectedSnapshotVersion !== undefined
      && runningRun.expectedSnapshotVersion !== book.snapshotVersion
    ) {
      this.chapterKeywordsWorkflowRepository.markStale(
        workflowRunId,
        'CHAPTER_KEYWORDS_CANONICAL_BOOK_STALE',
        'Canonical book snapshot changed before chapter keywords workflow execution completed.',
      );
      return;
    }
    if (
      runningRun.expectedChapterContentHash !== undefined
      && runningRun.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      this.chapterKeywordsWorkflowRepository.markStale(
        workflowRunId,
        'CHAPTER_KEYWORDS_CANONICAL_CHAPTER_STALE',
        'Canonical chapter content changed before chapter keywords workflow execution completed.',
      );
      return;
    }
    if (chapter.chapterTextMaterialized.trim().length === 0) {
      this.chapterKeywordsWorkflowRepository.failRun(
        workflowRunId,
        'CHAPTER_KEYWORDS_EMPTY_CHAPTER_TEXT',
        'Canonical chapter text is empty; unable to generate chapter keywords.',
      );
      return;
    }

    try {
      const chunks = this.planChunks(runningRun.bookId, runningRun.chapterId);
      if (!chunks.length) {
        this.chapterKeywordsWorkflowRepository.failRun(
          workflowRunId,
          'CHAPTER_KEYWORDS_NO_SENTENCES',
          'No text sentences were found in the canonical chapter state.',
        );
        return;
      }

      const mergedByParagraph = new Map<string, {
        ref: SentenceRef;
        text: string;
        importance: number;
        reason: string;
      }>();

      for (const chunk of chunks) {
        const result = await analyzeChapterKeywordsChunk({
          docId: runningRun.bookId,
          chapterId: runningRun.chapterId,
          chapterIndex: runningRun.chapterIndex,
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          totalChunks: chunk.total,
          chunkText: chunk.chunkText,
          sentences: chunk.sentences,
          contentHash: chapter.chapterContentHash,
        });

        for (const item of result.key_sentences) {
          const key = paragraphKey(item.sentence_ref);
          const existing = mergedByParagraph.get(key);
          if (
            !existing
            || item.importance > existing.importance
            || (
              item.importance === existing.importance
              && compareSentenceRefs(item.sentence_ref, existing.ref) < 0
            )
          ) {
            mergedByParagraph.set(key, {
              ref: item.sentence_ref,
              text: item.sentence_text,
              importance: item.importance,
              reason: item.reason,
            });
          }
        }
      }

      const mergedResult = {
        key_sentences: Array.from(mergedByParagraph.values())
          .sort((left, right) => {
            if (left.ref.page_index !== right.ref.page_index) {
              return left.ref.page_index - right.ref.page_index;
            }
            if (left.ref.paragraph_index !== right.ref.paragraph_index) {
              return left.ref.paragraph_index - right.ref.paragraph_index;
            }
            return left.ref.sentence_id - right.ref.sentence_id;
          })
          .map((item) => ({
            sentence_ref: item.ref,
            sentence_text: item.text,
            importance: item.importance,
            reason: item.reason,
          })),
        sentence_keywords: [],
      };

      this.chapterKeywordsWorkflowRepository.completeRun({
        workflowRunId,
        snapshotVersion: book.snapshotVersion,
        chapterContentHash: chapter.chapterContentHash,
        result: mergedResult,
      });
    } catch (error) {
      this.chapterKeywordsWorkflowRepository.failRun(
        workflowRunId,
        'CHAPTER_KEYWORDS_GENERATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private planChunks(bookId: string, chapterId: string): PlannedChunk[] {
    const chapter = this.bookIngestionRepository.getChapter(bookId, chapterId);
    if (!chapter) return [];

    const paragraphGroups: ParagraphSentenceGroup[] = [];
    const pages = Array.from(chapter.pages.entries()).sort(([left], [right]) => left - right);
    for (const [pageIndex, page] of pages) {
      const paragraphEntries = sortParagraphEntries(page.pageParagraphs);
      paragraphEntries.forEach((entry, paragraphIndex) => {
        const paragraphText = entry.value.trim();
        if (!paragraphText) return;
        const paragraphId = stableParagraphId(entry.key, paragraphIndex);
        const sentences = splitSentences(paragraphText)
          .map((sentenceText, sentenceIndex): ChapterKeywordSentenceInput => ({
            ref: {
              page_index: pageIndex,
              paragraph_index: paragraphIndex,
              paragraph_id: paragraphId,
              sentence_id: sentenceIndex,
            },
            text: sentenceText,
          }));
        if (!sentences.length) return;
        paragraphGroups.push({
          pageIndex,
          paragraphIndex,
          paragraphId,
          paragraphText,
          sentences,
        });
      });
    }

    if (!paragraphGroups.length) return [];

    const ranges: Array<{ start: number; end: number }> = [];
    let start = 0;
    while (start < paragraphGroups.length) {
      let end = start;
      let characterCount = 0;
      let paragraphCount = 0;

      while (end < paragraphGroups.length) {
        const separatorCount = paragraphCount === 0 ? 0 : 2;
        const proposedCharacters = characterCount
          + separatorCount
          + paragraphGroups[end].paragraphText.length;
        if (
          paragraphCount > 0
          && (
            paragraphCount >= MAX_PARAGRAPHS_PER_CHUNK
            || proposedCharacters > TARGET_CHUNK_CHARACTERS
          )
        ) {
          break;
        }
        characterCount = proposedCharacters;
        paragraphCount += 1;
        end += 1;
      }

      if (end === start) end += 1;
      ranges.push({ start, end });
      if (end >= paragraphGroups.length) break;
      start = Math.max(start + 1, end - OVERLAP_PARAGRAPHS);
    }

    const total = ranges.length;
    return ranges.map((range, index) => {
      const groups = paragraphGroups.slice(range.start, range.end);
      return {
        id: `chunk-${index + 1}`,
        index,
        total,
        chunkText: groups.map((group) => group.paragraphText).join('\n\n'),
        sentences: groups.flatMap((group) => group.sentences),
      };
    });
  }

  private buildDefaultIdempotencyKey(
    bookId: string,
    chapterId: string,
    workflowVersion: string,
    chapterContentHash: string,
  ): string {
    return `chapter-keywords:${workflowVersion}:${bookId}:${chapterId}:${chapterContentHash}`;
  }

  private requireRun(workflowRunId: string): ChapterKeywordsWorkflowRunRecord {
    const run = this.chapterKeywordsWorkflowRepository.getRun(workflowRunId);
    if (!run) {
      throw new NotFoundException('Chapter keywords workflow run not found');
    }
    return run;
  }

  private toSubmitResponse(
    run: ChapterKeywordsWorkflowRunRecord,
    deduped: boolean,
  ): SubmitChapterKeywordsWorkflowResponseDto {
    return {
      workflowRunId: run.id,
      kind: run.kind,
      status: run.status,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      producer: run.producer,
      qualityTier: run.qualityTier,
      resultVersion: run.resultVersion,
      snapshotVersion: run.snapshotVersion,
      chapterContentHash: run.chapterContentHash,
      deduped,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
      error: run.error,
    };
  }

  private toStatusResponse(run: ChapterKeywordsWorkflowRunRecord): GetChapterKeywordsWorkflowStatusResponseDto {
    return {
      workflowRunId: run.id,
      kind: run.kind,
      status: run.status,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      producer: run.producer,
      qualityTier: run.qualityTier,
      resultVersion: run.resultVersion,
      snapshotVersion: run.snapshotVersion,
      chapterContentHash: run.chapterContentHash,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      resultAvailable: Boolean(run.output),
      error: run.error,
    };
  }

  private toLatestResponse(result: ChapterKeywordsWorkflowStoredResult): GetLatestChapterKeywordsResponseDto {
    return {
      workflowRunId: result.workflowRunId,
      bookId: result.bookId,
      chapterId: result.chapterId,
      chapterIndex: result.chapterIndex,
      workflowVersion: result.workflowVersion,
      resultVersion: result.resultVersion,
      producer: result.producer,
      qualityTier: result.qualityTier,
      snapshotVersion: result.snapshotVersion,
      chapterContentHash: result.chapterContentHash,
      updatedAt: result.updatedAt,
      result: result.result,
    };
  }

  private requireString(value: unknown, field: string): string {
    const result = asString(value);
    if (!result) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
    return result;
  }

  private requireNonNegativeInteger(value: unknown, field: string): number {
    const result = asNumber(value);
    if (result === undefined || !Number.isInteger(result) || result < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer`);
    }
    return result;
  }
}
