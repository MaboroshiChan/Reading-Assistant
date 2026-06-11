import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import fs from 'node:fs/promises';
import { BookContextService } from '../book-ingestion/book-context.service';
import { BookIngestionRepository } from '../book-ingestion/book-ingestion.repository';
import { config } from '../../config/runtime-config';
import { buildSharedChapterPrefixCache } from '../../utils/chapter-prefix-cache';
import { retryLLMOperation } from '../../utils/llm-retry';
import { resolvePromptPath } from '../../utils/prompt-path';
import { createLLMClient, extractJsonFromText } from '../../../services/llmService';
import { WorkflowQueueService } from '../workflow-queue/workflow-queue.service';
import type {
  GetLatestChapterPreReadingResponseDto,
  GetPreReadingWorkflowResultResponseDto,
  GetPreReadingWorkflowStatusResponseDto,
  SubmitPreReadingWorkflowRequestDto,
  SubmitPreReadingWorkflowResponseDto,
} from './pre-reading-workflow.dto';
import { PreReadingWorkflowRepository } from './pre-reading-workflow.repository';
import type {
  PreReadingResultPayload,
  PreReadingWorkflowRunRecord,
  SubmitPreReadingWorkflowInput,
} from './pre-reading-workflow.types';

const PROMPT_VERSION = 'pre-reading.v1';
const PROMPT_PATH = resolvePromptPath('quiz.txt');
const MAX_WORKFLOW_LLM_RETRIES = 2;
const DEFAULT_WORKFLOW_LLM_RETRY_DELAY_MS = 5_000;
const MAX_WORKFLOW_LLM_RETRY_DELAY_MS = 30_000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

let cachedSystemPrompt: string | null = null;

@Injectable()
export class PreReadingWorkflowService {
  constructor(
    @Inject(BookIngestionRepository)
    private readonly bookIngestionRepository: BookIngestionRepository,
    @Inject(BookContextService)
    private readonly bookContextService: BookContextService,
    @Inject(PreReadingWorkflowRepository)
    private readonly repository: PreReadingWorkflowRepository,
    @Inject(WorkflowQueueService)
    private readonly workflowQueueService: WorkflowQueueService,
  ) {}

  parseSubmitRequest(rawBody: string | undefined): SubmitPreReadingWorkflowRequestDto {
    if (!rawBody?.trim()) throw new BadRequestException('Request body cannot be empty');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isPlainObject(parsed)) throw new BadRequestException('Request body must be a JSON object');
    return {
      bookId: this.requireString(parsed.bookId, 'bookId'),
      chapterId: this.requireString(parsed.chapterId, 'chapterId'),
      chapterIndex: this.requireNonNegativeInteger(parsed.chapterIndex, 'chapterIndex'),
      workflowVersion: parsed.workflowVersion === undefined
        ? 'v1'
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
  }

  submitPreReadingWorkflow(
    request: SubmitPreReadingWorkflowRequestDto,
    options: { enqueue?: boolean } = {},
  ): SubmitPreReadingWorkflowResponseDto {
    const book = this.bookIngestionRepository.getBook(request.bookId);
    const chapter = this.bookIngestionRepository.getChapter(request.bookId, request.chapterId);
    if (!book || !chapter) throw new NotFoundException('Chapter not found in canonical ingestion state');
    if (chapter.chapterIndex !== request.chapterIndex) {
      throw new ConflictException('chapterIndex does not match canonical chapter state');
    }
    if (
      request.expectedSnapshotVersion !== undefined
      && request.expectedSnapshotVersion !== book.snapshotVersion
      && request.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      throw new ConflictException('expectedSnapshotVersion does not match canonical book state');
    }
    if (
      request.expectedChapterContentHash !== undefined
      && request.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      throw new ConflictException('expectedChapterContentHash does not match canonical chapter state');
    }
    if (!chapter.chapterTextMaterialized.trim()) {
      throw new ConflictException('Canonical chapter text is empty; ingest pages before submitting pre-reading workflow');
    }

    const input: SubmitPreReadingWorkflowInput = {
      ...request,
      idempotencyKey: request.idempotencyKey ?? [
        'pre-reading',
        request.workflowVersion,
        request.bookId,
        request.chapterId,
        chapter.chapterContentHash,
      ].join(':'),
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter.chapterContentHash,
    };
    const { run, deduped } = this.repository.createOrReuseRun(input);
    if (!deduped && options.enqueue !== false) {
      this.workflowQueueService.enqueue(() => this.executeRun(run.id));
    }
    return this.toSubmitResponse(run, deduped);
  }

  async executeRun(workflowRunId: string): Promise<void> {
    const run = this.repository.markRunning(workflowRunId);
    if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'stale') return;
    const book = this.bookIngestionRepository.getBook(run.bookId);
    const chapter = this.bookIngestionRepository.getChapter(run.bookId, run.chapterId);
    if (!book || !chapter) {
      this.repository.failRun(workflowRunId, 'PRE_READING_CHAPTER_NOT_FOUND', 'Canonical chapter state was not found.');
      return;
    }
    if (
      run.expectedChapterContentHash !== undefined
      && run.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      this.repository.markStale(workflowRunId, 'PRE_READING_CHAPTER_STALE', 'Canonical chapter content changed.');
      return;
    }

    try {
      const result = await retryLLMOperation({
        operation: () => this.generate({
          bookId: run.bookId,
          chapterId: run.chapterId,
          chapterIndex: run.chapterIndex,
          chapterTitle: chapter.chapterTitle,
          chapterText: chapter.chapterTextMaterialized,
          chapterContentHash: chapter.chapterContentHash,
        }),
        maxRetries: MAX_WORKFLOW_LLM_RETRIES,
        defaultDelayMs: DEFAULT_WORKFLOW_LLM_RETRY_DELAY_MS,
        maxDelayMs: MAX_WORKFLOW_LLM_RETRY_DELAY_MS,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      this.repository.completeRun({
        workflowRunId,
        snapshotVersion: book.snapshotVersion,
        chapterContentHash: chapter.chapterContentHash,
        result,
      });
    } catch (error) {
      this.repository.failRun(
        workflowRunId,
        'PRE_READING_GENERATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  getWorkflowStatus(workflowRunId: string): GetPreReadingWorkflowStatusResponseDto {
    return this.toStatusResponse(this.requireRun(workflowRunId));
  }

  getWorkflowResult(workflowRunId: string): GetPreReadingWorkflowResultResponseDto {
    const run = this.requireRun(workflowRunId);
    if (
      run.status !== 'completed'
      || !run.output
      || run.snapshotVersion === undefined
      || !run.chapterContentHash
    ) {
      throw new ConflictException('Pre-reading workflow result is not available yet');
    }
    return {
      workflowRunId: run.id,
      kind: run.kind,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      resultVersion: run.resultVersion,
      snapshotVersion: run.snapshotVersion,
      chapterContentHash: run.chapterContentHash,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      result: run.output,
    };
  }

  getLatestChapterPreReading(bookId: string, chapterId: string): GetLatestChapterPreReadingResponseDto {
    const stored = this.repository.getLatestResult(bookId, chapterId);
    const chapter = this.bookIngestionRepository.getChapter(bookId, chapterId);
    if (!stored || !chapter || stored.chapterContentHash !== chapter.chapterContentHash) {
      throw new NotFoundException('No current pre-reading workflow result found for chapter');
    }
    return {
      workflowRunId: stored.workflowRunId,
      bookId: stored.bookId,
      chapterId: stored.chapterId,
      chapterIndex: stored.chapterIndex,
      workflowVersion: stored.workflowVersion,
      resultVersion: stored.resultVersion,
      snapshotVersion: stored.snapshotVersion,
      chapterContentHash: stored.chapterContentHash,
      updatedAt: stored.updatedAt,
      result: stored.result,
    };
  }

  private async generate(input: {
    bookId: string;
    chapterId: string;
    chapterIndex: number;
    chapterTitle?: string;
    chapterText: string;
    chapterContentHash: string;
  }): Promise<PreReadingResultPayload> {
    const book = this.bookIngestionRepository.getBook(input.bookId);
    const metadata = isPlainObject(book?.bookMetadata) ? book.bookMetadata : {};
    const llmClient = createLLMClient({
      systemPrompt: await this.loadPrompt(),
      model: config.quizWorkflowModel,
      prefixCache: buildSharedChapterPrefixCache({
        ...input,
        bookMetadata: {
          title: asString(metadata.title),
          author: asString(metadata.author),
          language: asString(metadata.language),
        },
      }),
    });
    const response = await llmClient.json(this.buildPrompt(input));
    let text = '';
    for await (const chunk of response.data) text += chunk;
    return this.coerceResult(extractJsonFromText(text));
  }

  private buildPrompt(input: {
    bookId: string;
    chapterId: string;
    chapterIndex: number;
    chapterTitle?: string;
  }): string {
    const bookContext = this.bookContextService.buildBookContextBundle(input.bookId, input.chapterId);
    return [
      `Book ID: ${input.bookId}`,
      `Chapter ID: ${input.chapterId}`,
      `Chapter Index: ${input.chapterIndex}`,
      `Chapter Title: ${input.chapterTitle ?? ''}`,
      `Prompt Version: ${PROMPT_VERSION}`,
      '',
      'Book context:',
      '```json',
      JSON.stringify(bookContext ?? { bookId: input.bookId }, null, 2),
      '```',
      '',
      'Generate the chapter pre-reading guide before any insight extraction or quiz generation.',
      'Use only the canonical chapter text supplied in the cached chapter prefix.',
      'Return exactly one spoiler-light `teaser` and exactly 3 open-ended `pre_reading_questions`.',
      'Do not reveal outcomes, answers, late-chapter events, or extracted insight labels.',
      'Set `questions` to an empty array.',
      'Respond with JSON only.',
    ].join('\n');
  }

  private coerceResult(value: unknown): PreReadingResultPayload {
    if (!isPlainObject(value)) throw new Error('Pre-reading LLM response was not a JSON object');
    const teaser = asString(value.teaser);
    const questions = Array.isArray(value.pre_reading_questions)
      ? value.pre_reading_questions
        .map(asString)
        .filter((item): item is string => typeof item === 'string')
      : [];
    const uniqueQuestions = Array.from(new Set(questions)).slice(0, 3);
    if (!teaser || uniqueQuestions.length !== 3) {
      throw new Error('Pre-reading LLM response must contain one teaser and exactly 3 questions');
    }
    return { teaser, pre_reading_questions: uniqueQuestions };
  }

  private async loadPrompt(): Promise<string> {
    if (!cachedSystemPrompt) cachedSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedSystemPrompt;
  }

  private toSubmitResponse(
    run: PreReadingWorkflowRunRecord,
    deduped: boolean,
  ): SubmitPreReadingWorkflowResponseDto {
    return {
      workflowRunId: run.id,
      kind: run.kind,
      status: run.status,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
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

  private toStatusResponse(run: PreReadingWorkflowRunRecord): GetPreReadingWorkflowStatusResponseDto {
    return {
      workflowRunId: run.id,
      kind: run.kind,
      status: run.status,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
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

  private requireRun(workflowRunId: string): PreReadingWorkflowRunRecord {
    const run = this.repository.getRun(workflowRunId);
    if (!run) throw new NotFoundException('Pre-reading workflow run not found');
    return run;
  }

  private requireString(value: unknown, field: string): string {
    const result = asString(value);
    if (!result) throw new BadRequestException(`${field} must be a non-empty string`);
    return result;
  }

  private requireNonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer`);
    }
    return value;
  }
}
