import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import fs from 'node:fs/promises';
import type {
  AnalyzeKnowledgeExtractionData,
  KnowledgeEntity,
  KnowledgeEvent,
  KnowledgeEvidence,
  KnowledgeIdea,
  KnowledgePageRef,
  KnowledgePerson,
  KnowledgeRelation,
  KnowledgeTheme,
} from '../../../../packages/contracts/src';
import { createLLMClient, extractJsonFromText } from '../../../services/llmService';
import { resolvePromptPath } from '../../utils/prompt-path';
import { BookIngestionRepository } from '../book-ingestion/book-ingestion.repository';
import type { CanonicalChapterRecord } from '../book-ingestion/book-ingestion.types';
import { workflowLog } from '../workflow.logger';
import type {
  GetKnowledgeExtractionWorkflowResultResponseDto,
  GetKnowledgeExtractionWorkflowStatusResponseDto,
  GetLatestChapterKnowledgeExtractionResponseDto,
  SubmitKnowledgeExtractionWorkflowRequestDto,
  SubmitKnowledgeExtractionWorkflowResponseDto,
} from './knowledge-extraction-workflow.dto';
import { KnowledgeExtractionWorkflowRepository } from './knowledge-extraction-workflow.repository';
import type {
  KnowledgeExtractionWorkflowResultPayload,
  KnowledgeExtractionWorkflowRunRecord,
  SubmitKnowledgeExtractionWorkflowInput,
} from './knowledge-extraction-workflow.types';

const PROMPT_VERSION = 'knowledge_extraction.v2.1';
const PROMPT_PATH = resolvePromptPath('knowledge_extraction.txt');

const ENTITY_TYPES = new Set(['organization', 'place', 'time', 'object', 'other']);
const NODE_TYPES = new Set(['person', 'idea', 'event', 'entity', 'theme']);
const RELATION_TYPES = new Set([
  'knows',
  'supports',
  'opposes',
  'extends',
  'causes',
  'participates_in',
  'located_in',
  'happens_at',
  'reflects',
  'related_to',
]);
const IDEA_KINDS = new Set(['claim', 'belief', 'question', 'principle', 'conflict']);

type KnowledgeNodeType = KnowledgeRelation['from_type'];
type KnowledgePiece = {
  pageIndex: number;
  pageNumber: number;
  rawText: string;
  sourceHash: string;
  pieceIndex: number;
  totalPieces: number;
};

type KnowledgeMemoryItem = {
  local_id: string;
  type: KnowledgeNodeType;
  label: string;
  aliases?: string[];
};

type KnowledgeIdRemap = Record<KnowledgeNodeType, Map<string, string>>;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

let cachedSystemPrompt: string | null = null;

@Injectable()
export class KnowledgeExtractionWorkflowService {
  private readonly bookIngestionRepository: BookIngestionRepository;
  private readonly knowledgeExtractionWorkflowRepository: KnowledgeExtractionWorkflowRepository;

  constructor(
    @Inject(forwardRef(() => BookIngestionRepository))
    bookIngestionRepository: BookIngestionRepository,
    @Inject(KnowledgeExtractionWorkflowRepository)
    knowledgeExtractionWorkflowRepository: KnowledgeExtractionWorkflowRepository,
  ) {
    this.bookIngestionRepository = bookIngestionRepository;
    this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
  }

  parseSubmitRequest(rawBody: string | undefined): SubmitKnowledgeExtractionWorkflowRequestDto {
    if (!rawBody || rawBody.trim() === '') {
      workflowLog('request.parse_failed', {
        workflowKind: 'knowledge_extraction',
        reason: 'empty_body',
      });
      throw new BadRequestException('Request body cannot be empty');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      workflowLog('request.parse_failed', {
        workflowKind: 'knowledge_extraction',
        reason: 'invalid_json',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(parsed)) {
      workflowLog('request.parse_failed', {
        workflowKind: 'knowledge_extraction',
        reason: 'non_object_body',
      });
      throw new BadRequestException('Request body must be a JSON object');
    }

    const workflowVersion = parsed.workflowVersion === undefined
      ? 'v1'
      : this.requireString(parsed.workflowVersion, 'workflowVersion');

    const request = {
      bookId: this.requireString(parsed.bookId, 'bookId'),
      chapterId: this.requireString(parsed.chapterId, 'chapterId'),
      chapterIndex: this.requireNonNegativeInteger(parsed.chapterIndex, 'chapterIndex'),
      workflowVersion,
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
      workflowKind: 'knowledge_extraction',
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

  submitKnowledgeExtractionWorkflow(
    request: SubmitKnowledgeExtractionWorkflowRequestDto,
  ): SubmitKnowledgeExtractionWorkflowResponseDto {
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
        'Canonical chapter text is empty; ingest pages before submitting knowledge extraction workflow',
      );
    }

    const input: SubmitKnowledgeExtractionWorkflowInput = {
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

    const { run, deduped } = this.knowledgeExtractionWorkflowRepository.createOrReuseRun(input);
    if (!deduped) {
      void this.executeRun(run.id);
    }

    const canonicalRun = deduped
      ? this.knowledgeExtractionWorkflowRepository.getRun(run.id) ?? run
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

  getWorkflowStatus(workflowRunId: string): GetKnowledgeExtractionWorkflowStatusResponseDto {
    const run = this.requireRun(workflowRunId);
    workflowLog('status.read_hit', {
      workflowKind: run.kind,
      workflowRunId: run.id,
      bookId: run.bookId,
      chapterId: run.chapterId,
      status: run.status,
      resultAvailable: Boolean(run.output),
    });
    return this.toStatusResponse(run);
  }

  getWorkflowResult(workflowRunId: string): GetKnowledgeExtractionWorkflowResultResponseDto {
    const run = this.requireRun(workflowRunId);
    if (
      run.status !== 'completed'
      || !run.output
      || run.snapshotVersion === undefined
      || !run.chapterContentHash
    ) {
      throw new ConflictException('Knowledge extraction workflow result is not available yet');
    }

    workflowLog('result.read_hit', {
      workflowKind: run.kind,
      workflowRunId: run.id,
      bookId: run.bookId,
      chapterId: run.chapterId,
      status: run.status,
      peopleCount: run.output.people?.length ?? 0,
      ideaCount: run.output.ideas?.length ?? 0,
      eventCount: run.output.events?.length ?? 0,
      entityCount: run.output.entities?.length ?? 0,
      themeCount: run.output.themes?.length ?? 0,
      relationCount: run.output.relations?.length ?? 0,
    });

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

  getLatestChapterKnowledgeExtraction(
    bookId: string,
    chapterId: string,
  ): GetLatestChapterKnowledgeExtractionResponseDto {
    const result = this.knowledgeExtractionWorkflowRepository.getLatestResult(bookId, chapterId);
    if (!result) {
      workflowLog('latest_result.read_miss', {
        workflowKind: 'knowledge_extraction',
        bookId,
        chapterId,
      });
      throw new NotFoundException('No completed knowledge extraction workflow result found for chapter');
    }

    workflowLog('latest_result.read_hit', {
      workflowKind: 'knowledge_extraction',
      workflowRunId: result.workflowRunId,
      bookId,
      chapterId,
      chapterIndex: result.chapterIndex,
      workflowVersion: result.workflowVersion,
      snapshotVersion: result.snapshotVersion,
    });

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

  private async executeRun(workflowRunId: string): Promise<void> {
    const runningRun = this.knowledgeExtractionWorkflowRepository.markRunning(workflowRunId);
    if (!runningRun) return;

    const book = this.bookIngestionRepository.getBook(runningRun.bookId);
    const chapter = this.bookIngestionRepository.getChapter(runningRun.bookId, runningRun.chapterId);

    if (!book || !chapter) {
      this.knowledgeExtractionWorkflowRepository.failRun(
        workflowRunId,
        'KNOWLEDGE_EXTRACTION_CHAPTER_NOT_FOUND',
        'Canonical chapter state was not found during workflow execution.',
      );
      return;
    }

    if (
      runningRun.expectedSnapshotVersion !== undefined
      && runningRun.expectedSnapshotVersion !== book.snapshotVersion
    ) {
      this.knowledgeExtractionWorkflowRepository.markStale(
        workflowRunId,
        'KNOWLEDGE_EXTRACTION_CANONICAL_BOOK_STALE',
        'Canonical book snapshot changed before knowledge extraction workflow execution completed.',
      );
      return;
    }

    if (
      runningRun.expectedChapterContentHash !== undefined
      && runningRun.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      this.knowledgeExtractionWorkflowRepository.markStale(
        workflowRunId,
        'KNOWLEDGE_EXTRACTION_CANONICAL_CHAPTER_STALE',
        'Canonical chapter content changed before knowledge extraction workflow execution completed.',
      );
      return;
    }

    if (chapter.chapterTextMaterialized.trim().length === 0) {
      this.knowledgeExtractionWorkflowRepository.failRun(
        workflowRunId,
        'KNOWLEDGE_EXTRACTION_EMPTY_CHAPTER_TEXT',
        'Canonical chapter text is empty; unable to extract knowledge.',
      );
      return;
    }

    const pieces = this.buildPieces(chapter);
    if (pieces.length === 0) {
      this.knowledgeExtractionWorkflowRepository.failRun(
        workflowRunId,
        'KNOWLEDGE_EXTRACTION_EMPTY_CHAPTER_TEXT',
        'Canonical chapter text is empty; unable to extract knowledge.',
      );
      return;
    }

    try {
      const result = await this.generateKnowledgeExtraction({
        bookId: runningRun.bookId,
        chapterId: runningRun.chapterId,
        chapterTitle: chapter.chapterTitle,
        chapterText: chapter.chapterTextMaterialized,
        pieces,
      });

      this.knowledgeExtractionWorkflowRepository.completeRun({
        workflowRunId,
        snapshotVersion: book.snapshotVersion,
        chapterContentHash: chapter.chapterContentHash,
        result,
      });
    } catch (error) {
      this.knowledgeExtractionWorkflowRepository.failRun(
        workflowRunId,
        'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private buildPieces(chapter: CanonicalChapterRecord): KnowledgePiece[] {
    const pieces = Array.from(chapter.pages.entries())
      .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
      .map(([pageIndex, page]) => ({
        pageIndex,
        pageNumber: pageIndex + 1,
        rawText: page.pageTextMaterialized,
        sourceHash: page.sourceHash,
      }))
      .filter((piece) => piece.rawText.trim().length > 0);

    return pieces.map((piece, index) => ({
      ...piece,
      pieceIndex: index,
      totalPieces: pieces.length,
    }));
  }

  private async generateKnowledgeExtraction(input: {
    bookId: string;
    chapterId: string;
    chapterTitle?: string;
    chapterText: string;
    pieces: KnowledgePiece[];
  }): Promise<KnowledgeExtractionWorkflowResultPayload> {
    const knowledge = this.buildFallbackKnowledge(input);

    for (const piece of input.pieces) {
      const pieceResult = await this.generateKnowledgeExtractionForPiece({
        bookId: input.bookId,
        chapterId: input.chapterId,
        chapterTitle: input.chapterTitle,
        piece,
        memoryContext: this.buildMemoryContext(knowledge),
      });
      this.mergeKnowledge(knowledge, pieceResult);
      workflowLog('piece.processed', {
        workflowKind: 'knowledge_extraction',
        bookId: input.bookId,
        chapterId: input.chapterId,
        pageIndex: piece.pageIndex,
        pageNumber: piece.pageNumber,
        pieceIndex: piece.pieceIndex,
        totalPieces: piece.totalPieces,
        sourceHash: piece.sourceHash,
        extractedPeopleCount: pieceResult.people.length,
        extractedIdeaCount: pieceResult.ideas.length,
        extractedEventCount: pieceResult.events.length,
        extractedEntityCount: pieceResult.entities.length,
        extractedThemeCount: pieceResult.themes.length,
        extractedRelationCount: pieceResult.relations.length,
        accumulatedPeopleCount: knowledge.people.length,
        accumulatedIdeaCount: knowledge.ideas.length,
        accumulatedEventCount: knowledge.events.length,
        accumulatedEntityCount: knowledge.entities.length,
        accumulatedThemeCount: knowledge.themes.length,
        accumulatedRelationCount: knowledge.relations.length,
      });
    }

    knowledge.title = input.chapterTitle ?? knowledge.title;
    knowledge.summary = this.summarize(input.chapterText, 240);
    return knowledge;
  }

  private async generateKnowledgeExtractionForPiece(input: {
    bookId: string;
    chapterId: string;
    chapterTitle?: string;
    piece: KnowledgePiece;
    memoryContext: string;
  }): Promise<AnalyzeKnowledgeExtractionData> {
    const [systemPrompt, userPrompt] = await Promise.all([
      this.loadPrompt(),
      Promise.resolve(this.buildPiecePrompt(input)),
    ]);
    const llmClient = createLLMClient({ systemPrompt });
    const response = await llmClient.json(userPrompt);

    let text = '';
    for await (const chunk of response.data) {
      text += chunk;
    }

    try {
      const parsed = extractJsonFromText(text);
      return this.sanitizeKnowledgeExtraction(parsed, {
        chapterId: input.chapterId,
        chapterTitle: input.chapterTitle,
        chapterText: input.piece.rawText,
        pageRef: this.createPageRef(input.piece.pageIndex, input.piece.pageNumber),
      });
    } catch {
      return this.createEmptyKnowledgeExtraction(input.chapterId, input.chapterTitle);
    }
  }

  private buildPiecePrompt(input: {
    bookId: string;
    chapterId: string;
    chapterTitle?: string;
    piece: KnowledgePiece;
    memoryContext: string;
  }): string {
    const sections = [
      `Document ID: ${input.bookId}`,
      `Chapter ID: ${input.chapterId}`,
      `Chapter Title: ${input.chapterTitle ?? ''}`,
      `Chunk ID: page-${input.piece.pageIndex}`,
      `Chunk Index: ${input.piece.pieceIndex + 1}`,
      `Total Chunks: ${input.piece.totalPieces}`,
      `Page Index: ${input.piece.pageIndex}`,
      `Page Number: ${input.piece.pageNumber}`,
      `Source Hash: ${input.piece.sourceHash}`,
      `Prompt Version: ${PROMPT_VERSION}`,
      '',
      'Memory context:',
      '```json',
      input.memoryContext,
      '```',
      '',
      'Current page text:',
      '```text',
      input.piece.rawText,
      '```',
      '',
      'Only extract knowledge supported by the current page text.',
      'Reuse local_id values from memory context when the current page clearly refers to the same item.',
      `Every returned knowledge item must include pageRefs with pageIndex=${input.piece.pageIndex} and pageNumber=${input.piece.pageNumber}.`,
      'Respond with JSON only. Do not wrap the JSON in markdown fences.',
    ];
    return sections.join('\n');
  }

  private async loadPrompt(): Promise<string> {
    if (cachedSystemPrompt) return cachedSystemPrompt;
    cachedSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedSystemPrompt;
  }

  private buildFallbackKnowledge(input: {
    chapterId: string;
    chapterTitle?: string;
    chapterText: string;
  }): AnalyzeKnowledgeExtractionData {
    return {
      title: input.chapterTitle ?? `Chapter ${input.chapterId}`,
      summary: this.summarize(input.chapterText, 240),
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    };
  }

  private createEmptyKnowledgeExtraction(
    chapterId: string,
    chapterTitle?: string,
  ): AnalyzeKnowledgeExtractionData {
    return {
      title: chapterTitle ?? `Chapter ${chapterId}`,
      summary: '',
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    };
  }

  private sanitizeKnowledgeExtraction(
    raw: unknown,
    input: {
      chapterId: string;
      chapterTitle?: string;
      chapterText: string;
      pageRef: KnowledgePageRef;
    },
  ): AnalyzeKnowledgeExtractionData {
    const record = isPlainObject(raw) ? raw : {};

    return {
      title: asString(record.title) ?? input.chapterTitle ?? `Chapter ${input.chapterId}`,
      summary: asString(record.summary) ?? this.summarize(input.chapterText, 240),
      people: this.sanitizePeople(record.people, input.pageRef) ?? [],
      ideas: this.sanitizeIdeas(record.ideas, input.pageRef) ?? [],
      events: this.sanitizeEvents(record.events, input.pageRef) ?? [],
      entities: this.sanitizeEntities(record.entities, input.pageRef) ?? [],
      themes: this.sanitizeThemes(record.themes, input.pageRef) ?? [],
      relations: this.sanitizeRelations(record.relations, input.pageRef) ?? [],
    };
  }

  private sanitizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.map(asString).filter((item): item is string => Boolean(item));
    return items.length ? items : undefined;
  }

  private sanitizeEvidence(value: unknown): KnowledgeEvidence[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const evidence = value
      .map((item): KnowledgeEvidence | null => {
        if (!isPlainObject(item)) return null;
        const quote = asString(item.quote);
        return quote ? { quote } : null;
      })
      .filter((item): item is KnowledgeEvidence => item !== null);
    return evidence.length ? evidence : undefined;
  }

  private sanitizePageRefs(
    value: unknown,
    currentPageRef: KnowledgePageRef,
  ): KnowledgePageRef[] {
    const refs = Array.isArray(value)
      ? value
        .map((item): KnowledgePageRef | null => {
          if (!isPlainObject(item)) return null;
          const pageIndex = asNumber(item.pageIndex);
          const pageNumber = asNumber(item.pageNumber);
          if (
            pageIndex === undefined
            || !Number.isInteger(pageIndex)
            || pageIndex < 0
            || pageNumber === undefined
            || !Number.isInteger(pageNumber)
            || pageNumber < 1
          ) {
            return null;
          }
          return { pageIndex, pageNumber };
        })
        .filter((item): item is KnowledgePageRef => item !== null)
      : [];
    return this.mergePageRefs(refs, [currentPageRef]) ?? [currentPageRef];
  }

  private sanitizePeople(
    value: unknown,
    currentPageRef: KnowledgePageRef,
  ): KnowledgePerson[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const people = value
      .map((item, index): KnowledgePerson | null => {
        if (!isPlainObject(item)) return null;
        const name = asString(item.name);
        if (!name) return null;
        return {
          local_id: asString(item.local_id) ?? `p${index + 1}`,
          name,
          aliases: this.sanitizeStringArray(item.aliases),
          description: asString(item.description),
          roles: this.sanitizeStringArray(item.roles),
          traits: this.sanitizeStringArray(item.traits),
          evidence: this.sanitizeEvidence(item.evidence),
          pageRefs: this.sanitizePageRefs(item.pageRefs, currentPageRef),
        };
      })
      .filter((item): item is KnowledgePerson => item !== null);
    return people.length ? people : undefined;
  }

  private sanitizeIdeas(
    value: unknown,
    currentPageRef: KnowledgePageRef,
  ): KnowledgeIdea[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const ideas = value
      .map((item, index): KnowledgeIdea | null => {
        if (!isPlainObject(item)) return null;
        const label = asString(item.label);
        if (!label) return null;
        const kind = asString(item.kind);
        return {
          local_id: asString(item.local_id) ?? `i${index + 1}`,
          label,
          description: asString(item.description),
          kind: kind && IDEA_KINDS.has(kind) ? kind as KnowledgeIdea['kind'] : 'claim',
          evidence: this.sanitizeEvidence(item.evidence),
          pageRefs: this.sanitizePageRefs(item.pageRefs, currentPageRef),
        };
      })
      .filter((item): item is KnowledgeIdea => item !== null);
    return ideas.length ? ideas : undefined;
  }

  private sanitizeEvents(
    value: unknown,
    currentPageRef: KnowledgePageRef,
  ): KnowledgeEvent[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const events = value
      .map((item, index): KnowledgeEvent | null => {
        if (!isPlainObject(item)) return null;
        const label = asString(item.label);
        if (!label) return null;
        return {
          local_id: asString(item.local_id) ?? `e${index + 1}`,
          label,
          description: asString(item.description),
          participant_local_ids: this.sanitizeStringArray(item.participant_local_ids),
          time_hint: asString(item.time_hint),
          place_hint: asString(item.place_hint),
          evidence: this.sanitizeEvidence(item.evidence),
          pageRefs: this.sanitizePageRefs(item.pageRefs, currentPageRef),
        };
      })
      .filter((item): item is KnowledgeEvent => item !== null);
    return events.length ? events : undefined;
  }

  private sanitizeEntities(
    value: unknown,
    currentPageRef: KnowledgePageRef,
  ): KnowledgeEntity[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const entities = value
      .map((item, index): KnowledgeEntity | null => {
        if (!isPlainObject(item)) return null;
        const label = asString(item.label);
        const type = asString(item.type);
        if (!label || !type || !ENTITY_TYPES.has(type)) return null;
        return {
          local_id: asString(item.local_id) ?? `n${index + 1}`,
          label,
          type: type as KnowledgeEntity['type'],
          description: asString(item.description),
          evidence: this.sanitizeEvidence(item.evidence),
          pageRefs: this.sanitizePageRefs(item.pageRefs, currentPageRef),
        };
      })
      .filter((item): item is KnowledgeEntity => item !== null);
    return entities.length ? entities : undefined;
  }

  private sanitizeThemes(
    value: unknown,
    currentPageRef: KnowledgePageRef,
  ): KnowledgeTheme[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const themes = value
      .map((item, index): KnowledgeTheme | null => {
        if (!isPlainObject(item)) return null;
        const label = asString(item.label);
        if (!label) return null;
        const strength = asNumber(item.strength);
        return {
          local_id: asString(item.local_id) ?? `t${index + 1}`,
          label,
          strength: typeof strength === 'number' ? Math.max(0, Math.min(1, strength)) : undefined,
          description: asString(item.description),
          evidence: this.sanitizeEvidence(item.evidence),
          pageRefs: this.sanitizePageRefs(item.pageRefs, currentPageRef),
        };
      })
      .filter((item): item is KnowledgeTheme => item !== null);
    return themes.length ? themes : undefined;
  }

  private sanitizeRelations(
    value: unknown,
    currentPageRef: KnowledgePageRef,
  ): KnowledgeRelation[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const relations = value
      .map((item, index): KnowledgeRelation | null => {
        if (!isPlainObject(item)) return null;
        const fromId = asString(item.from_id);
        const fromType = asString(item.from_type);
        const toId = asString(item.to_id);
        const toType = asString(item.to_type);
        if (
          !fromId
          || !fromType
          || !toId
          || !toType
          || !NODE_TYPES.has(fromType)
          || !NODE_TYPES.has(toType)
        ) {
          return null;
        }
        const relationType = asString(item.relation_type);
        const confidence = asNumber(item.confidence);
        return {
          local_id: asString(item.local_id) ?? `r${index + 1}`,
          from_id: fromId,
          from_type: fromType as KnowledgeRelation['from_type'],
          to_id: toId,
          to_type: toType as KnowledgeRelation['to_type'],
          relation_type:
            relationType && RELATION_TYPES.has(relationType)
              ? relationType as KnowledgeRelation['relation_type']
              : 'related_to',
          description: asString(item.description),
          confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : undefined,
          evidence: this.sanitizeEvidence(item.evidence),
          pageRefs: this.sanitizePageRefs(item.pageRefs, currentPageRef),
        };
      })
      .filter((item): item is KnowledgeRelation => item !== null);
    return relations.length ? relations : undefined;
  }

  private buildMemoryContext(knowledge: AnalyzeKnowledgeExtractionData): string {
    const items: KnowledgeMemoryItem[] = [
      ...knowledge.people.map((person) => ({
        local_id: person.local_id,
        type: 'person' as const,
        label: person.name,
        aliases: person.aliases,
      })),
      ...knowledge.ideas.map((idea) => ({
        local_id: idea.local_id,
        type: 'idea' as const,
        label: idea.label,
      })),
      ...knowledge.events.map((event) => ({
        local_id: event.local_id,
        type: 'event' as const,
        label: event.label,
      })),
      ...knowledge.entities.map((entity) => ({
        local_id: entity.local_id,
        type: 'entity' as const,
        label: entity.label,
      })),
      ...knowledge.themes.map((theme) => ({
        local_id: theme.local_id,
        type: 'theme' as const,
        label: theme.label,
      })),
    ];
    return items.length > 0 ? JSON.stringify(items, null, 2) : '[]';
  }

  private mergeKnowledge(
    target: AnalyzeKnowledgeExtractionData,
    incoming: AnalyzeKnowledgeExtractionData,
  ): void {
    const idRemap = this.createEmptyIdRemap();

    for (const person of incoming.people) {
      idRemap.person.set(
        person.local_id,
        this.mergePerson(target.people, person).local_id,
      );
    }

    for (const idea of incoming.ideas) {
      idRemap.idea.set(
        idea.local_id,
        this.mergeIdea(target.ideas, idea).local_id,
      );
    }

    for (const entity of incoming.entities) {
      idRemap.entity.set(
        entity.local_id,
        this.mergeEntity(target.entities, entity).local_id,
      );
    }

    for (const theme of incoming.themes) {
      idRemap.theme.set(
        theme.local_id,
        this.mergeTheme(target.themes, theme).local_id,
      );
    }

    for (const event of incoming.events) {
      const remappedEvent: KnowledgeEvent = {
        ...event,
        participant_local_ids: this.remapStringIds(event.participant_local_ids, idRemap.person),
      };
      idRemap.event.set(
        event.local_id,
        this.mergeEvent(target.events, remappedEvent).local_id,
      );
    }

    for (const relation of incoming.relations) {
      const remappedRelation: KnowledgeRelation = {
        ...relation,
        from_id: this.remapNodeId(relation.from_type, relation.from_id, idRemap),
        to_id: this.remapNodeId(relation.to_type, relation.to_id, idRemap),
      };
      this.mergeRelation(target.relations, remappedRelation);
    }
  }

  private createEmptyIdRemap(): KnowledgeIdRemap {
    return {
      person: new Map<string, string>(),
      idea: new Map<string, string>(),
      event: new Map<string, string>(),
      entity: new Map<string, string>(),
      theme: new Map<string, string>(),
    };
  }

  private remapNodeId(
    type: KnowledgeNodeType,
    localId: string,
    remap: KnowledgeIdRemap,
  ): string {
    return remap[type].get(localId) ?? localId;
  }

  private remapStringIds(
    ids: string[] | undefined,
    remap: Map<string, string>,
  ): string[] | undefined {
    if (!ids || ids.length === 0) return undefined;
    return this.mergeStringArrays(
      undefined,
      ids.map((id) => remap.get(id) ?? id),
    );
  }

  private mergePerson(collection: KnowledgePerson[], incoming: KnowledgePerson): KnowledgePerson {
    const existing = collection.find((item) => this.personKey(item.name) === this.personKey(incoming.name));
    if (!existing) {
      const created: KnowledgePerson = {
        ...incoming,
        local_id: this.ensureUniqueLocalId(collection, incoming.local_id, 'p'),
        aliases: this.mergeStringArrays(undefined, incoming.aliases),
        roles: this.mergeStringArrays(undefined, incoming.roles),
        traits: this.mergeStringArrays(undefined, incoming.traits),
        evidence: this.mergeEvidence(undefined, incoming.evidence),
        pageRefs: this.mergePageRefs(undefined, incoming.pageRefs),
      };
      collection.push(created);
      return created;
    }

    existing.aliases = this.mergeStringArrays(existing.aliases, incoming.aliases);
    existing.roles = this.mergeStringArrays(existing.roles, incoming.roles);
    existing.traits = this.mergeStringArrays(existing.traits, incoming.traits);
    existing.description = existing.description ?? incoming.description;
    existing.evidence = this.mergeEvidence(existing.evidence, incoming.evidence);
    existing.pageRefs = this.mergePageRefs(existing.pageRefs, incoming.pageRefs);
    return existing;
  }

  private mergeIdea(collection: KnowledgeIdea[], incoming: KnowledgeIdea): KnowledgeIdea {
    const existing = collection.find((item) => this.labelKey(item.label) === this.labelKey(incoming.label));
    if (!existing) {
      const created: KnowledgeIdea = {
        ...incoming,
        local_id: this.ensureUniqueLocalId(collection, incoming.local_id, 'i'),
        evidence: this.mergeEvidence(undefined, incoming.evidence),
        pageRefs: this.mergePageRefs(undefined, incoming.pageRefs),
      };
      collection.push(created);
      return created;
    }

    existing.description = existing.description ?? incoming.description;
    existing.kind = existing.kind ?? incoming.kind;
    existing.evidence = this.mergeEvidence(existing.evidence, incoming.evidence);
    existing.pageRefs = this.mergePageRefs(existing.pageRefs, incoming.pageRefs);
    return existing;
  }

  private mergeEvent(collection: KnowledgeEvent[], incoming: KnowledgeEvent): KnowledgeEvent {
    const existing = collection.find((item) => this.labelKey(item.label) === this.labelKey(incoming.label));
    if (!existing) {
      const created: KnowledgeEvent = {
        ...incoming,
        local_id: this.ensureUniqueLocalId(collection, incoming.local_id, 'e'),
        participant_local_ids: this.mergeStringArrays(undefined, incoming.participant_local_ids),
        evidence: this.mergeEvidence(undefined, incoming.evidence),
        pageRefs: this.mergePageRefs(undefined, incoming.pageRefs),
      };
      collection.push(created);
      return created;
    }

    existing.description = existing.description ?? incoming.description;
    existing.time_hint = existing.time_hint ?? incoming.time_hint;
    existing.place_hint = existing.place_hint ?? incoming.place_hint;
    existing.participant_local_ids = this.mergeStringArrays(
      existing.participant_local_ids,
      incoming.participant_local_ids,
    );
    existing.evidence = this.mergeEvidence(existing.evidence, incoming.evidence);
    existing.pageRefs = this.mergePageRefs(existing.pageRefs, incoming.pageRefs);
    return existing;
  }

  private mergeEntity(collection: KnowledgeEntity[], incoming: KnowledgeEntity): KnowledgeEntity {
    const existing = collection.find((item) => this.labelKey(item.label) === this.labelKey(incoming.label));
    if (!existing) {
      const created: KnowledgeEntity = {
        ...incoming,
        local_id: this.ensureUniqueLocalId(collection, incoming.local_id, 'n'),
        evidence: this.mergeEvidence(undefined, incoming.evidence),
        pageRefs: this.mergePageRefs(undefined, incoming.pageRefs),
      };
      collection.push(created);
      return created;
    }

    existing.description = existing.description ?? incoming.description;
    existing.evidence = this.mergeEvidence(existing.evidence, incoming.evidence);
    existing.pageRefs = this.mergePageRefs(existing.pageRefs, incoming.pageRefs);
    return existing;
  }

  private mergeTheme(collection: KnowledgeTheme[], incoming: KnowledgeTheme): KnowledgeTheme {
    const existing = collection.find((item) => this.labelKey(item.label) === this.labelKey(incoming.label));
    if (!existing) {
      const created: KnowledgeTheme = {
        ...incoming,
        local_id: this.ensureUniqueLocalId(collection, incoming.local_id, 't'),
        evidence: this.mergeEvidence(undefined, incoming.evidence),
        pageRefs: this.mergePageRefs(undefined, incoming.pageRefs),
      };
      collection.push(created);
      return created;
    }

    existing.description = existing.description ?? incoming.description;
    existing.strength = this.maxNumber(existing.strength, incoming.strength);
    existing.evidence = this.mergeEvidence(existing.evidence, incoming.evidence);
    existing.pageRefs = this.mergePageRefs(existing.pageRefs, incoming.pageRefs);
    return existing;
  }

  private mergeRelation(collection: KnowledgeRelation[], incoming: KnowledgeRelation): KnowledgeRelation {
    const existing = collection.find(
      (item) => this.relationKey(item) === this.relationKey(incoming),
    );
    if (!existing) {
      const created: KnowledgeRelation = {
        ...incoming,
        local_id: this.ensureUniqueLocalId(collection, incoming.local_id, 'r'),
        evidence: this.mergeEvidence(undefined, incoming.evidence),
        pageRefs: this.mergePageRefs(undefined, incoming.pageRefs),
      };
      collection.push(created);
      return created;
    }

    existing.description = existing.description ?? incoming.description;
    existing.confidence = this.maxNumber(existing.confidence, incoming.confidence);
    existing.evidence = this.mergeEvidence(existing.evidence, incoming.evidence);
    existing.pageRefs = this.mergePageRefs(existing.pageRefs, incoming.pageRefs);
    return existing;
  }

  private ensureUniqueLocalId<T extends { local_id: string }>(
    collection: T[],
    preferredLocalId: string,
    prefix: string,
  ): string {
    if (!collection.some((item) => item.local_id === preferredLocalId)) {
      return preferredLocalId;
    }

    let index = collection.length + 1;
    let candidate = `${prefix}${index}`;
    while (collection.some((item) => item.local_id === candidate)) {
      index += 1;
      candidate = `${prefix}${index}`;
    }
    return candidate;
  }

  private mergeStringArrays(
    existing: string[] | undefined,
    incoming: string[] | undefined,
  ): string[] | undefined {
    const values = [...(existing ?? []), ...(incoming ?? [])];
    if (values.length === 0) return undefined;

    const merged: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = normalizeText(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(value.trim());
    }
    return merged.length > 0 ? merged : undefined;
  }

  private mergeEvidence(
    existing: KnowledgeEvidence[] | undefined,
    incoming: KnowledgeEvidence[] | undefined,
  ): KnowledgeEvidence[] | undefined {
    const values = [...(existing ?? []), ...(incoming ?? [])];
    if (values.length === 0) return undefined;

    const merged: KnowledgeEvidence[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = normalizeText(value.quote);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push({ quote: value.quote.trim() });
    }
    return merged.length > 0 ? merged : undefined;
  }

  private mergePageRefs(
    existing: KnowledgePageRef[] | undefined,
    incoming: KnowledgePageRef[] | undefined,
  ): KnowledgePageRef[] | undefined {
    const values = [...(existing ?? []), ...(incoming ?? [])];
    if (values.length === 0) return undefined;

    const byPageIndex = new Map<number, KnowledgePageRef>();
    for (const value of values) {
      if (!Number.isInteger(value.pageIndex) || value.pageIndex < 0) continue;
      byPageIndex.set(value.pageIndex, {
        pageIndex: value.pageIndex,
        pageNumber: value.pageNumber,
      });
    }

    const merged = Array.from(byPageIndex.values())
      .sort((left, right) => left.pageIndex - right.pageIndex);
    return merged.length > 0 ? merged : undefined;
  }

  private maxNumber(existing: number | undefined, incoming: number | undefined): number | undefined {
    if (existing === undefined) return incoming;
    if (incoming === undefined) return existing;
    return Math.max(existing, incoming);
  }

  private personKey(name: string): string {
    return normalizeText(name);
  }

  private labelKey(label: string): string {
    return normalizeText(label);
  }

  private relationKey(relation: KnowledgeRelation): string {
    return [
      normalizeText(relation.from_type),
      normalizeText(relation.from_id),
      normalizeText(relation.relation_type),
      normalizeText(relation.to_type),
      normalizeText(relation.to_id),
    ].join('|');
  }

  private createPageRef(pageIndex: number, pageNumber: number): KnowledgePageRef {
    return { pageIndex, pageNumber };
  }

  private summarize(text: string, maxLength: number): string {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
  }

  private buildDefaultIdempotencyKey(
    bookId: string,
    chapterId: string,
    workflowVersion: string,
    chapterContentHash: string,
  ): string {
    return `knowledge-extraction:${workflowVersion}:${bookId}:${chapterId}:${chapterContentHash}`;
  }

  private toSubmitResponse(
    run: KnowledgeExtractionWorkflowRunRecord,
    deduped: boolean,
  ): SubmitKnowledgeExtractionWorkflowResponseDto {
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

  private toStatusResponse(
    run: KnowledgeExtractionWorkflowRunRecord,
  ): GetKnowledgeExtractionWorkflowStatusResponseDto {
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

  private requireRun(workflowRunId: string): KnowledgeExtractionWorkflowRunRecord {
    const run = this.knowledgeExtractionWorkflowRepository.getRun(workflowRunId);
    if (!run) {
      workflowLog('status.read_miss', {
        workflowKind: 'knowledge_extraction',
        workflowRunId,
      });
      throw new NotFoundException('Knowledge extraction workflow run not found');
    }
    return run;
  }

  private requireString(value: unknown, fieldName: string): string {
    if (!isNonEmptyString(value)) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  }

  private requireNonNegativeInteger(value: unknown, fieldName: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${fieldName} must be a non-negative integer`);
    }
    return value;
  }
}
