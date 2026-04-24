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
  KnowledgePerson,
  KnowledgeRelation,
  KnowledgeTheme,
} from '../../../../packages/contracts/src';
import { createLLMClient, extractJsonFromText } from '../../../services/llmService';
import { BookIngestionRepository } from '../book-ingestion/book-ingestion.repository';
import { workflowLog } from '../workflow.logger';
import { resolvePromptPath } from '../../utils/prompt-path';
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

const PROMPT_VERSION = 'knowledge_extraction.v2.0';
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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

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

    try {
      const result = await this.generateKnowledgeExtraction({
        bookId: runningRun.bookId,
        chapterId: runningRun.chapterId,
        chapterTitle: chapter.chapterTitle,
        chapterText: chapter.chapterTextMaterialized,
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

  private async generateKnowledgeExtraction(input: {
    bookId: string;
    chapterId: string;
    chapterTitle?: string;
    chapterText: string;
  }): Promise<KnowledgeExtractionWorkflowResultPayload> {
    const [systemPrompt, userPrompt] = await Promise.all([
      this.loadPrompt(),
      Promise.resolve(this.buildPrompt(input)),
    ]);
    const llmClient = createLLMClient({ systemPrompt });
    const response = await llmClient.json(userPrompt);

    let text = '';
    for await (const chunk of response.data) {
      text += chunk;
    }

    try {
      const parsed = extractJsonFromText(text);
      return this.sanitizeKnowledgeExtraction(parsed, input);
    } catch {
      return this.buildFallbackKnowledge(input);
    }
  }

  private buildPrompt(input: {
    bookId: string;
    chapterId: string;
    chapterTitle?: string;
    chapterText: string;
  }): string {
    const sections = [
      `Document ID: ${input.bookId}`,
      `Chapter ID: ${input.chapterId}`,
      `Chapter Title: ${input.chapterTitle ?? ''}`,
      'Chunk ID: ',
      'Chunk Index: ',
      'Total Chunks: ',
      `Prompt Version: ${PROMPT_VERSION}`,
      '',
      'Memory context:',
      '```text',
      '',
      '```',
      '',
      'Chapter text:',
      '```text',
      input.chapterText,
      '```',
      '',
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

  private sanitizeKnowledgeExtraction(
    raw: unknown,
    input: {
      chapterId: string;
      chapterTitle?: string;
      chapterText: string;
    },
  ): AnalyzeKnowledgeExtractionData {
    const record = isPlainObject(raw) ? raw : {};

    return {
      title: asString(record.title) ?? input.chapterTitle ?? `Chapter ${input.chapterId}`,
      summary: asString(record.summary) ?? this.summarize(input.chapterText, 240),
      people: this.sanitizePeople(record.people) ?? [],
      ideas: this.sanitizeIdeas(record.ideas) ?? [],
      events: this.sanitizeEvents(record.events) ?? [],
      entities: this.sanitizeEntities(record.entities) ?? [],
      themes: this.sanitizeThemes(record.themes) ?? [],
      relations: this.sanitizeRelations(record.relations) ?? [],
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

  private sanitizePeople(value: unknown): KnowledgePerson[] | undefined {
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
        };
      })
      .filter((item): item is KnowledgePerson => item !== null);
    return people.length ? people : undefined;
  }

  private sanitizeIdeas(value: unknown): KnowledgeIdea[] | undefined {
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
        };
      })
      .filter((item): item is KnowledgeIdea => item !== null);
    return ideas.length ? ideas : undefined;
  }

  private sanitizeEvents(value: unknown): KnowledgeEvent[] | undefined {
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
        };
      })
      .filter((item): item is KnowledgeEvent => item !== null);
    return events.length ? events : undefined;
  }

  private sanitizeEntities(value: unknown): KnowledgeEntity[] | undefined {
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
        };
      })
      .filter((item): item is KnowledgeEntity => item !== null);
    return entities.length ? entities : undefined;
  }

  private sanitizeThemes(value: unknown): KnowledgeTheme[] | undefined {
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
        };
      })
      .filter((item): item is KnowledgeTheme => item !== null);
    return themes.length ? themes : undefined;
  }

  private sanitizeRelations(value: unknown): KnowledgeRelation[] | undefined {
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
        };
      })
      .filter((item): item is KnowledgeRelation => item !== null);
    return relations.length ? relations : undefined;
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
