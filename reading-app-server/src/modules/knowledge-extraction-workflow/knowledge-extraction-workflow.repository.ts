import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AnalyzeKnowledgeExtractionData,
  KnowledgeEntity,
  KnowledgeEvidence,
  KnowledgeEvent,
  KnowledgeIdea,
  KnowledgePerson,
  KnowledgeRelation,
  KnowledgeTheme,
} from '../../../../packages/contracts/src';
import type {
  BookModelEvidenceRefDto,
  BookModelNodeType,
  ChapterToGlobalLinkDto,
  GlobalEntityDto,
  GlobalEventDto,
  GlobalIdeaDto,
  GlobalPersonDto,
  GlobalRelationDto,
  GlobalThemeDto,
  KeyInformationDto,
} from '../book-ingestion/book-model.dto';
import { workflowLog } from '../workflow.logger';
import { SurrealService } from '../surrealDB/surrealdb.service';
import type {
  KnowledgeExtractionWorkflowResultPayload,
  KnowledgeExtractionWorkflowRunRecord,
  KnowledgeExtractionWorkflowStoredResult,
  SubmitKnowledgeExtractionWorkflowInput,
} from './knowledge-extraction-workflow.types';

const chapterKey = (bookId: string, chapterId: string): string => `${bookId}::${chapterId}`;

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const encodeSegment = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const stableLocalId = (prefix: string, seed: string): string => `${prefix}_${encodeSegment(seed)}`;

type KnowledgeNodeType = KnowledgeRelation['from_type'];
type PersistTable =
  | 'workflow_run'
  | 'chapter_knowledge_snapshot'
  | 'book'
  | 'chapter'
  | 'person'
  | 'concept'
  | 'theme'
  | 'entity'
  | 'event'
  | 'appears_in'
  | 'related_to'
  | 'part_of';

type ChapterCounts = {
  peopleCount: number;
  ideaCount: number;
  eventCount: number;
  entityCount: number;
  themeCount: number;
  relationCount: number;
};

interface BookGraphRecord {
  recordId: string;
  bookId: string;
}

interface ChapterGraphRecord {
  recordId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  title?: string;
}

interface PersonGraphRecord {
  recordId: string;
  localId: string;
  name: string;
  normalizedName: string;
  aliases?: string[];
  description?: string;
  roles?: string[];
  traits?: string[];
  evidence?: KnowledgeEvidence[];
}

interface ConceptGraphRecord {
  recordId: string;
  localId: string;
  label: string;
  normalizedLabel: string;
  description?: string;
  kind?: KnowledgeIdea['kind'];
  evidence?: KnowledgeEvidence[];
}

interface ThemeGraphRecord {
  recordId: string;
  localId: string;
  label: string;
  normalizedLabel: string;
  description?: string;
  strength?: number;
  evidence?: KnowledgeEvidence[];
}

interface EntityGraphRecord {
  recordId: string;
  localId: string;
  label: string;
  normalizedLabel: string;
  entityType: KnowledgeEntity['type'];
  description?: string;
  evidence?: KnowledgeEvidence[];
}

interface EventGraphRecord {
  recordId: string;
  localId: string;
  label: string;
  normalizedLabel: string;
  bookId: string;
  chapterId: string;
  description?: string;
  participantRecordIds?: string[];
  timeHint?: string;
  placeHint?: string;
  evidence?: KnowledgeEvidence[];
}

type NodeGraphRecord =
  | PersonGraphRecord
  | ConceptGraphRecord
  | ThemeGraphRecord
  | EntityGraphRecord
  | EventGraphRecord;

interface BaseAppearanceRecord {
  recordId: string;
  in: string;
  out: string;
  chapterRecordId: string;
  nodeRecordId: string;
  nodeType: KnowledgeNodeType;
  localId: string;
}

interface PersonAppearanceRecord extends BaseAppearanceRecord {
  nodeType: 'person';
  name: string;
  aliases?: string[];
  description?: string;
  roles?: string[];
  traits?: string[];
  evidence?: KnowledgeEvidence[];
}

interface IdeaAppearanceRecord extends BaseAppearanceRecord {
  nodeType: 'idea';
  label: string;
  description?: string;
  kind?: KnowledgeIdea['kind'];
  evidence?: KnowledgeEvidence[];
}

interface ThemeAppearanceRecord extends BaseAppearanceRecord {
  nodeType: 'theme';
  label: string;
  description?: string;
  strength?: number;
  evidence?: KnowledgeEvidence[];
}

interface EntityAppearanceRecord extends BaseAppearanceRecord {
  nodeType: 'entity';
  label: string;
  entityType: KnowledgeEntity['type'];
  description?: string;
  evidence?: KnowledgeEvidence[];
}

interface EventAppearanceRecord extends BaseAppearanceRecord {
  nodeType: 'event';
  label: string;
  description?: string;
  participantRecordIds?: string[];
  timeHint?: string;
  placeHint?: string;
  evidence?: KnowledgeEvidence[];
}

type NodeAppearanceRecord =
  | PersonAppearanceRecord
  | IdeaAppearanceRecord
  | ThemeAppearanceRecord
  | EntityAppearanceRecord
  | EventAppearanceRecord;

interface RelationGraphRecord {
  recordId: string;
  in: string;
  out: string;
  localId: string;
  chapterRecordId: string;
  fromRecordId: string;
  fromType: KnowledgeRelation['from_type'];
  toRecordId: string;
  toType: KnowledgeRelation['to_type'];
  relationType: KnowledgeRelation['relation_type'];
  description?: string;
  confidence?: number;
  evidence?: KnowledgeEvidence[];
}

interface PartOfGraphRecord {
  recordId: string;
  in: string;
  out: string;
  chapterRecordId: string;
  bookRecordId: string;
}

interface UpsertPageExtractionInput {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  extraction: AnalyzeKnowledgeExtractionData;
}

@Injectable()
export class KnowledgeExtractionWorkflowRepository implements OnModuleInit {
  private readonly runs = new Map<string, KnowledgeExtractionWorkflowRunRecord>();
  private readonly runIdsByIdempotencyKey = new Map<string, string>();
  private readonly latestResultsByChapter = new Map<string, KnowledgeExtractionWorkflowStoredResult>();

  private readonly books = new Map<string, BookGraphRecord>();
  private readonly chapters = new Map<string, ChapterGraphRecord>();
  private readonly chaptersByKey = new Map<string, string>();
  private readonly people = new Map<string, PersonGraphRecord>();
  private readonly concepts = new Map<string, ConceptGraphRecord>();
  private readonly themes = new Map<string, ThemeGraphRecord>();
  private readonly entities = new Map<string, EntityGraphRecord>();
  private readonly events = new Map<string, EventGraphRecord>();

  private readonly appearances = new Map<string, NodeAppearanceRecord>();
  private readonly appearanceIdsByChapter = new Map<string, Set<string>>();
  private readonly relations = new Map<string, RelationGraphRecord>();
  private readonly relationIdsByChapter = new Map<string, Set<string>>();
  private readonly partOfEdges = new Map<string, PartOfGraphRecord>();

  private pendingPersist: Promise<void> = Promise.resolve();

  constructor(
    @Optional()
    @Inject(SurrealService)
    private readonly surrealService?: SurrealService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.surrealService) return;
    await this.ensureSchema();
    await this.loadFromStore();
  }

  createOrReuseRun(input: SubmitKnowledgeExtractionWorkflowInput): {
    run: KnowledgeExtractionWorkflowRunRecord;
    deduped: boolean;
  } {
    const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
    if (existingRunId) {
      const existingRun = this.runs.get(existingRunId);
      if (existingRun) {
        if (existingRun.status === 'failed' || existingRun.status === 'stale') {
          this.runIdsByIdempotencyKey.delete(input.idempotencyKey);
        } else {
        workflowLog('run.deduped', {
          workflowKind: existingRun.kind,
          workflowRunId: existingRun.id,
          dedupedWorkflowRunId: existingRun.id,
          bookId: existingRun.bookId,
          chapterId: existingRun.chapterId,
          chapterIndex: existingRun.chapterIndex,
          workflowVersion: existingRun.workflowVersion,
          idempotencyKey: existingRun.idempotencyKey,
          status: existingRun.status,
        });
        return {
          run: { ...existingRun, deduped: true },
          deduped: true,
        };
        }
      }
    }

    const timestamp = new Date().toISOString();
    const run: KnowledgeExtractionWorkflowRunRecord = {
      id: randomUUID(),
      kind: 'knowledge_extraction',
      status: 'queued',
      bookId: input.bookId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      workflowVersion: input.workflowVersion,
      idempotencyKey: input.idempotencyKey,
      producer: 'server',
      qualityTier: 'server_final',
      requestedByUserId: input.requestedByUserId,
      expectedSnapshotVersion: input.expectedSnapshotVersion,
      expectedChapterContentHash: input.expectedChapterContentHash,
      deduped: false,
      resultVersion: input.workflowVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.runs.set(run.id, run);
    this.runIdsByIdempotencyKey.set(input.idempotencyKey, run.id);
    this.schedulePersist(() => this.persistRecord('workflow_run', run.id, run));
    workflowLog('run.queued', {
      workflowKind: run.kind,
      workflowRunId: run.id,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      idempotencyKey: run.idempotencyKey,
      requestedByUserId: run.requestedByUserId,
    });

    return { run, deduped: false };
  }

  getRun(workflowRunId: string): KnowledgeExtractionWorkflowRunRecord | null {
    return this.runs.get(workflowRunId) ?? null;
  }

  markRunning(workflowRunId: string): KnowledgeExtractionWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: KnowledgeExtractionWorkflowRunRecord = {
      ...run,
      status: 'running',
      startedAt: run.startedAt ?? timestamp,
      updatedAt: timestamp,
      deduped: false,
    };

    this.runs.set(workflowRunId, updated);
    this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
    workflowLog('run.running', {
      workflowKind: updated.kind,
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      startedAt: updated.startedAt,
    });
    return updated;
  }

  completeRun(args: {
    workflowRunId: string;
    snapshotVersion: number;
    chapterContentHash: string;
    result: KnowledgeExtractionWorkflowResultPayload;
  }): KnowledgeExtractionWorkflowRunRecord | null {
    const run = this.runs.get(args.workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: KnowledgeExtractionWorkflowRunRecord = {
      ...run,
      status: 'completed',
      snapshotVersion: args.snapshotVersion,
      chapterContentHash: args.chapterContentHash,
      output: args.result,
      error: undefined,
      updatedAt: timestamp,
      completedAt: timestamp,
      deduped: false,
    };
    this.runs.set(args.workflowRunId, updated);

    const storedResult: KnowledgeExtractionWorkflowStoredResult = {
      workflowRunId: args.workflowRunId,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      resultVersion: updated.resultVersion,
      producer: updated.producer,
      qualityTier: updated.qualityTier,
      snapshotVersion: args.snapshotVersion,
      chapterContentHash: args.chapterContentHash,
      result: args.result,
      createdAt: updated.createdAt,
      updatedAt: timestamp,
    };

    this.latestResultsByChapter.set(chapterKey(updated.bookId, updated.chapterId), storedResult);
    this.schedulePersist(async () => {
      await this.persistRecord('workflow_run', updated.id, updated);
      await this.persistRecord(
        'chapter_knowledge_snapshot',
        this.makeChapterSnapshotRecordId(updated.bookId, updated.chapterId),
        storedResult,
      );
    });

    workflowLog('run.completed', {
      workflowKind: updated.kind,
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      snapshotVersion: updated.snapshotVersion,
      chapterContentHash: updated.chapterContentHash,
      peopleCount: args.result.people?.length ?? 0,
      ideaCount: args.result.ideas?.length ?? 0,
      eventCount: args.result.events?.length ?? 0,
      entityCount: args.result.entities?.length ?? 0,
      themeCount: args.result.themes?.length ?? 0,
      relationCount: args.result.relations?.length ?? 0,
      completedAt: updated.completedAt,
    });

    return updated;
  }

  failRun(workflowRunId: string, code: string, message: string): KnowledgeExtractionWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'failed', code, message);
  }

  markStale(workflowRunId: string, code: string, message: string): KnowledgeExtractionWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'stale', code, message);
  }

  getLatestResult(bookId: string, chapterId: string): KnowledgeExtractionWorkflowStoredResult | null {
    return this.latestResultsByChapter.get(chapterKey(bookId, chapterId)) ?? null;
  }

  async ensureSchema(): Promise<void> {
    if (!this.surrealService) return;

    const statements = [
      'DEFINE TABLE IF NOT EXISTS workflow_run SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS chapter_knowledge_snapshot SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS book SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS chapter SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS person SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS concept SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS theme SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS entity SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS event SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS appears_in TYPE RELATION SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS related_to TYPE RELATION SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS part_of TYPE RELATION SCHEMALESS;',
    ].join('\n');

    await this.surrealService.query<unknown>(statements);
  }

  async upsertPageExtraction(input: UpsertPageExtractionInput): Promise<ChapterCounts> {
    const persistBatch = new Map<string, { table: PersistTable; id: string; record: object }>();
    const bookRecord = this.upsertBook(input.bookId, persistBatch);
    const chapterRecord = this.upsertChapter(input, persistBatch);
    this.upsertPartOf(bookRecord, chapterRecord, persistBatch);

    const remap = this.createEmptyIdRemap();

    for (const person of input.extraction.people) {
      const personRecord = this.upsertPerson(person, persistBatch);
      remap.person.set(person.local_id, personRecord.recordId);
      this.upsertPersonAppearance(chapterRecord, personRecord, person, persistBatch);
    }

    for (const idea of input.extraction.ideas) {
      const conceptRecord = this.upsertConcept(idea, persistBatch);
      remap.idea.set(idea.local_id, conceptRecord.recordId);
      this.upsertIdeaAppearance(chapterRecord, conceptRecord, idea, persistBatch);
    }

    for (const entity of input.extraction.entities) {
      const entityRecord = this.upsertEntity(entity, persistBatch);
      remap.entity.set(entity.local_id, entityRecord.recordId);
      this.upsertEntityAppearance(chapterRecord, entityRecord, entity, persistBatch);
    }

    for (const theme of input.extraction.themes) {
      const themeRecord = this.upsertTheme(theme, persistBatch);
      remap.theme.set(theme.local_id, themeRecord.recordId);
      this.upsertThemeAppearance(chapterRecord, themeRecord, theme, persistBatch);
    }

    for (const event of input.extraction.events) {
      const participantRecordIds = this.remapNodeIds(event.participant_local_ids, remap.person);
      const eventRecord = this.upsertEvent(input, event, participantRecordIds, persistBatch);
      remap.event.set(event.local_id, eventRecord.recordId);
      this.upsertEventAppearance(chapterRecord, eventRecord, event, participantRecordIds, persistBatch);
    }

    for (const relation of input.extraction.relations) {
      const fromRecordId = this.remapNodeId(relation.from_type, relation.from_id, remap);
      const toRecordId = this.remapNodeId(relation.to_type, relation.to_id, remap);
      if (!fromRecordId || !toRecordId) {
        continue;
      }
      this.upsertRelation(chapterRecord, {
        ...relation,
        from_id: fromRecordId,
        to_id: toRecordId,
      }, persistBatch);
    }

    await this.persistBatch(persistBatch);
    return this.countChapter(chapterRecord.recordId);
  }

  async buildChapterSnapshot(bookId: string, chapterId: string): Promise<AnalyzeKnowledgeExtractionData> {
    const chapterRecordId = this.chaptersByKey.get(chapterKey(bookId, chapterId));
    const chapterRecord = chapterRecordId ? this.chapters.get(chapterRecordId) : null;
    if (!chapterRecordId || !chapterRecord) {
      return {
        title: `Chapter ${chapterId}`,
        summary: '',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      };
    }

    const appearanceIds = Array.from(this.appearanceIdsByChapter.get(chapterRecordId) ?? []);
    const appearances = appearanceIds
      .map((appearanceId) => this.appearances.get(appearanceId))
      .filter((item): item is NodeAppearanceRecord => item !== undefined);
    const localIdsByNodeRecordId = new Map(appearances.map((appearance) => [appearance.nodeRecordId, appearance.localId]));

    const people = appearances
      .filter((appearance): appearance is PersonAppearanceRecord => appearance.nodeType === 'person')
      .map((appearance) => ({
        local_id: appearance.localId,
        name: appearance.name,
        aliases: this.sortStrings(appearance.aliases),
        description: appearance.description,
        roles: this.sortStrings(appearance.roles),
        traits: this.sortStrings(appearance.traits),
        evidence: this.sortEvidence(appearance.evidence),
      }))
      .sort((left, right) => this.compareStrings(left.name, right.name, left.local_id, right.local_id));

    const ideas = appearances
      .filter((appearance): appearance is IdeaAppearanceRecord => appearance.nodeType === 'idea')
      .map((appearance) => ({
        local_id: appearance.localId,
        label: appearance.label,
        description: appearance.description,
        kind: appearance.kind ?? 'claim',
        evidence: this.sortEvidence(appearance.evidence),
      }))
      .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));

    const events = appearances
      .filter((appearance): appearance is EventAppearanceRecord => appearance.nodeType === 'event')
      .map((appearance) => ({
        local_id: appearance.localId,
        label: appearance.label,
        description: appearance.description,
        participant_local_ids: this.sortStrings(
          appearance.participantRecordIds?.map((participantRecordId) => localIdsByNodeRecordId.get(participantRecordId) ?? participantRecordId),
        ),
        time_hint: appearance.timeHint,
        place_hint: appearance.placeHint,
        evidence: this.sortEvidence(appearance.evidence),
      }))
      .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));

    const entities = appearances
      .filter((appearance): appearance is EntityAppearanceRecord => appearance.nodeType === 'entity')
      .map((appearance) => ({
        local_id: appearance.localId,
        label: appearance.label,
        type: appearance.entityType,
        description: appearance.description,
        evidence: this.sortEvidence(appearance.evidence),
      }))
      .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));

    const themes = appearances
      .filter((appearance): appearance is ThemeAppearanceRecord => appearance.nodeType === 'theme')
      .map((appearance) => ({
        local_id: appearance.localId,
        label: appearance.label,
        strength: appearance.strength,
        description: appearance.description,
        evidence: this.sortEvidence(appearance.evidence),
      }))
      .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));

    const relations = Array.from(this.relationIdsByChapter.get(chapterRecordId) ?? [])
      .map((relationId) => this.relations.get(relationId))
      .filter((relation): relation is RelationGraphRecord => relation !== undefined)
      .map((relation): KnowledgeRelation | null => {
        const fromLocalId = localIdsByNodeRecordId.get(relation.fromRecordId);
        const toLocalId = localIdsByNodeRecordId.get(relation.toRecordId);
        if (!fromLocalId || !toLocalId) return null;
        return {
          local_id: relation.localId,
          from_id: fromLocalId,
          from_type: relation.fromType,
          to_id: toLocalId,
          to_type: relation.toType,
          relation_type: relation.relationType,
          description: relation.description,
          confidence: relation.confidence,
          evidence: this.sortEvidence(relation.evidence),
        };
      })
      .filter((relation): relation is KnowledgeRelation => relation !== null)
      .sort((left, right) => this.compareStrings(
        `${left.from_type}:${left.from_id}:${left.relation_type}:${left.to_type}:${left.to_id}`,
        `${right.from_type}:${right.from_id}:${right.relation_type}:${right.to_type}:${right.to_id}`,
        left.local_id,
        right.local_id,
      ));

    return {
      title: chapterRecord.title ?? `Chapter ${chapterId}`,
      summary: '',
      people,
      ideas,
      events,
      entities,
      themes,
      relations,
    };
  }

  private createSlimResult(result: KnowledgeExtractionWorkflowResultPayload): KnowledgeExtractionWorkflowResultPayload {
    return {
      title: result.title,
      summary: result.summary,
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    };
  }

  buildBookKeyInformation(bookId: string): KeyInformationDto {
    const chapterRecords = Array.from(this.chapters.values())
      .filter((chapter) => chapter.bookId === bookId)
      .sort((left, right) => {
        const chapterDelta = left.chapterIndex - right.chapterIndex;
        if (chapterDelta !== 0) return chapterDelta;
        return left.chapterId.localeCompare(right.chapterId);
      });
    if (chapterRecords.length === 0) {
      return {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
        arcs: [],
        ideaFlows: [],
        links: [],
      };
    }

    const chapterByRecordId = new Map(chapterRecords.map((chapter) => [chapter.recordId, chapter]));
    const chapterRecordIds = new Set(chapterRecords.map((chapter) => chapter.recordId));
    const appearances = chapterRecords
      .flatMap((chapter) => Array.from(this.appearanceIdsByChapter.get(chapter.recordId) ?? []))
      .map((appearanceId) => this.appearances.get(appearanceId))
      .filter((appearance): appearance is NodeAppearanceRecord => Boolean(appearance));
    const relations = chapterRecords
      .flatMap((chapter) => Array.from(this.relationIdsByChapter.get(chapter.recordId) ?? []))
      .map((relationId) => this.relations.get(relationId))
      .filter((relation): relation is RelationGraphRecord => Boolean(relation));

    const eventGlobalIdsByRecordId = new Map<string, string>();
    for (const appearance of appearances) {
      if (appearance.nodeType !== 'event') continue;
      const eventRecord = this.events.get(appearance.nodeRecordId);
      const normalizedLabel = eventRecord?.normalizedLabel ?? normalizeText(appearance.label);
      eventGlobalIdsByRecordId.set(
        appearance.nodeRecordId,
        this.makeBookEventProjectionId(bookId, normalizedLabel),
      );
    }

    const people = this.buildGlobalPeople(appearances, chapterByRecordId);
    const ideas = this.buildGlobalIdeas(appearances, chapterByRecordId);
    const entities = this.buildGlobalEntities(appearances, chapterByRecordId);
    const themes = this.buildGlobalThemes(appearances, chapterByRecordId);
    const events = this.buildGlobalEvents(appearances, chapterByRecordId, eventGlobalIdsByRecordId);

    const projectionByNodeRecordId = new Map<string, { id: string; type: BookModelNodeType }>();
    for (const appearance of appearances) {
      if (!chapterRecordIds.has(appearance.chapterRecordId)) continue;
      const projection = this.resolveProjectionNode(
        appearance.nodeType,
        appearance.nodeRecordId,
        eventGlobalIdsByRecordId,
      );
      if (projection) {
        projectionByNodeRecordId.set(appearance.nodeRecordId, projection);
      }
    }

    const relationsByKey = new Map<string, GlobalRelationDto>();
    for (const relation of relations) {
      const chapter = chapterByRecordId.get(relation.chapterRecordId);
      if (!chapter) continue;
      const fromProjection = projectionByNodeRecordId.get(relation.fromRecordId);
      const toProjection = projectionByNodeRecordId.get(relation.toRecordId);
      if (!fromProjection || !toProjection) continue;

      const relationKey = [
        fromProjection.type,
        fromProjection.id,
        relation.relationType,
        toProjection.type,
        toProjection.id,
      ].join('|');
      const existing = relationsByKey.get(relationKey);
      const evidence = this.toBookEvidenceRefs(relation.evidence, chapter);

      if (!existing) {
        relationsByKey.set(relationKey, {
          relationId: this.makeProjectedRelationId(relationKey),
          fromId: fromProjection.id,
          fromType: fromProjection.type,
          toId: toProjection.id,
          toType: toProjection.type,
          relationType: relation.relationType,
          description: relation.description,
          firstSeenIn: chapter.chapterIndex,
          lastSeenIn: chapter.chapterIndex,
          mentionedIn: [chapter.chapterIndex],
          confidence: relation.confidence,
          evidence,
        });
        continue;
      }

      relationsByKey.set(relationKey, {
        ...existing,
        description: this.pickPreferredText(existing.description, relation.description),
        firstSeenIn: Math.min(existing.firstSeenIn, chapter.chapterIndex),
        lastSeenIn: Math.max(existing.lastSeenIn, chapter.chapterIndex),
        mentionedIn: this.sortNumbers([...existing.mentionedIn, chapter.chapterIndex]),
        confidence: this.maxNumber(existing.confidence, relation.confidence),
        evidence: this.sortBookEvidenceRefs(this.mergeBookEvidenceRefs(existing.evidence, evidence)),
      });
    }

    const entityTypeById = new Map(entities.map((entity) => [entity.entityId, entity.type]));
    const eventById = new Map(events.map((event) => [event.eventId, event]));
    for (const relation of relationsByKey.values()) {
      if (relation.relationType === 'participates_in'
        && relation.fromType === 'person'
        && relation.toType === 'event') {
        const event = eventById.get(relation.toId);
        if (event) {
          event.participantIds = this.sortStringsStrict([...event.participantIds, relation.fromId]);
        }
      }

      if (relation.fromType === 'event' && relation.toType === 'entity') {
        const event = eventById.get(relation.fromId);
        if (!event) continue;

        if (relation.relationType === 'located_in' && entityTypeById.get(relation.toId) === 'place') {
          event.placeEntityId = event.placeEntityId ?? relation.toId;
        }
        if (relation.relationType === 'happens_at' && entityTypeById.get(relation.toId) === 'time') {
          event.timeEntityId = event.timeEntityId ?? relation.toId;
        }
      }
    }

    const links = appearances
      .map((appearance): ChapterToGlobalLinkDto | null => {
        const chapter = chapterByRecordId.get(appearance.chapterRecordId);
        const projection = projectionByNodeRecordId.get(appearance.nodeRecordId);
        if (!chapter || !projection) return null;
        return {
          chapterId: chapter.chapterId,
          chapterIndex: chapter.chapterIndex,
          localId: appearance.localId,
          localType: appearance.nodeType,
          globalId: projection.id,
          globalType: projection.type,
          linkType: 'semantic',
          confidence: this.linkConfidence(appearance.nodeType),
        };
      })
      .filter((link): link is ChapterToGlobalLinkDto => Boolean(link));

    return {
      people,
      ideas,
      events: events.sort((left, right) => this.compareStrings(
        left.canonicalLabel,
        right.canonicalLabel,
        left.eventId,
        right.eventId,
      )),
      entities,
      themes,
      relations: Array.from(relationsByKey.values()).sort((left, right) => this.compareStrings(
        `${left.fromType}:${left.fromId}:${left.relationType}:${left.toType}:${left.toId}`,
        `${right.fromType}:${right.fromId}:${right.relationType}:${right.toType}:${right.toId}`,
        left.relationId,
        right.relationId,
      )),
      arcs: [],
      ideaFlows: [],
      links: this.deduplicateChapterLinks(links),
    };
  }

  private finishWithError(
    workflowRunId: string,
    status: 'failed' | 'stale',
    code: string,
    message: string,
  ): KnowledgeExtractionWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: KnowledgeExtractionWorkflowRunRecord = {
      ...run,
      status,
      error: { code, message },
      updatedAt: timestamp,
      completedAt: timestamp,
      deduped: false,
    };
    this.runs.set(workflowRunId, updated);
    this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
    workflowLog(`run.${status}`, {
      workflowKind: updated.kind,
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      errorCode: code,
      errorMessage: message,
      completedAt: updated.completedAt,
    });
    return updated;
  }

  private async loadFromStore(): Promise<void> {
    if (!this.surrealService) return;

    const [
      workflowRuns,
      snapshots,
      books,
      chapters,
      people,
      concepts,
      themes,
      entities,
      events,
      appearances,
      relations,
      partOfEdges,
    ] = await Promise.all([
      this.surrealService.selectTable<KnowledgeExtractionWorkflowRunRecord>('workflow_run'),
      this.surrealService.selectTable<KnowledgeExtractionWorkflowStoredResult>('chapter_knowledge_snapshot'),
      this.surrealService.selectTable<BookGraphRecord>('book'),
      this.surrealService.selectTable<ChapterGraphRecord>('chapter'),
      this.surrealService.selectTable<PersonGraphRecord>('person'),
      this.surrealService.selectTable<ConceptGraphRecord>('concept'),
      this.surrealService.selectTable<ThemeGraphRecord>('theme'),
      this.surrealService.selectTable<EntityGraphRecord>('entity'),
      this.surrealService.selectTable<EventGraphRecord>('event'),
      this.surrealService.selectTable<NodeAppearanceRecord>('appears_in'),
      this.surrealService.selectTable<RelationGraphRecord>('related_to'),
      this.surrealService.selectTable<PartOfGraphRecord>('part_of'),
    ]);

    this.runs.clear();
    this.runIdsByIdempotencyKey.clear();
    this.latestResultsByChapter.clear();
    this.books.clear();
    this.chapters.clear();
    this.chaptersByKey.clear();
    this.people.clear();
    this.concepts.clear();
    this.themes.clear();
    this.entities.clear();
    this.events.clear();
    this.appearances.clear();
    this.appearanceIdsByChapter.clear();
    this.relations.clear();
    this.relationIdsByChapter.clear();
    this.partOfEdges.clear();

    for (const book of books) this.books.set(book.recordId, book);
    for (const chapter of chapters) {
      this.chapters.set(chapter.recordId, chapter);
      this.chaptersByKey.set(chapterKey(chapter.bookId, chapter.chapterId), chapter.recordId);
    }
    for (const person of people) this.people.set(person.recordId, person);
    for (const concept of concepts) this.concepts.set(concept.recordId, concept);
    for (const theme of themes) this.themes.set(theme.recordId, theme);
    for (const entity of entities) this.entities.set(entity.recordId, entity);
    for (const event of events) this.events.set(event.recordId, event);
    for (const appearance of appearances) {
      this.appearances.set(appearance.recordId, appearance);
      this.ensureSet(this.appearanceIdsByChapter, appearance.chapterRecordId).add(appearance.recordId);
    }
    for (const relation of relations) {
      this.relations.set(relation.recordId, relation);
      this.ensureSet(this.relationIdsByChapter, relation.chapterRecordId).add(relation.recordId);
    }
    for (const partOfEdge of partOfEdges) this.partOfEdges.set(partOfEdge.recordId, partOfEdge);

    const rebuiltSnapshots = new Map<string, KnowledgeExtractionWorkflowStoredResult>();
    for (const snapshot of snapshots) {
      const rebuiltResult = await this.buildChapterSnapshot(snapshot.bookId, snapshot.chapterId);
      const persistedResult = snapshot.result;
      if (persistedResult?.title) rebuiltResult.title = persistedResult.title;
      if (persistedResult?.summary) rebuiltResult.summary = persistedResult.summary;
      const hydratedSnapshot: KnowledgeExtractionWorkflowStoredResult = {
        ...snapshot,
        result: rebuiltResult,
      };
      rebuiltSnapshots.set(chapterKey(snapshot.bookId, snapshot.chapterId), hydratedSnapshot);
      this.latestResultsByChapter.set(chapterKey(snapshot.bookId, snapshot.chapterId), hydratedSnapshot);
    }

    for (const run of workflowRuns) {
      const rebuiltSnapshot = rebuiltSnapshots.get(chapterKey(run.bookId, run.chapterId));
      const hydratedRun: KnowledgeExtractionWorkflowRunRecord = (
        run.status === 'completed'
        && rebuiltSnapshot
        && run.snapshotVersion === rebuiltSnapshot.snapshotVersion
        && run.chapterContentHash === rebuiltSnapshot.chapterContentHash
      )
        ? {
            ...run,
            output: rebuiltSnapshot.result,
          }
        : run;
      this.runs.set(hydratedRun.id, hydratedRun);
      this.runIdsByIdempotencyKey.set(hydratedRun.idempotencyKey, hydratedRun.id);
    }
  }

  private upsertBook(
    bookId: string,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): BookGraphRecord {
    const recordId = this.makeBookRecordId(bookId);
    const existing = this.books.get(recordId);
    if (existing) return existing;

    const created: BookGraphRecord = { recordId, bookId };
    this.books.set(recordId, created);
    this.addToPersistBatch(persistBatch, 'book', recordId, created);
    return created;
  }

  private upsertChapter(
    input: Pick<UpsertPageExtractionInput, 'bookId' | 'chapterId' | 'chapterIndex' | 'chapterTitle'>,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): ChapterGraphRecord {
    const recordId = this.makeChapterRecordId(input.bookId, input.chapterId);
    const existing = this.chapters.get(recordId);
    if (existing) {
      const updated: ChapterGraphRecord = {
        ...existing,
        chapterIndex: input.chapterIndex,
        title: existing.title ?? input.chapterTitle,
      };
      this.chapters.set(recordId, updated);
      this.chaptersByKey.set(chapterKey(input.bookId, input.chapterId), recordId);
      this.addToPersistBatch(persistBatch, 'chapter', recordId, updated);
      return updated;
    }

    const created: ChapterGraphRecord = {
      recordId,
      bookId: input.bookId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      title: input.chapterTitle,
    };
    this.chapters.set(recordId, created);
    this.chaptersByKey.set(chapterKey(input.bookId, input.chapterId), recordId);
    this.addToPersistBatch(persistBatch, 'chapter', recordId, created);
    return created;
  }

  private upsertPartOf(
    bookRecord: BookGraphRecord,
    chapterRecord: ChapterGraphRecord,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): void {
    const recordId = this.makePartOfRecordId(bookRecord.recordId, chapterRecord.recordId);
    if (this.partOfEdges.has(recordId)) return;

    const edge: PartOfGraphRecord = {
      recordId,
      in: this.makeChapterRef(chapterRecord.recordId),
      out: this.makeBookRef(bookRecord.recordId),
      bookRecordId: bookRecord.recordId,
      chapterRecordId: chapterRecord.recordId,
    };
    this.partOfEdges.set(recordId, edge);
    this.addToPersistBatch(persistBatch, 'part_of', recordId, edge);
  }

  private upsertPerson(
    person: KnowledgePerson,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): PersonGraphRecord {
    const normalizedName = normalizeText(person.name);
    const recordId = this.makeGlobalRecordId('person', normalizedName);
    const existing = this.people.get(recordId);
    if (!existing) {
      const created: PersonGraphRecord = {
        recordId,
        localId: stableLocalId('p', normalizedName),
        name: person.name,
        normalizedName,
        aliases: this.mergeStringArrays(undefined, person.aliases),
        description: person.description,
        roles: this.mergeStringArrays(undefined, person.roles),
        traits: this.mergeStringArrays(undefined, person.traits),
        evidence: this.mergeEvidence(undefined, person.evidence),
      };
      this.people.set(recordId, created);
      this.addToPersistBatch(persistBatch, 'person', recordId, created);
      return created;
    }

    const updated: PersonGraphRecord = {
      ...existing,
      aliases: this.mergeStringArrays(existing.aliases, person.aliases),
      description: existing.description ?? person.description,
      roles: this.mergeStringArrays(existing.roles, person.roles),
      traits: this.mergeStringArrays(existing.traits, person.traits),
      evidence: this.mergeEvidence(existing.evidence, person.evidence),
    };
    this.people.set(recordId, updated);
    this.addToPersistBatch(persistBatch, 'person', recordId, updated);
    return updated;
  }

  private upsertConcept(
    idea: KnowledgeIdea,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): ConceptGraphRecord {
    const normalizedLabel = normalizeText(idea.label);
    const recordId = this.makeGlobalRecordId('concept', normalizedLabel);
    const existing = this.concepts.get(recordId);
    if (!existing) {
      const created: ConceptGraphRecord = {
        recordId,
        localId: stableLocalId('i', normalizedLabel),
        label: idea.label,
        normalizedLabel,
        description: idea.description,
        kind: idea.kind,
        evidence: this.mergeEvidence(undefined, idea.evidence),
      };
      this.concepts.set(recordId, created);
      this.addToPersistBatch(persistBatch, 'concept', recordId, created);
      return created;
    }

    const updated: ConceptGraphRecord = {
      ...existing,
      description: existing.description ?? idea.description,
      kind: existing.kind ?? idea.kind,
      evidence: this.mergeEvidence(existing.evidence, idea.evidence),
    };
    this.concepts.set(recordId, updated);
    this.addToPersistBatch(persistBatch, 'concept', recordId, updated);
    return updated;
  }

  private upsertTheme(
    theme: KnowledgeTheme,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): ThemeGraphRecord {
    const normalizedLabel = normalizeText(theme.label);
    const recordId = this.makeGlobalRecordId('theme', normalizedLabel);
    const existing = this.themes.get(recordId);
    if (!existing) {
      const created: ThemeGraphRecord = {
        recordId,
        localId: stableLocalId('t', normalizedLabel),
        label: theme.label,
        normalizedLabel,
        description: theme.description,
        strength: theme.strength,
        evidence: this.mergeEvidence(undefined, theme.evidence),
      };
      this.themes.set(recordId, created);
      this.addToPersistBatch(persistBatch, 'theme', recordId, created);
      return created;
    }

    const updated: ThemeGraphRecord = {
      ...existing,
      description: existing.description ?? theme.description,
      strength: this.maxNumber(existing.strength, theme.strength),
      evidence: this.mergeEvidence(existing.evidence, theme.evidence),
    };
    this.themes.set(recordId, updated);
    this.addToPersistBatch(persistBatch, 'theme', recordId, updated);
    return updated;
  }

  private upsertEntity(
    entity: KnowledgeEntity,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): EntityGraphRecord {
    const normalizedLabel = normalizeText(entity.label);
    const recordId = this.makeEntityRecordId(entity.type, normalizedLabel);
    const existing = this.entities.get(recordId);
    if (!existing) {
      const created: EntityGraphRecord = {
        recordId,
        localId: stableLocalId('n', `${entity.type}:${normalizedLabel}`),
        label: entity.label,
        normalizedLabel,
        entityType: entity.type,
        description: entity.description,
        evidence: this.mergeEvidence(undefined, entity.evidence),
      };
      this.entities.set(recordId, created);
      this.addToPersistBatch(persistBatch, 'entity', recordId, created);
      return created;
    }

    const updated: EntityGraphRecord = {
      ...existing,
      description: existing.description ?? entity.description,
      evidence: this.mergeEvidence(existing.evidence, entity.evidence),
    };
    this.entities.set(recordId, updated);
    this.addToPersistBatch(persistBatch, 'entity', recordId, updated);
    return updated;
  }

  private upsertEvent(
    input: Pick<UpsertPageExtractionInput, 'bookId' | 'chapterId'>,
    event: KnowledgeEvent,
    participantRecordIds: string[] | undefined,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): EventGraphRecord {
    const normalizedLabel = normalizeText(event.label);
    const recordId = this.makeEventRecordId(input.bookId, input.chapterId, normalizedLabel);
    const existing = this.events.get(recordId);
    if (!existing) {
      const created: EventGraphRecord = {
        recordId,
        localId: stableLocalId('e', `${input.bookId}:${input.chapterId}:${normalizedLabel}`),
        label: event.label,
        normalizedLabel,
        bookId: input.bookId,
        chapterId: input.chapterId,
        description: event.description,
        participantRecordIds: this.mergeStringArrays(undefined, participantRecordIds),
        timeHint: event.time_hint,
        placeHint: event.place_hint,
        evidence: this.mergeEvidence(undefined, event.evidence),
      };
      this.events.set(recordId, created);
      this.addToPersistBatch(persistBatch, 'event', recordId, created);
      return created;
    }

    const updated: EventGraphRecord = {
      ...existing,
      description: existing.description ?? event.description,
      participantRecordIds: this.mergeStringArrays(existing.participantRecordIds, participantRecordIds),
      timeHint: existing.timeHint ?? event.time_hint,
      placeHint: existing.placeHint ?? event.place_hint,
      evidence: this.mergeEvidence(existing.evidence, event.evidence),
    };
    this.events.set(recordId, updated);
    this.addToPersistBatch(persistBatch, 'event', recordId, updated);
    return updated;
  }

  private upsertPersonAppearance(
    chapterRecord: ChapterGraphRecord,
    personRecord: PersonGraphRecord,
    person: KnowledgePerson,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): void {
    const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, personRecord.recordId);
    const existing = this.appearances.get(recordId) as PersonAppearanceRecord | undefined;
    const updated: PersonAppearanceRecord = existing
      ? {
        ...existing,
        aliases: this.mergeStringArrays(existing.aliases, person.aliases),
        description: existing.description ?? person.description,
        roles: this.mergeStringArrays(existing.roles, person.roles),
        traits: this.mergeStringArrays(existing.traits, person.traits),
        evidence: this.mergeEvidence(existing.evidence, person.evidence),
      }
      : {
        recordId,
        in: this.makePersonRef(personRecord.recordId),
        out: this.makeChapterRef(chapterRecord.recordId),
        chapterRecordId: chapterRecord.recordId,
        nodeRecordId: personRecord.recordId,
        nodeType: 'person',
        localId: personRecord.localId,
        name: personRecord.name,
        aliases: this.mergeStringArrays(undefined, person.aliases),
        description: person.description,
        roles: this.mergeStringArrays(undefined, person.roles),
        traits: this.mergeStringArrays(undefined, person.traits),
        evidence: this.mergeEvidence(undefined, person.evidence),
      };

    this.appearances.set(recordId, updated);
    this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
    this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
  }

  private upsertIdeaAppearance(
    chapterRecord: ChapterGraphRecord,
    conceptRecord: ConceptGraphRecord,
    idea: KnowledgeIdea,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): void {
    const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, conceptRecord.recordId);
    const existing = this.appearances.get(recordId) as IdeaAppearanceRecord | undefined;
    const updated: IdeaAppearanceRecord = existing
      ? {
        ...existing,
        description: existing.description ?? idea.description,
        kind: existing.kind ?? idea.kind,
        evidence: this.mergeEvidence(existing.evidence, idea.evidence),
      }
      : {
        recordId,
        in: this.makeConceptRef(conceptRecord.recordId),
        out: this.makeChapterRef(chapterRecord.recordId),
        chapterRecordId: chapterRecord.recordId,
        nodeRecordId: conceptRecord.recordId,
        nodeType: 'idea',
        localId: conceptRecord.localId,
        label: conceptRecord.label,
        description: idea.description,
        kind: idea.kind,
        evidence: this.mergeEvidence(undefined, idea.evidence),
      };

    this.appearances.set(recordId, updated);
    this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
    this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
  }

  private upsertThemeAppearance(
    chapterRecord: ChapterGraphRecord,
    themeRecord: ThemeGraphRecord,
    theme: KnowledgeTheme,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): void {
    const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, themeRecord.recordId);
    const existing = this.appearances.get(recordId) as ThemeAppearanceRecord | undefined;
    const updated: ThemeAppearanceRecord = existing
      ? {
        ...existing,
        description: existing.description ?? theme.description,
        strength: this.maxNumber(existing.strength, theme.strength),
        evidence: this.mergeEvidence(existing.evidence, theme.evidence),
      }
      : {
        recordId,
        in: this.makeThemeRef(themeRecord.recordId),
        out: this.makeChapterRef(chapterRecord.recordId),
        chapterRecordId: chapterRecord.recordId,
        nodeRecordId: themeRecord.recordId,
        nodeType: 'theme',
        localId: themeRecord.localId,
        label: themeRecord.label,
        description: theme.description,
        strength: theme.strength,
        evidence: this.mergeEvidence(undefined, theme.evidence),
      };

    this.appearances.set(recordId, updated);
    this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
    this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
  }

  private upsertEntityAppearance(
    chapterRecord: ChapterGraphRecord,
    entityRecord: EntityGraphRecord,
    entity: KnowledgeEntity,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): void {
    const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, entityRecord.recordId);
    const existing = this.appearances.get(recordId) as EntityAppearanceRecord | undefined;
    const updated: EntityAppearanceRecord = existing
      ? {
        ...existing,
        description: existing.description ?? entity.description,
        evidence: this.mergeEvidence(existing.evidence, entity.evidence),
      }
      : {
        recordId,
        in: this.makeEntityRef(entityRecord.recordId),
        out: this.makeChapterRef(chapterRecord.recordId),
        chapterRecordId: chapterRecord.recordId,
        nodeRecordId: entityRecord.recordId,
        nodeType: 'entity',
        localId: entityRecord.localId,
        label: entityRecord.label,
        entityType: entityRecord.entityType,
        description: entity.description,
        evidence: this.mergeEvidence(undefined, entity.evidence),
      };

    this.appearances.set(recordId, updated);
    this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
    this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
  }

  private upsertEventAppearance(
    chapterRecord: ChapterGraphRecord,
    eventRecord: EventGraphRecord,
    event: KnowledgeEvent,
    participantRecordIds: string[] | undefined,
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): void {
    const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, eventRecord.recordId);
    const existing = this.appearances.get(recordId) as EventAppearanceRecord | undefined;
    const updated: EventAppearanceRecord = existing
      ? {
        ...existing,
        description: existing.description ?? event.description,
        participantRecordIds: this.mergeStringArrays(existing.participantRecordIds, participantRecordIds),
        timeHint: existing.timeHint ?? event.time_hint,
        placeHint: existing.placeHint ?? event.place_hint,
        evidence: this.mergeEvidence(existing.evidence, event.evidence),
      }
      : {
        recordId,
        in: this.makeEventRef(eventRecord.recordId),
        out: this.makeChapterRef(chapterRecord.recordId),
        chapterRecordId: chapterRecord.recordId,
        nodeRecordId: eventRecord.recordId,
        nodeType: 'event',
        localId: eventRecord.localId,
        label: eventRecord.label,
        description: event.description,
        participantRecordIds: this.mergeStringArrays(undefined, participantRecordIds),
        timeHint: event.time_hint,
        placeHint: event.place_hint,
        evidence: this.mergeEvidence(undefined, event.evidence),
      };

    this.appearances.set(recordId, updated);
    this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
    this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
  }

  private upsertRelation(
    chapterRecord: ChapterGraphRecord,
    relation: Omit<KnowledgeRelation, 'local_id'> & { local_id: string },
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): void {
    const recordId = this.makeRelationRecordId(
      chapterRecord.recordId,
      relation.from_id,
      relation.relation_type,
      relation.to_id,
    );
    const existing = this.relations.get(recordId);
    const updated: RelationGraphRecord = existing
      ? {
        ...existing,
        description: existing.description ?? relation.description,
        confidence: this.maxNumber(existing.confidence, relation.confidence),
        evidence: this.mergeEvidence(existing.evidence, relation.evidence),
      }
      : {
        recordId,
        in: this.makeRecordRef(this.tableForNodeType(relation.from_type), relation.from_id),
        out: this.makeRecordRef(this.tableForNodeType(relation.to_type), relation.to_id),
        localId: stableLocalId('r', `${chapterRecord.recordId}:${relation.from_id}:${relation.relation_type}:${relation.to_id}`),
        chapterRecordId: chapterRecord.recordId,
        fromRecordId: relation.from_id,
        fromType: relation.from_type,
        toRecordId: relation.to_id,
        toType: relation.to_type,
        relationType: relation.relation_type,
        description: relation.description,
        confidence: relation.confidence,
        evidence: this.mergeEvidence(undefined, relation.evidence),
      };

    this.relations.set(recordId, updated);
    this.ensureSet(this.relationIdsByChapter, chapterRecord.recordId).add(recordId);
    this.addToPersistBatch(persistBatch, 'related_to', recordId, updated);
  }

  private countChapter(chapterRecordId: string): ChapterCounts {
    const counts: ChapterCounts = {
      peopleCount: 0,
      ideaCount: 0,
      eventCount: 0,
      entityCount: 0,
      themeCount: 0,
      relationCount: this.relationIdsByChapter.get(chapterRecordId)?.size ?? 0,
    };

    for (const appearanceId of this.appearanceIdsByChapter.get(chapterRecordId) ?? []) {
      const appearance = this.appearances.get(appearanceId);
      if (!appearance) continue;
      if (appearance.nodeType === 'person') counts.peopleCount += 1;
      if (appearance.nodeType === 'idea') counts.ideaCount += 1;
      if (appearance.nodeType === 'event') counts.eventCount += 1;
      if (appearance.nodeType === 'entity') counts.entityCount += 1;
      if (appearance.nodeType === 'theme') counts.themeCount += 1;
    }

    return counts;
  }

  private buildGlobalPeople(
    appearances: NodeAppearanceRecord[],
    chapterByRecordId: Map<string, ChapterGraphRecord>,
  ): GlobalPersonDto[] {
    const appearancesByNodeRecordId = new Map<string, PersonAppearanceRecord[]>();
    for (const appearance of appearances) {
      if (appearance.nodeType !== 'person') continue;
      const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
      if (existing) {
        existing.push(appearance);
      } else {
        appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
      }
    }

    return Array.from(appearancesByNodeRecordId.entries())
      .map(([nodeRecordId, personAppearances]): GlobalPersonDto | null => {
        const personRecord = this.people.get(nodeRecordId);
        if (!personRecord) return null;

        const chapterIndexes = personAppearances
          .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
          .filter((chapterIndex): chapterIndex is number => chapterIndex !== undefined);
        if (chapterIndexes.length === 0) return null;

        return {
          personId: personRecord.recordId,
          canonicalName: personRecord.name,
          aliases: this.sortStringsStrict(personRecord.aliases ?? []),
          description: personRecord.description,
          roles: this.sortStringsStrict(personRecord.roles ?? []),
          traits: this.sortStringsStrict(personRecord.traits ?? []),
          firstSeenIn: Math.min(...chapterIndexes),
          lastSeenIn: Math.max(...chapterIndexes),
          mentionedIn: this.sortNumbers(chapterIndexes),
          evidence: this.aggregateAppearanceEvidence(personAppearances, chapterByRecordId),
        };
      })
      .filter((person): person is GlobalPersonDto => Boolean(person))
      .sort((left, right) => this.compareStrings(
        left.canonicalName,
        right.canonicalName,
        left.personId,
        right.personId,
      ));
  }

  private buildGlobalIdeas(
    appearances: NodeAppearanceRecord[],
    chapterByRecordId: Map<string, ChapterGraphRecord>,
  ): GlobalIdeaDto[] {
    const appearancesByNodeRecordId = new Map<string, IdeaAppearanceRecord[]>();
    for (const appearance of appearances) {
      if (appearance.nodeType !== 'idea') continue;
      const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
      if (existing) {
        existing.push(appearance);
      } else {
        appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
      }
    }

    return Array.from(appearancesByNodeRecordId.entries())
      .map(([nodeRecordId, ideaAppearances]): GlobalIdeaDto | null => {
        const conceptRecord = this.concepts.get(nodeRecordId);
        if (!conceptRecord) return null;

        const chapterIndexes = ideaAppearances
          .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
          .filter((chapterIndex): chapterIndex is number => chapterIndex !== undefined);
        if (chapterIndexes.length === 0) return null;

        const variants = this.sortStringsStrict([
          ...(ideaAppearances.map((appearance) => appearance.label)),
        ]).filter((variant) => normalizeText(variant) !== conceptRecord.normalizedLabel);

        return {
          ideaId: conceptRecord.recordId,
          canonicalLabel: conceptRecord.label,
          variants,
          description: conceptRecord.description,
          status: 'introduced',
          firstSeenIn: Math.min(...chapterIndexes),
          lastSeenIn: Math.max(...chapterIndexes),
          mentionedIn: this.sortNumbers(chapterIndexes),
          evidence: this.aggregateAppearanceEvidence(ideaAppearances, chapterByRecordId),
        };
      })
      .filter((idea): idea is GlobalIdeaDto => Boolean(idea))
      .sort((left, right) => this.compareStrings(
        left.canonicalLabel,
        right.canonicalLabel,
        left.ideaId,
        right.ideaId,
      ));
  }

  private buildGlobalEntities(
    appearances: NodeAppearanceRecord[],
    chapterByRecordId: Map<string, ChapterGraphRecord>,
  ): GlobalEntityDto[] {
    const appearancesByNodeRecordId = new Map<string, EntityAppearanceRecord[]>();
    for (const appearance of appearances) {
      if (appearance.nodeType !== 'entity') continue;
      const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
      if (existing) {
        existing.push(appearance);
      } else {
        appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
      }
    }

    return Array.from(appearancesByNodeRecordId.entries())
      .map(([nodeRecordId, entityAppearances]): GlobalEntityDto | null => {
        const entityRecord = this.entities.get(nodeRecordId);
        if (!entityRecord) return null;

        const chapterIndexes = entityAppearances
          .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
          .filter((chapterIndex): chapterIndex is number => chapterIndex !== undefined);
        if (chapterIndexes.length === 0) return null;

        const aliases = this.sortStringsStrict([
          ...(entityRecord.label ? [entityRecord.label] : []),
          ...entityAppearances.map((appearance) => appearance.label),
        ]).filter((alias) => normalizeText(alias) !== entityRecord.normalizedLabel);

        return {
          entityId: entityRecord.recordId,
          canonicalLabel: entityRecord.label,
          type: entityRecord.entityType,
          aliases,
          description: entityRecord.description,
          firstSeenIn: Math.min(...chapterIndexes),
          lastSeenIn: Math.max(...chapterIndexes),
          mentionedIn: this.sortNumbers(chapterIndexes),
          evidence: this.aggregateAppearanceEvidence(entityAppearances, chapterByRecordId),
        };
      })
      .filter((entity): entity is GlobalEntityDto => Boolean(entity))
      .sort((left, right) => this.compareStrings(
        left.canonicalLabel,
        right.canonicalLabel,
        left.entityId,
        right.entityId,
      ));
  }

  private buildGlobalThemes(
    appearances: NodeAppearanceRecord[],
    chapterByRecordId: Map<string, ChapterGraphRecord>,
  ): GlobalThemeDto[] {
    const appearancesByNodeRecordId = new Map<string, ThemeAppearanceRecord[]>();
    for (const appearance of appearances) {
      if (appearance.nodeType !== 'theme') continue;
      const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
      if (existing) {
        existing.push(appearance);
      } else {
        appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
      }
    }

    return Array.from(appearancesByNodeRecordId.entries())
      .map(([nodeRecordId, themeAppearances]): GlobalThemeDto | null => {
        const themeRecord = this.themes.get(nodeRecordId);
        if (!themeRecord) return null;

        const chapterIndexes = themeAppearances
          .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
          .filter((chapterIndex): chapterIndex is number => chapterIndex !== undefined);
        if (chapterIndexes.length === 0) return null;

        const variants = this.sortStringsStrict([
          ...themeAppearances.map((appearance) => appearance.label),
        ]).filter((variant) => normalizeText(variant) !== themeRecord.normalizedLabel);

        return {
          themeId: themeRecord.recordId,
          canonicalLabel: themeRecord.label,
          variants,
          strength: themeRecord.strength ?? 0,
          mentionedIn: this.sortNumbers(chapterIndexes),
          evidence: this.aggregateAppearanceEvidence(themeAppearances, chapterByRecordId),
        };
      })
      .filter((theme): theme is GlobalThemeDto => Boolean(theme))
      .sort((left, right) => this.compareStrings(
        left.canonicalLabel,
        right.canonicalLabel,
        left.themeId,
        right.themeId,
      ));
  }

  private buildGlobalEvents(
    appearances: NodeAppearanceRecord[],
    chapterByRecordId: Map<string, ChapterGraphRecord>,
    eventGlobalIdsByRecordId: Map<string, string>,
  ): GlobalEventDto[] {
    const appearancesByGlobalEventId = new Map<string, EventAppearanceRecord[]>();
    for (const appearance of appearances) {
      if (appearance.nodeType !== 'event') continue;
      const globalEventId = eventGlobalIdsByRecordId.get(appearance.nodeRecordId);
      if (!globalEventId) continue;
      const existing = appearancesByGlobalEventId.get(globalEventId);
      if (existing) {
        existing.push(appearance);
      } else {
        appearancesByGlobalEventId.set(globalEventId, [appearance]);
      }
    }

    return Array.from(appearancesByGlobalEventId.entries())
      .map(([eventId, eventAppearances]): GlobalEventDto | null => {
        const chapterIndexes = eventAppearances
          .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
          .filter((chapterIndex): chapterIndex is number => chapterIndex !== undefined);
        if (chapterIndexes.length === 0) return null;

        let canonicalLabel = eventAppearances[0]?.label ?? '';
        let description = eventAppearances[0]?.description;
        for (const appearance of eventAppearances.slice(1)) {
          canonicalLabel = this.pickPreferredText(canonicalLabel, appearance.label) ?? canonicalLabel;
          description = this.pickPreferredText(description, appearance.description);
        }

        return {
          eventId,
          canonicalLabel,
          description,
          occurredInChapter: Math.min(...chapterIndexes),
          participantIds: [],
          placeEntityId: undefined,
          timeEntityId: undefined,
          mentionedIn: this.sortNumbers(chapterIndexes),
          evidence: this.aggregateAppearanceEvidence(eventAppearances, chapterByRecordId),
        };
      })
      .filter((event): event is GlobalEventDto => Boolean(event));
  }

  private aggregateAppearanceEvidence(
    appearances: Array<
      PersonAppearanceRecord
      | IdeaAppearanceRecord
      | ThemeAppearanceRecord
      | EntityAppearanceRecord
      | EventAppearanceRecord
    >,
    chapterByRecordId: Map<string, ChapterGraphRecord>,
  ): BookModelEvidenceRefDto[] {
    let aggregated: BookModelEvidenceRefDto[] = [];
    for (const appearance of appearances) {
      const chapter = chapterByRecordId.get(appearance.chapterRecordId);
      if (!chapter) continue;
      aggregated = this.mergeBookEvidenceRefs(
        aggregated,
        this.toBookEvidenceRefs(appearance.evidence, chapter),
      );
    }
    return this.sortBookEvidenceRefs(aggregated);
  }

  private toBookEvidenceRefs(
    evidence: KnowledgeEvidence[] | undefined,
    chapter: ChapterGraphRecord,
  ): BookModelEvidenceRefDto[] {
    if (!evidence || evidence.length === 0) return [];
    return evidence
      .filter((item) => item.quote?.trim().length)
      .map((item) => ({
        chapterIndex: chapter.chapterIndex,
        chapterId: chapter.chapterId,
        pageIndex: item.pageIndex,
        pageNumber: item.pageNumber,
        quote: item.quote.trim(),
      }));
  }

  private mergeBookEvidenceRefs(
    existing: BookModelEvidenceRefDto[],
    incoming: BookModelEvidenceRefDto[],
  ): BookModelEvidenceRefDto[] {
    const merged: BookModelEvidenceRefDto[] = [];
    const seen = new Set<string>();
    for (const value of [...existing, ...incoming]) {
      const quote = value.quote?.trim();
      if (!quote) continue;
      const key = [
        value.chapterIndex,
        value.chapterId ?? '',
        value.pageIndex ?? -1,
        value.pageNumber ?? -1,
        quote,
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...value,
        quote,
      });
    }
    return merged;
  }

  private sortBookEvidenceRefs(values: BookModelEvidenceRefDto[]): BookModelEvidenceRefDto[] {
    return [...values].sort((left, right) => {
      const chapterDelta = left.chapterIndex - right.chapterIndex;
      if (chapterDelta !== 0) return chapterDelta;
      const pageDelta = (left.pageIndex ?? Number.MAX_SAFE_INTEGER) - (right.pageIndex ?? Number.MAX_SAFE_INTEGER);
      if (pageDelta !== 0) return pageDelta;
      return (left.quote ?? '').localeCompare(right.quote ?? '');
    });
  }

  private sortNumbers(values: number[]): number[] {
    return Array.from(new Set(values)).sort((left, right) => left - right);
  }

  private sortStringsStrict(values: string[]): string[] {
    const unique = this.mergeStringArrays(undefined, values);
    return unique ? unique.sort((left, right) => left.localeCompare(right)) : [];
  }

  private pickPreferredText(existing: string | undefined, incoming: string | undefined): string | undefined {
    const existingValue = existing?.trim() || undefined;
    const incomingValue = incoming?.trim() || undefined;
    switch (true) {
      case !existingValue && !incomingValue:
        return undefined;
      case Boolean(existingValue) && !incomingValue:
        return existingValue;
      case !existingValue && Boolean(incomingValue):
        return incomingValue;
      default:
        return (incomingValue?.length ?? 0) > (existingValue?.length ?? 0)
          ? incomingValue
          : existingValue;
    }
  }

  private resolveProjectionNode(
    nodeType: KnowledgeNodeType,
    nodeRecordId: string,
    eventGlobalIdsByRecordId: Map<string, string>,
  ): { id: string; type: BookModelNodeType } | null {
    if (nodeType === 'person' && this.people.has(nodeRecordId)) {
      return { id: nodeRecordId, type: 'person' };
    }
    if (nodeType === 'idea' && this.concepts.has(nodeRecordId)) {
      return { id: nodeRecordId, type: 'idea' };
    }
    if (nodeType === 'entity' && this.entities.has(nodeRecordId)) {
      return { id: nodeRecordId, type: 'entity' };
    }
    if (nodeType === 'theme' && this.themes.has(nodeRecordId)) {
      return { id: nodeRecordId, type: 'theme' };
    }
    if (nodeType === 'event') {
      const eventId = eventGlobalIdsByRecordId.get(nodeRecordId);
      if (eventId) {
        return { id: eventId, type: 'event' };
      }
    }
    return null;
  }

  private linkConfidence(nodeType: KnowledgeNodeType): number {
    if (nodeType === 'person') return 0.9;
    if (nodeType === 'idea') return 0.88;
    if (nodeType === 'event') return 0.86;
    if (nodeType === 'entity') return 0.9;
    return 0.84;
  }

  private deduplicateChapterLinks(links: ChapterToGlobalLinkDto[]): ChapterToGlobalLinkDto[] {
    const seen = new Set<string>();
    return [...links]
      .sort((left, right) => this.compareStrings(
        `${left.chapterIndex}:${left.localType}:${left.localId}:${left.globalType}:${left.globalId}`,
        `${right.chapterIndex}:${right.localType}:${right.localId}:${right.globalType}:${right.globalId}`,
        left.chapterId,
        right.chapterId,
      ))
      .filter((link) => {
        const key = [
          link.chapterId,
          link.chapterIndex,
          link.localType,
          link.localId,
          link.globalType,
          link.globalId,
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private createEmptyIdRemap(): Record<KnowledgeNodeType, Map<string, string>> {
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
    remap: Record<KnowledgeNodeType, Map<string, string>>,
  ): string | undefined {
    return remap[type].get(localId);
  }

  private remapNodeIds(ids: string[] | undefined, remap: Map<string, string>): string[] | undefined {
    if (!ids || ids.length === 0) return undefined;
    return this.mergeStringArrays(undefined, ids.map((id) => remap.get(id)).filter((item): item is string => Boolean(item)));
  }

  private mergeStringArrays(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
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
      if (!normalized) continue;
      const key = `${normalized}|${value.pageIndex ?? -1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        quote: value.quote.trim(),
        pageIndex: value.pageIndex,
        pageNumber: value.pageNumber,
      });
    }
    return merged.length > 0 ? merged : undefined;
  }

  private maxNumber(existing: number | undefined, incoming: number | undefined): number | undefined {
    if (existing === undefined) return incoming;
    if (incoming === undefined) return existing;
    return Math.max(existing, incoming);
  }

  private sortStrings(values: string[] | undefined): string[] | undefined {
    if (!values || values.length === 0) return undefined;
    return [...values].sort((left, right) => left.localeCompare(right));
  }

  private sortEvidence(values: KnowledgeEvidence[] | undefined): KnowledgeEvidence[] | undefined {
    if (!values || values.length === 0) return undefined;
    return [...values].sort((left, right) => {
      const pageDelta = (left.pageIndex ?? Number.MAX_SAFE_INTEGER) - (right.pageIndex ?? Number.MAX_SAFE_INTEGER);
      if (pageDelta !== 0) return pageDelta;
      return left.quote.localeCompare(right.quote);
    });
  }

  private compareStrings(leftValue: string, rightValue: string, leftFallback: string, rightFallback: string): number {
    const delta = leftValue.localeCompare(rightValue);
    if (delta !== 0) return delta;
    return leftFallback.localeCompare(rightFallback);
  }

  private makeBookRecordId(bookId: string): string {
    return `book_${encodeSegment(bookId)}`;
  }

  private makeChapterRecordId(bookId: string, chapterId: string): string {
    return `chapter_${encodeSegment(bookId)}_${encodeSegment(chapterId)}`;
  }

  private makeChapterSnapshotRecordId(bookId: string, chapterId: string): string {
    return `chapter_snapshot_${encodeSegment(bookId)}_${encodeSegment(chapterId)}`;
  }

  private makeRecordRef(table: string, recordId: string): string {
    return `${table}:${recordId}`;
  }

  private makeBookRef(recordId: string): string {
    return this.makeRecordRef('book', recordId);
  }

  private makeChapterRef(recordId: string): string {
    return this.makeRecordRef('chapter', recordId);
  }

  private makePersonRef(recordId: string): string {
    return this.makeRecordRef('person', recordId);
  }

  private makeConceptRef(recordId: string): string {
    return this.makeRecordRef('concept', recordId);
  }

  private makeThemeRef(recordId: string): string {
    return this.makeRecordRef('theme', recordId);
  }

  private makeEntityRef(recordId: string): string {
    return this.makeRecordRef('entity', recordId);
  }

  private makeEventRef(recordId: string): string {
    return this.makeRecordRef('event', recordId);
  }

  private tableForNodeType(nodeType: KnowledgeNodeType): 'person' | 'concept' | 'event' | 'entity' | 'theme' {
    switch (nodeType) {
      case 'person':
        return 'person';
      case 'idea':
        return 'concept';
      case 'event':
        return 'event';
      case 'entity':
        return 'entity';
      case 'theme':
        return 'theme';
    }
  }

  private makeBookEventProjectionId(bookId: string, normalizedLabel: string): string {
    return `global_event_${encodeSegment(bookId)}_${encodeSegment(normalizedLabel)}`;
  }

  private makeProjectedRelationId(key: string): string {
    return `global_relation_${encodeSegment(key)}`;
  }

  private makeGlobalRecordId(table: 'person' | 'concept' | 'theme', normalizedValue: string): string {
    return `${table}_${encodeSegment(normalizedValue)}`;
  }

  private makeEntityRecordId(entityType: KnowledgeEntity['type'], normalizedLabel: string): string {
    return `entity_${encodeSegment(entityType)}_${encodeSegment(normalizedLabel)}`;
  }

  private makeEventRecordId(bookId: string, chapterId: string, normalizedLabel: string): string {
    return `event_${encodeSegment(bookId)}_${encodeSegment(chapterId)}_${encodeSegment(normalizedLabel)}`;
  }

  private makeAppearanceRecordId(chapterRecordId: string, nodeRecordId: string): string {
    return `appears_in_${encodeSegment(chapterRecordId)}_${encodeSegment(nodeRecordId)}`;
  }

  private makeRelationRecordId(
    chapterRecordId: string,
    fromRecordId: string,
    relationType: KnowledgeRelation['relation_type'],
    toRecordId: string,
  ): string {
    return `related_to_${encodeSegment(chapterRecordId)}_${encodeSegment(fromRecordId)}_${encodeSegment(relationType)}_${encodeSegment(toRecordId)}`;
  }

  private makePartOfRecordId(bookRecordId: string, chapterRecordId: string): string {
    return `part_of_${encodeSegment(bookRecordId)}_${encodeSegment(chapterRecordId)}`;
  }

  private ensureSet(target: Map<string, Set<string>>, key: string): Set<string> {
    const existing = target.get(key);
    if (existing) return existing;
    const created = new Set<string>();
    target.set(key, created);
    return created;
  }

  private addToPersistBatch(
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
    table: PersistTable,
    id: string,
    record: object,
  ): void {
    persistBatch.set(`${table}:${id}`, { table, id, record });
  }

  private async persistBatch(
    persistBatch: Map<string, { table: PersistTable; id: string; record: object }>,
  ): Promise<void> {
    if (!this.surrealService) return;
    for (const entry of persistBatch.values()) {
      await this.persistRecord(entry.table, entry.id, entry.record);
    }
  }

  private schedulePersist(task: () => Promise<void>): void {
    if (!this.surrealService) return;
    this.pendingPersist = this.pendingPersist
      .then(task)
      .catch((error) => {
        console.error('[knowledge-extraction] failed to persist repository state', error);
      });
  }

  private async persistRecord(table: PersistTable, id: string, record: object): Promise<void> {
    if (!this.surrealService) return;
    if (table === 'appears_in' || table === 'related_to' || table === 'part_of') {
      const relationRecord = record as { in: string; out: string };
      await this.surrealService.putRelationRecord(table, id, relationRecord.in, relationRecord.out, record);
      return;
    }
    if (table === 'workflow_run') {
      const workflowRun = record as KnowledgeExtractionWorkflowRunRecord;
      const persistedRun: KnowledgeExtractionWorkflowRunRecord = workflowRun.output
        ? { ...workflowRun, output: this.createSlimResult(workflowRun.output) }
        : workflowRun;
      await this.surrealService.putRecord(table, id, persistedRun);
      return;
    }
    if (table === 'chapter_knowledge_snapshot') {
      const snapshot = record as KnowledgeExtractionWorkflowStoredResult;
      await this.surrealService.putRecord(table, id, {
        ...snapshot,
        result: this.createSlimResult(snapshot.result),
      });
      return;
    }
    await this.surrealService.putRecord(table, id, record);
  }
}
