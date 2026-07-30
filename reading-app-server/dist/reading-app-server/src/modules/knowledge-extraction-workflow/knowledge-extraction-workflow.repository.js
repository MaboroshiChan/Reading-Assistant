"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeExtractionWorkflowRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const runtime_config_1 = require("../../config/runtime-config");
const workflow_logger_1 = require("../workflow.logger");
const surrealdb_service_1 = require("../surrealDB/surrealdb.service");
const chapterKey = (bookId, chapterId) => `${bookId}::${chapterId}`;
const normalizeText = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const CONCEPT_NORMALIZATION_STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'been',
    'being',
    'by',
    'for',
    'from',
    'in',
    'into',
    'is',
    'of',
    'on',
    'or',
    'the',
    'to',
    'was',
    'were',
    'with',
    'within',
]);
const CORRELATION_CAUSATION_CONCEPT_PATTERN = /\bcorrelation\b.*\bcausation\b|\bcausation\b.*\bcorrelation\b/i;
const normalizeConceptLabel = (value) => {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized)
        return normalized;
    if (CORRELATION_CAUSATION_CONCEPT_PATTERN.test(normalized)) {
        return 'correlation causation';
    }
    const tokens = normalized
        .split(' ')
        .filter((token) => token.length > 0 && !CONCEPT_NORMALIZATION_STOPWORDS.has(token));
    return tokens.length ? tokens.join(' ') : normalized;
};
const encodeSegment = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex').slice(0, 32);
const hashText = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
const randomRecordId = (prefix) => `${prefix}_${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
const normalizeWorkflowRunId = (value) => value.startsWith('workflow_run:') ? value.slice('workflow_run:'.length) : value;
const stableLocalId = (prefix, seed) => `${prefix}_${encodeSegment(seed)}`;
const clampProgressPercent = (value) => Math.min(100, Math.max(0, Math.round(value)));
const SURREAL_RECORD_SOFT_LIMIT_BYTES = 900_000;
const PERSISTED_RESULT_TITLE_LIMIT_BYTES = 2_000;
const PERSISTED_RESULT_SUMMARY_LIMIT_BYTES = 16_000;
const EVIDENCE_QUOTE_PREFIX_LIMIT_CHARS = 280;
const TRUNCATION_SUFFIX = '... [truncated]';
const jsonByteSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const isSurrealLengthLimitError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    return /surrealdb write failed with http 413/i.test(message)
        || /length limit exceeded/i.test(message);
};
const truncateUtf8 = (value, maxBytes) => {
    if (maxBytes <= 0)
        return '';
    if (Buffer.byteLength(value, 'utf8') <= maxBytes)
        return value;
    const suffix = Buffer.byteLength(TRUNCATION_SUFFIX, 'utf8') < maxBytes
        ? TRUNCATION_SUFFIX
        : '';
    const budget = maxBytes - Buffer.byteLength(suffix, 'utf8');
    if (budget <= 0)
        return suffix;
    let low = 0;
    let high = value.length;
    let best = '';
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = value.slice(0, mid);
        if (Buffer.byteLength(candidate, 'utf8') <= budget) {
            best = candidate;
            low = mid + 1;
        }
        else {
            high = mid - 1;
        }
    }
    return `${best}${suffix}`;
};
const truncatePrefix = (value, maxChars) => value.length <= maxChars ? value : value.slice(0, maxChars);
let KnowledgeExtractionWorkflowRepository = class KnowledgeExtractionWorkflowRepository {
    surrealService;
    runs = new Map();
    runIdsByIdempotencyKey = new Map();
    latestResultsByChapter = new Map();
    pageExtractionsByCacheKey = new Map();
    pageExtractionGraphsByCacheKey = new Map();
    books = new Map();
    chapters = new Map();
    chaptersByKey = new Map();
    people = new Map();
    personRecordIdsByAlias = new Map();
    concepts = new Map();
    themes = new Map();
    entities = new Map();
    events = new Map();
    appearances = new Map();
    appearanceIdsByChapter = new Map();
    relations = new Map();
    relationIdsByChapter = new Map();
    partOfEdges = new Map();
    evidences = new Map();
    evidenceIdsByOwner = new Map();
    pendingPersist = Promise.resolve();
    constructor(surrealService) {
        this.surrealService = surrealService;
    }
    async onModuleInit() {
        if (!this.surrealService)
            return;
        await this.ensureSchema();
        await this.loadFromStore();
    }
    createOrReuseRun(input) {
        const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
        if (existingRunId) {
            const existingRun = this.runs.get(existingRunId);
            if (existingRun) {
                if (existingRun.status === 'failed' || existingRun.status === 'stale') {
                    this.runIdsByIdempotencyKey.delete(input.idempotencyKey);
                }
                else {
                    (0, workflow_logger_1.workflowLog)('run.deduped', {
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
        const run = {
            id: randomRecordId('wr'),
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
            progress: {
                percent: 0,
                stage: 'queued',
                message: '正在排队',
            },
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.runs.set(run.id, run);
        this.runIdsByIdempotencyKey.set(input.idempotencyKey, run.id);
        this.schedulePersist(() => this.persistRecord('workflow_run', run.id, run));
        (0, workflow_logger_1.workflowLog)('run.queued', {
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
    getRun(workflowRunId) {
        return this.runs.get(normalizeWorkflowRunId(workflowRunId)) ?? null;
    }
    async getRunFromStore(workflowRunId) {
        if (!this.shouldReadThroughSurreal()) {
            return this.getRun(workflowRunId);
        }
        const persistedRun = await this.surrealService.selectRecord('workflow_run', normalizeWorkflowRunId(workflowRunId));
        if (!persistedRun) {
            return null;
        }
        const normalizedRunId = normalizeWorkflowRunId(persistedRun.id);
        const rebuiltSnapshot = await this.getLatestResultFromStore(persistedRun.bookId, persistedRun.chapterId);
        if (persistedRun.status === 'completed'
            && rebuiltSnapshot
            && persistedRun.snapshotVersion === rebuiltSnapshot.snapshotVersion
            && persistedRun.chapterContentHash === rebuiltSnapshot.chapterContentHash) {
            return {
                ...persistedRun,
                id: normalizedRunId,
                output: rebuiltSnapshot.result,
            };
        }
        return {
            ...persistedRun,
            id: normalizedRunId,
            output: this.isFullResultPayload(persistedRun.output) ? persistedRun.output : undefined,
        };
    }
    listRecoverableRuns() {
        return Array.from(this.runs.values())
            .filter((run) => run.status === 'queued' || run.status === 'running')
            .sort((left, right) => {
            const leftTime = Date.parse(left.startedAt ?? left.createdAt);
            const rightTime = Date.parse(right.startedAt ?? right.createdAt);
            return leftTime - rightTime;
        })
            .map((run) => ({ ...run }));
    }
    markRunning(workflowRunId) {
        const run = this.runs.get(workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            status: 'running',
            startedAt: run.startedAt ?? timestamp,
            updatedAt: timestamp,
            deduped: false,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        (0, workflow_logger_1.workflowLog)('run.running', {
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
    updateRunProgress(workflowRunId, progress) {
        const run = this.runs.get(workflowRunId);
        if (!run || (run.status !== 'queued' && run.status !== 'running'))
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            progress: {
                percent: clampProgressPercent(progress.percent),
                stage: progress.stage?.trim() || undefined,
                message: progress.message?.trim() || undefined,
            },
            updatedAt: timestamp,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        (0, workflow_logger_1.workflowLog)('run.progress', {
            workflowKind: updated.kind,
            workflowRunId: updated.id,
            bookId: updated.bookId,
            chapterId: updated.chapterId,
            chapterIndex: updated.chapterIndex,
            workflowVersion: updated.workflowVersion,
            percent: updated.progress?.percent,
            stage: updated.progress?.stage,
            message: updated.progress?.message,
        });
        return updated;
    }
    updateRunCheckpoint(workflowRunId, checkpoint) {
        const run = this.runs.get(workflowRunId);
        if (!run || (run.status !== 'queued' && run.status !== 'running'))
            return null;
        const updated = {
            ...run,
            checkpoint,
            updatedAt: checkpoint.updatedAt,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        return updated;
    }
    upsertPartialPieceResult(workflowRunId, partialPieceResult) {
        const run = this.runs.get(workflowRunId);
        if (!run || (run.status !== 'queued' && run.status !== 'running'))
            return null;
        const nextResults = (run.partialPieceResults ?? [])
            .filter((item) => item.pieceIndex !== partialPieceResult.pieceIndex)
            .concat(partialPieceResult)
            .sort((left, right) => left.pieceIndex - right.pieceIndex);
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            partialPieceResults: nextResults,
            updatedAt: timestamp,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        return updated;
    }
    clearRunCheckpoint(workflowRunId) {
        const run = this.runs.get(workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            checkpoint: undefined,
            updatedAt: timestamp,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        return updated;
    }
    clearPartialPieceResults(workflowRunId) {
        const run = this.runs.get(workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            partialPieceResults: undefined,
            updatedAt: timestamp,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        return updated;
    }
    restartFailedRun(workflowRunId, mode) {
        const run = this.runs.get(workflowRunId);
        if (!run || run.status !== 'failed')
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            status: 'queued',
            output: undefined,
            error: undefined,
            progress: {
                percent: 0,
                stage: 'queued',
                message: '正在排队',
            },
            startedAt: undefined,
            completedAt: undefined,
            checkpoint: mode === 'resume' ? run.checkpoint : undefined,
            partialPieceResults: mode === 'resume' ? run.partialPieceResults : undefined,
            updatedAt: timestamp,
            deduped: false,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        (0, workflow_logger_1.workflowLog)('run.restarted', {
            workflowKind: updated.kind,
            workflowRunId: updated.id,
            bookId: updated.bookId,
            chapterId: updated.chapterId,
            chapterIndex: updated.chapterIndex,
            workflowVersion: updated.workflowVersion,
            restartMode: mode,
        });
        return updated;
    }
    completeRun(args) {
        const run = this.runs.get(args.workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            status: 'completed',
            snapshotVersion: args.snapshotVersion,
            chapterContentHash: args.chapterContentHash,
            output: args.result,
            error: undefined,
            progress: undefined,
            checkpoint: undefined,
            partialPieceResults: undefined,
            updatedAt: timestamp,
            completedAt: timestamp,
            deduped: false,
        };
        this.runs.set(args.workflowRunId, updated);
        const storedResult = {
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
            await this.persistRecord('chapter_knowledge_snapshot', this.makeChapterSnapshotRecordId(updated.bookId, updated.chapterId), storedResult);
        });
        (0, workflow_logger_1.workflowLog)('run.completed', {
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
    failRun(workflowRunId, code, message) {
        return this.finishWithError(workflowRunId, 'failed', code, message);
    }
    markStale(workflowRunId, code, message) {
        return this.finishWithError(workflowRunId, 'stale', code, message);
    }
    getLatestResult(bookId, chapterId) {
        return this.latestResultsByChapter.get(chapterKey(bookId, chapterId)) ?? null;
    }
    async getLatestResultFromStore(bookId, chapterId) {
        if (!this.shouldReadThroughSurreal()) {
            return this.getLatestResult(bookId, chapterId);
        }
        const snapshot = await this.surrealService.selectRecord('chapter_knowledge_snapshot', this.makeChapterSnapshotRecordId(bookId, chapterId));
        if (!snapshot) {
            return null;
        }
        const rebuiltResult = await this.buildChapterSnapshot(snapshot.bookId, snapshot.chapterId);
        const persistedResult = this.extractPersistedSummary(snapshot.result);
        if (persistedResult?.title)
            rebuiltResult.title = persistedResult.title;
        if (persistedResult?.summary)
            rebuiltResult.summary = persistedResult.summary;
        return {
            ...snapshot,
            workflowRunId: normalizeWorkflowRunId(snapshot.workflowRunId),
            result: rebuiltResult,
        };
    }
    findLatestRunForChapter(bookId, chapterId) {
        const candidates = Array.from(this.runs.values())
            .filter((run) => run.bookId === bookId && run.chapterId === chapterId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return candidates[0] ?? null;
    }
    async ensureSchema() {
        if (!this.surrealService)
            return;
        const statements = [
            'DEFINE TABLE IF NOT EXISTS workflow_run SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS chapter_knowledge_snapshot SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS page_knowledge_extraction_cache SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS knowledge_evidence SCHEMALESS;',
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
        await this.surrealService.query(statements);
    }
    async upsertPageExtraction(input) {
        return this.writePageGraphExtraction(this.resultToGraphExtraction(input), false);
    }
    async replaceChapterExtraction(input) {
        return this.writePageGraphExtraction(this.resultToGraphExtraction(input), true);
    }
    async upsertPageGraphExtraction(input) {
        return this.writePageGraphExtraction(input, false);
    }
    async replaceChapterGraphExtraction(input) {
        return this.writePageGraphExtraction(input, true);
    }
    async writePageGraphExtraction(input, replaceChapter) {
        const extraction = this.enforceEvidenceCoverageOnGraphExtraction(input.extraction);
        const persistBatch = new Map();
        const bookRecord = this.upsertBook(input.bookId, persistBatch);
        const chapterRecord = this.upsertChapter(input, persistBatch);
        this.upsertPartOf(bookRecord, chapterRecord, persistBatch);
        if (replaceChapter) {
            await this.clearChapterKnowledge(chapterRecord.recordId);
        }
        const remap = this.createEmptyIdRemap();
        const nodeById = new Map(extraction.nodes.map((node) => [node.id, node]));
        const nodeEvidence = this.groupGraphEvidence(extraction.evidence, 'node');
        const edgeEvidence = this.groupGraphEvidence(extraction.evidence, 'edge');
        for (const node of extraction.nodes.filter((item) => item.type === 'person')) {
            const person = this.toKnowledgePerson(node, nodeEvidence.get(node.id));
            const personRecord = this.upsertPerson(chapterRecord, person, persistBatch);
            remap.person.set(node.id, personRecord.recordId);
            this.upsertPersonAppearance(chapterRecord, personRecord, person, persistBatch);
        }
        for (const node of extraction.nodes.filter((item) => item.type === 'idea')) {
            const idea = this.toKnowledgeIdea(node, nodeEvidence.get(node.id));
            const conceptRecord = this.upsertConcept(chapterRecord, idea, persistBatch);
            remap.idea.set(node.id, conceptRecord.recordId);
            this.upsertIdeaAppearance(chapterRecord, conceptRecord, idea, persistBatch);
        }
        for (const node of extraction.nodes.filter((item) => item.type === 'entity')) {
            const entity = this.toKnowledgeEntity(node, nodeEvidence.get(node.id));
            const entityRecord = this.upsertEntity(chapterRecord, entity, persistBatch);
            remap.entity.set(node.id, entityRecord.recordId);
            this.upsertEntityAppearance(chapterRecord, entityRecord, entity, persistBatch);
        }
        for (const node of extraction.nodes.filter((item) => item.type === 'theme')) {
            const theme = this.toKnowledgeTheme(node, nodeEvidence.get(node.id));
            const themeRecord = this.upsertTheme(chapterRecord, theme, persistBatch);
            remap.theme.set(node.id, themeRecord.recordId);
            this.upsertThemeAppearance(chapterRecord, themeRecord, theme, persistBatch);
        }
        for (const node of extraction.nodes.filter((item) => item.type === 'event')) {
            const event = this.toKnowledgeEvent(node, nodeEvidence.get(node.id));
            const participantRecordIds = this.remapNodeIds(event.participant_local_ids, remap.person);
            const eventRecord = this.upsertEvent(chapterRecord, input, event, participantRecordIds, persistBatch);
            remap.event.set(node.id, eventRecord.recordId);
            this.upsertEventAppearance(chapterRecord, eventRecord, event, participantRecordIds, persistBatch);
        }
        for (const edge of extraction.edges) {
            const fromNode = nodeById.get(edge.from);
            const toNode = nodeById.get(edge.to);
            if (!fromNode || !toNode)
                continue;
            const fromRecordId = this.remapNodeId(fromNode.type, edge.from, remap);
            const toRecordId = this.remapNodeId(toNode.type, edge.to, remap);
            if (!fromRecordId || !toRecordId)
                continue;
            this.upsertRelation(chapterRecord, this.toKnowledgeRelation(edge, fromNode.type, fromRecordId, toNode.type, toRecordId, edgeEvidence.get(edge.id)), persistBatch);
        }
        await this.persistBatch(persistBatch);
        return this.countChapter(chapterRecord.recordId);
    }
    getCachedPageGraphExtraction(bookId, chapterId, pageIndex, sourceHash, chapterContentHash, promptVersion) {
        const cacheKey = this.makePageExtractionCacheKey(bookId, chapterId, pageIndex, sourceHash, chapterContentHash, promptVersion);
        return this.pageExtractionGraphsByCacheKey.get(cacheKey) ?? null;
    }
    getCachedPageExtraction(bookId, chapterId, pageIndex, sourceHash, chapterContentHash, promptVersion) {
        const extraction = this.getCachedPageGraphExtraction(bookId, chapterId, pageIndex, sourceHash, chapterContentHash, promptVersion);
        return extraction ? this.buildKnowledgeResultFromGraphExtraction(extraction) : null;
    }
    setCachedPageGraphExtraction(args) {
        const cacheKey = this.makePageExtractionCacheKey(args.bookId, args.chapterId, args.pageIndex, args.sourceHash, args.chapterContentHash, args.promptVersion);
        const now = new Date().toISOString();
        const existing = this.pageExtractionsByCacheKey.get(cacheKey);
        const record = {
            cacheKey,
            bookId: args.bookId,
            chapterId: args.chapterId,
            pageIndex: args.pageIndex,
            sourceHash: args.sourceHash,
            chapterContentHash: args.chapterContentHash,
            promptVersion: args.promptVersion,
            status: 'cached',
            nodeCount: args.extraction.nodes.length,
            edgeCount: args.extraction.edges.length,
            evidenceCount: args.extraction.evidence.length,
            responseHash: hashText(JSON.stringify(args.extraction)),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        this.pageExtractionsByCacheKey.set(cacheKey, record);
        this.pageExtractionGraphsByCacheKey.set(cacheKey, args.extraction);
        this.schedulePersist(() => this.persistRecord('page_knowledge_extraction_cache', cacheKey, record));
        return record;
    }
    setCachedPageExtraction(args) {
        return this.setCachedPageGraphExtraction({
            ...args,
            extraction: 'nodes' in args.extraction
                ? args.extraction
                : this.knowledgeResultToGraphData(args.extraction),
        });
    }
    async buildChapterSnapshot(bookId, chapterId) {
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
            .filter((item) => item !== undefined)
            .filter((appearance) => this.ownerHasRequiredEvidence('appears_in', appearance.recordId));
        const chapterRelations = Array.from(this.relationIdsByChapter.get(chapterRecordId) ?? [])
            .map((relationId) => this.relations.get(relationId))
            .filter((relation) => relation !== undefined)
            .filter((relation) => this.ownerHasRequiredEvidence('related_to', relation.recordId));
        const localIdsByNodeRecordId = new Map(appearances.map((appearance) => [appearance.nodeRecordId, appearance.localId]));
        const people = appearances
            .filter((appearance) => appearance.nodeType === 'person')
            .map((appearance) => ({
            local_id: appearance.localId,
            name: appearance.name,
            aliases: this.sortStrings(appearance.aliases),
            importance: appearance.importance,
            description: this.resolveChapterPersonDescription(appearance, chapterRelations),
            roles: this.sortStrings(appearance.roles),
            traits: this.sortStrings(appearance.traits),
            evidence: this.getEvidenceForOwner('appears_in', appearance.recordId),
        }))
            .sort((left, right) => this.compareStrings(left.name, right.name, left.local_id, right.local_id));
        const ideas = appearances
            .filter((appearance) => appearance.nodeType === 'idea')
            .map((appearance) => ({
            local_id: appearance.localId,
            label: appearance.label,
            description: appearance.description,
            kind: appearance.kind ?? 'claim',
            evidence: this.getEvidenceForOwner('appears_in', appearance.recordId),
        }))
            .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));
        const events = appearances
            .filter((appearance) => appearance.nodeType === 'event')
            .map((appearance) => ({
            local_id: appearance.localId,
            label: appearance.label,
            description: appearance.description,
            participant_local_ids: this.sortStrings(appearance.participantRecordIds?.map((participantRecordId) => localIdsByNodeRecordId.get(participantRecordId) ?? participantRecordId)),
            time_hint: appearance.timeHint,
            place_hint: appearance.placeHint,
            evidence: this.getEvidenceForOwner('appears_in', appearance.recordId),
        }))
            .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));
        const entities = appearances
            .filter((appearance) => appearance.nodeType === 'entity')
            .map((appearance) => ({
            local_id: appearance.localId,
            label: appearance.label,
            type: appearance.entityType,
            description: appearance.description,
            evidence: this.getEvidenceForOwner('appears_in', appearance.recordId),
        }))
            .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));
        const themes = appearances
            .filter((appearance) => appearance.nodeType === 'theme')
            .map((appearance) => ({
            local_id: appearance.localId,
            label: appearance.label,
            strength: appearance.strength,
            description: appearance.description,
            evidence: this.getEvidenceForOwner('appears_in', appearance.recordId),
        }))
            .sort((left, right) => this.compareStrings(left.label, right.label, left.local_id, right.local_id));
        const relations = chapterRelations
            .map((relation) => {
            const fromLocalId = localIdsByNodeRecordId.get(relation.fromRecordId);
            const toLocalId = localIdsByNodeRecordId.get(relation.toRecordId);
            if (!fromLocalId || !toLocalId)
                return null;
            return {
                local_id: relation.localId,
                from_id: fromLocalId,
                from_type: relation.fromType,
                to_id: toLocalId,
                to_type: relation.toType,
                relation_type: relation.relationType,
                description: relation.description,
                confidence: relation.confidence,
                evidence: this.getEvidenceForOwner('related_to', relation.recordId),
            };
        })
            .filter((relation) => relation !== null)
            .sort((left, right) => this.compareStrings(`${left.from_type}:${left.from_id}:${left.relation_type}:${left.to_type}:${left.to_id}`, `${right.from_type}:${right.from_id}:${right.relation_type}:${right.to_type}:${right.to_id}`, left.local_id, right.local_id));
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
    createSlimResult(result) {
        return {
            title: truncateUtf8(result.title, PERSISTED_RESULT_TITLE_LIMIT_BYTES),
            summary: truncateUtf8(result.summary, PERSISTED_RESULT_SUMMARY_LIMIT_BYTES),
        };
    }
    createPersistablePartialPieceResults(value) {
        if (!value)
            return undefined;
        return value.map((item) => ({
            ...item,
            extraction: {
                ...item.extraction,
                evidence: item.extraction.evidence.map((evidence) => ({
                    ...evidence,
                    quote: truncatePrefix(evidence.quote, EVIDENCE_QUOTE_PREFIX_LIMIT_CHARS),
                })),
            },
        }));
    }
    extractPersistedSummary(value) {
        if (!value || typeof value !== 'object')
            return null;
        const title = typeof value.title === 'string'
            ? value.title
            : '';
        const summary = typeof value.summary === 'string'
            ? value.summary
            : '';
        if (!title && !summary)
            return null;
        return { title, summary };
    }
    isFullResultPayload(value) {
        if (!value || typeof value !== 'object')
            return false;
        return Array.isArray(value.people)
            && Array.isArray(value.ideas)
            && Array.isArray(value.events)
            && Array.isArray(value.entities)
            && Array.isArray(value.themes)
            && Array.isArray(value.relations);
    }
    resultToGraphExtraction(input) {
        return {
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            extraction: this.knowledgeResultToGraphData(input.extraction),
        };
    }
    knowledgeResultToGraphData(extraction) {
        const evidence = [];
        const pushEvidence = (ownerKind, ownerId, items) => {
            for (const item of items ?? []) {
                evidence.push({
                    id: stableLocalId('ev', `${ownerKind}:${ownerId}:${item.pageIndex ?? -1}:${item.pageNumber ?? -1}:${item.quote}`),
                    owner_kind: ownerKind,
                    owner_id: ownerId,
                    quote: item.quote,
                    pageIndex: item.pageIndex,
                    pageNumber: item.pageNumber,
                });
            }
        };
        const nodes = [
            ...extraction.people.map((person) => {
                pushEvidence('node', person.local_id, person.evidence);
                return {
                    id: person.local_id,
                    type: 'person',
                    label: person.name,
                    aliases: person.aliases,
                    importance: person.importance,
                    description: person.description,
                    roles: person.roles,
                    traits: person.traits,
                };
            }),
            ...extraction.ideas.map((idea) => {
                pushEvidence('node', idea.local_id, idea.evidence);
                return {
                    id: idea.local_id,
                    type: 'idea',
                    label: idea.label,
                    kind: idea.kind,
                    description: idea.description,
                };
            }),
            ...extraction.events.map((event) => {
                pushEvidence('node', event.local_id, event.evidence);
                return {
                    id: event.local_id,
                    type: 'event',
                    label: event.label,
                    description: event.description,
                    participant_ids: event.participant_local_ids,
                    time_hint: event.time_hint,
                    place_hint: event.place_hint,
                };
            }),
            ...extraction.entities.map((entity) => {
                pushEvidence('node', entity.local_id, entity.evidence);
                return {
                    id: entity.local_id,
                    type: 'entity',
                    label: entity.label,
                    entity_type: entity.type,
                    description: entity.description,
                };
            }),
            ...extraction.themes.map((theme) => {
                pushEvidence('node', theme.local_id, theme.evidence);
                return {
                    id: theme.local_id,
                    type: 'theme',
                    label: theme.label,
                    strength: theme.strength,
                    description: theme.description,
                };
            }),
        ];
        const edges = extraction.relations.map((relation) => {
            pushEvidence('edge', relation.local_id, relation.evidence);
            return {
                id: relation.local_id,
                from: relation.from_id,
                to: relation.to_id,
                relation_type: relation.relation_type,
                description: relation.description,
                confidence: relation.confidence,
            };
        });
        return {
            title: extraction.title,
            summary: extraction.summary,
            nodes,
            edges,
            evidence,
        };
    }
    groupGraphEvidence(evidence, ownerKind) {
        const grouped = new Map();
        for (const item of evidence) {
            if (item.owner_kind !== ownerKind)
                continue;
            const values = grouped.get(item.owner_id) ?? [];
            const normalized = this.normalizeEvidence({
                quote: item.quote,
                pageIndex: item.pageIndex,
                pageNumber: item.pageNumber,
            });
            if (!normalized)
                continue;
            values.push(normalized);
            grouped.set(item.owner_id, values);
        }
        for (const [ownerId, values] of grouped) {
            const normalized = this.normalizeEvidenceList(values);
            if (normalized) {
                grouped.set(ownerId, normalized);
            }
            else {
                grouped.delete(ownerId);
            }
        }
        return grouped;
    }
    toKnowledgePerson(node, evidence) {
        return {
            local_id: node.id,
            name: node.label,
            aliases: node.aliases,
            importance: node.importance,
            description: node.description,
            roles: node.roles,
            traits: node.traits,
            evidence,
        };
    }
    toKnowledgeIdea(node, evidence) {
        return {
            local_id: node.id,
            label: node.label,
            description: node.description,
            kind: node.kind,
            evidence,
        };
    }
    toKnowledgeEvent(node, evidence) {
        return {
            local_id: node.id,
            label: node.label,
            description: node.description,
            participant_local_ids: node.participant_ids,
            time_hint: node.time_hint,
            place_hint: node.place_hint,
            evidence,
        };
    }
    toKnowledgeEntity(node, evidence) {
        return {
            local_id: node.id,
            label: node.label,
            type: node.entity_type,
            description: node.description,
            evidence,
        };
    }
    toKnowledgeTheme(node, evidence) {
        return {
            local_id: node.id,
            label: node.label,
            strength: node.strength,
            description: node.description,
            evidence,
        };
    }
    toKnowledgeRelation(edge, fromType, fromRecordId, toType, toRecordId, evidence) {
        return {
            local_id: edge.id,
            from_id: fromRecordId,
            from_type: fromType,
            to_id: toRecordId,
            to_type: toType,
            relation_type: edge.relation_type,
            description: edge.description,
            confidence: edge.confidence,
            evidence,
        };
    }
    buildKnowledgeResultFromGraphExtraction(extraction) {
        const filteredExtraction = this.enforceEvidenceCoverageOnGraphExtraction(extraction);
        const nodeEvidence = this.groupGraphEvidence(filteredExtraction.evidence, 'node');
        const edgeEvidence = this.groupGraphEvidence(filteredExtraction.evidence, 'edge');
        const nodeById = new Map(filteredExtraction.nodes.map((node) => [node.id, node]));
        const relations = [];
        for (const edge of filteredExtraction.edges) {
            const fromNode = nodeById.get(edge.from);
            const toNode = nodeById.get(edge.to);
            if (!fromNode || !toNode)
                continue;
            relations.push({
                local_id: edge.id,
                from_id: edge.from,
                from_type: fromNode.type,
                to_id: edge.to,
                to_type: toNode.type,
                relation_type: edge.relation_type,
                description: edge.description,
                confidence: edge.confidence,
                evidence: edgeEvidence.get(edge.id),
            });
        }
        return {
            title: filteredExtraction.title,
            summary: filteredExtraction.summary,
            people: filteredExtraction.nodes
                .filter((node) => node.type === 'person')
                .map((node) => this.toKnowledgePerson(node, nodeEvidence.get(node.id))),
            ideas: filteredExtraction.nodes
                .filter((node) => node.type === 'idea')
                .map((node) => this.toKnowledgeIdea(node, nodeEvidence.get(node.id))),
            events: filteredExtraction.nodes
                .filter((node) => node.type === 'event')
                .map((node) => this.toKnowledgeEvent(node, nodeEvidence.get(node.id))),
            entities: filteredExtraction.nodes
                .filter((node) => node.type === 'entity')
                .map((node) => this.toKnowledgeEntity(node, nodeEvidence.get(node.id))),
            themes: filteredExtraction.nodes
                .filter((node) => node.type === 'theme')
                .map((node) => this.toKnowledgeTheme(node, nodeEvidence.get(node.id))),
            relations,
        };
    }
    buildBookKeyInformation(bookId) {
        const chapterRecords = Array.from(this.chapters.values())
            .filter((chapter) => chapter.bookId === bookId)
            .sort((left, right) => {
            const chapterDelta = left.chapterIndex - right.chapterIndex;
            if (chapterDelta !== 0)
                return chapterDelta;
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
            .filter((appearance) => Boolean(appearance))
            .filter((appearance) => this.ownerHasRequiredEvidence('appears_in', appearance.recordId));
        const relations = chapterRecords
            .flatMap((chapter) => Array.from(this.relationIdsByChapter.get(chapter.recordId) ?? []))
            .map((relationId) => this.relations.get(relationId))
            .filter((relation) => Boolean(relation))
            .filter((relation) => this.ownerHasRequiredEvidence('related_to', relation.recordId));
        const eventGlobalIdsByRecordId = new Map();
        for (const appearance of appearances) {
            if (appearance.nodeType !== 'event')
                continue;
            const eventRecord = this.events.get(appearance.nodeRecordId);
            const normalizedLabel = eventRecord?.normalizedLabel ?? normalizeText(appearance.label);
            eventGlobalIdsByRecordId.set(appearance.nodeRecordId, this.makeBookEventProjectionId(bookId, normalizedLabel));
        }
        const people = this.buildGlobalPeople(appearances, chapterByRecordId);
        const ideas = this.buildGlobalIdeas(appearances, chapterByRecordId);
        const entities = this.buildGlobalEntities(appearances, chapterByRecordId);
        const themes = this.buildGlobalThemes(appearances, chapterByRecordId);
        const events = this.buildGlobalEvents(appearances, chapterByRecordId, eventGlobalIdsByRecordId);
        const projectionByNodeRecordId = new Map();
        for (const appearance of appearances) {
            if (!chapterRecordIds.has(appearance.chapterRecordId))
                continue;
            const projection = this.resolveProjectionNode(appearance.nodeType, appearance.nodeRecordId, eventGlobalIdsByRecordId);
            if (projection) {
                projectionByNodeRecordId.set(appearance.nodeRecordId, projection);
            }
        }
        const relationsByKey = new Map();
        for (const relation of relations) {
            const chapter = chapterByRecordId.get(relation.chapterRecordId);
            if (!chapter)
                continue;
            const fromProjection = projectionByNodeRecordId.get(relation.fromRecordId);
            const toProjection = projectionByNodeRecordId.get(relation.toRecordId);
            if (!fromProjection || !toProjection)
                continue;
            const relationKey = [
                fromProjection.type,
                fromProjection.id,
                relation.relationType,
                toProjection.type,
                toProjection.id,
            ].join('|');
            const existing = relationsByKey.get(relationKey);
            const evidence = this.toBookEvidenceRefs(this.getEvidenceForOwner('related_to', relation.recordId), chapter);
            if (evidence.length === 0)
                continue;
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
                if (!event)
                    continue;
                if (relation.relationType === 'located_in' && entityTypeById.get(relation.toId) === 'place') {
                    event.placeEntityId = event.placeEntityId ?? relation.toId;
                }
                if (relation.relationType === 'happens_at' && entityTypeById.get(relation.toId) === 'time') {
                    event.timeEntityId = event.timeEntityId ?? relation.toId;
                }
            }
        }
        const links = appearances
            .map((appearance) => {
            const chapter = chapterByRecordId.get(appearance.chapterRecordId);
            const projection = projectionByNodeRecordId.get(appearance.nodeRecordId);
            if (!chapter || !projection)
                return null;
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
            .filter((link) => Boolean(link));
        return {
            people,
            ideas,
            events: events.sort((left, right) => this.compareStrings(left.canonicalLabel, right.canonicalLabel, left.eventId, right.eventId)),
            entities,
            themes,
            relations: Array.from(relationsByKey.values()).sort((left, right) => this.compareStrings(`${left.fromType}:${left.fromId}:${left.relationType}:${left.toType}:${left.toId}`, `${right.fromType}:${right.fromId}:${right.relationType}:${right.toType}:${right.toId}`, left.relationId, right.relationId)),
            arcs: [],
            ideaFlows: [],
            links: this.deduplicateChapterLinks(links),
        };
    }
    finishWithError(workflowRunId, status, code, message) {
        const run = this.runs.get(workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            status,
            error: { code, message },
            progress: undefined,
            updatedAt: timestamp,
            completedAt: timestamp,
            deduped: false,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('workflow_run', updated.id, updated));
        (0, workflow_logger_1.workflowLog)(`run.${status}`, {
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
    async loadFromStore() {
        if (!this.surrealService)
            return;
        const [workflowRuns, snapshots, pageCaches, evidenceRecords, books, chapters, people, concepts, themes, entities, events, appearances, relations, partOfEdges,] = await Promise.all([
            this.surrealService.selectTable('workflow_run'),
            this.surrealService.selectTable('chapter_knowledge_snapshot'),
            this.surrealService.selectTable('page_knowledge_extraction_cache'),
            this.surrealService.selectTable('knowledge_evidence'),
            this.surrealService.selectTable('book'),
            this.surrealService.selectTable('chapter'),
            this.surrealService.selectTable('person'),
            this.surrealService.selectTable('concept'),
            this.surrealService.selectTable('theme'),
            this.surrealService.selectTable('entity'),
            this.surrealService.selectTable('event'),
            this.surrealService.selectTable('appears_in'),
            this.surrealService.selectTable('related_to'),
            this.surrealService.selectTable('part_of'),
        ]);
        this.runs.clear();
        this.runIdsByIdempotencyKey.clear();
        this.latestResultsByChapter.clear();
        this.pageExtractionsByCacheKey.clear();
        this.pageExtractionGraphsByCacheKey.clear();
        this.books.clear();
        this.chapters.clear();
        this.chaptersByKey.clear();
        this.people.clear();
        this.personRecordIdsByAlias.clear();
        this.concepts.clear();
        this.themes.clear();
        this.entities.clear();
        this.events.clear();
        this.appearances.clear();
        this.appearanceIdsByChapter.clear();
        this.relations.clear();
        this.relationIdsByChapter.clear();
        this.partOfEdges.clear();
        this.evidences.clear();
        this.evidenceIdsByOwner.clear();
        for (const pageCache of pageCaches) {
            this.pageExtractionsByCacheKey.set(pageCache.cacheKey, {
                ...pageCache,
                extraction: undefined,
            });
        }
        for (const book of books)
            this.books.set(book.recordId, book);
        for (const chapter of chapters) {
            this.chapters.set(chapter.recordId, chapter);
            this.chaptersByKey.set(chapterKey(chapter.bookId, chapter.chapterId), chapter.recordId);
        }
        for (const person of people) {
            this.people.set(person.recordId, person);
            this.indexPersonAliases(person);
        }
        for (const concept of concepts)
            this.concepts.set(concept.recordId, concept);
        for (const theme of themes)
            this.themes.set(theme.recordId, theme);
        for (const entity of entities)
            this.entities.set(entity.recordId, entity);
        for (const event of events)
            this.events.set(event.recordId, event);
        for (const appearance of appearances) {
            this.appearances.set(appearance.recordId, appearance);
            this.ensureSet(this.appearanceIdsByChapter, appearance.chapterRecordId).add(appearance.recordId);
        }
        for (const relation of relations) {
            this.relations.set(relation.recordId, relation);
            this.ensureSet(this.relationIdsByChapter, relation.chapterRecordId).add(relation.recordId);
        }
        for (const partOfEdge of partOfEdges)
            this.partOfEdges.set(partOfEdge.recordId, partOfEdge);
        for (const evidence of evidenceRecords)
            this.addEvidenceToIndexes(evidence);
        this.hydrateLegacyEvidence(people, concepts, themes, entities, events, appearances, relations);
        const rebuiltSnapshots = new Map();
        for (const snapshot of snapshots) {
            const rebuiltResult = await this.buildChapterSnapshot(snapshot.bookId, snapshot.chapterId);
            const persistedResult = this.extractPersistedSummary(snapshot.result);
            if (persistedResult?.title)
                rebuiltResult.title = persistedResult.title;
            if (persistedResult?.summary)
                rebuiltResult.summary = persistedResult.summary;
            const hydratedSnapshot = {
                ...snapshot,
                workflowRunId: normalizeWorkflowRunId(snapshot.workflowRunId),
                result: rebuiltResult,
            };
            rebuiltSnapshots.set(chapterKey(snapshot.bookId, snapshot.chapterId), hydratedSnapshot);
            this.latestResultsByChapter.set(chapterKey(snapshot.bookId, snapshot.chapterId), hydratedSnapshot);
        }
        for (const run of workflowRuns) {
            const normalizedRunId = normalizeWorkflowRunId(run.id);
            const rebuiltSnapshot = rebuiltSnapshots.get(chapterKey(run.bookId, run.chapterId));
            const hydratedRun = (run.status === 'completed'
                && rebuiltSnapshot
                && run.snapshotVersion === rebuiltSnapshot.snapshotVersion
                && run.chapterContentHash === rebuiltSnapshot.chapterContentHash)
                ? {
                    ...run,
                    id: normalizedRunId,
                    output: rebuiltSnapshot.result,
                }
                : {
                    ...run,
                    id: normalizedRunId,
                    output: this.isFullResultPayload(run.output) ? run.output : undefined,
                };
            this.runs.set(hydratedRun.id, hydratedRun);
            this.runIdsByIdempotencyKey.set(hydratedRun.idempotencyKey, hydratedRun.id);
        }
    }
    hydrateLegacyEvidence(people, concepts, themes, entities, events, appearances, relations) {
        const chapterByNodeRecordId = new Map();
        for (const appearance of appearances) {
            const chapter = this.chapters.get(appearance.chapterRecordId);
            if (!chapter)
                continue;
            if (!chapterByNodeRecordId.has(appearance.nodeRecordId)) {
                chapterByNodeRecordId.set(appearance.nodeRecordId, chapter);
            }
            this.addLegacyEvidence(chapter, 'appears_in', appearance.recordId, appearance.evidence);
        }
        for (const person of people) {
            const chapter = chapterByNodeRecordId.get(person.recordId);
            if (!chapter)
                continue;
            this.addLegacyEvidence(chapter, 'person', person.recordId, person.evidence);
        }
        for (const concept of concepts) {
            const chapter = chapterByNodeRecordId.get(concept.recordId);
            if (!chapter)
                continue;
            this.addLegacyEvidence(chapter, 'concept', concept.recordId, concept.evidence);
        }
        for (const theme of themes) {
            const chapter = chapterByNodeRecordId.get(theme.recordId);
            if (!chapter)
                continue;
            this.addLegacyEvidence(chapter, 'theme', theme.recordId, theme.evidence);
        }
        for (const entity of entities) {
            const chapter = chapterByNodeRecordId.get(entity.recordId);
            if (!chapter)
                continue;
            this.addLegacyEvidence(chapter, 'entity', entity.recordId, entity.evidence);
        }
        for (const event of events) {
            const chapter = this.findChapterByExternalIds(event.bookId, event.chapterId)
                ?? chapterByNodeRecordId.get(event.recordId);
            if (!chapter)
                continue;
            this.addLegacyEvidence(chapter, 'event', event.recordId, event.evidence);
        }
        for (const relation of relations) {
            const chapter = this.chapters.get(relation.chapterRecordId);
            if (!chapter)
                continue;
            this.addLegacyEvidence(chapter, 'related_to', relation.recordId, relation.evidence);
        }
    }
    findChapterByExternalIds(bookId, chapterId) {
        for (const chapter of this.chapters.values()) {
            if (chapter.bookId === bookId && chapter.chapterId === chapterId)
                return chapter;
        }
        return null;
    }
    addLegacyEvidence(chapterRecord, ownerTable, ownerRecordId, evidence) {
        for (const item of evidence ?? []) {
            const normalized = this.normalizeEvidence(item);
            if (!normalized)
                continue;
            this.addEvidenceToIndexes({
                recordId: this.makeEvidenceRecordId(ownerTable, ownerRecordId, normalized),
                bookId: chapterRecord.bookId,
                chapterId: chapterRecord.chapterId,
                chapterRecordId: chapterRecord.recordId,
                ownerTable,
                ownerRecordId,
                pageIndex: normalized.pageIndex,
                pageNumber: normalized.pageNumber,
                quote: normalized.quote,
                quoteHash: hashText(normalized.quote),
                createdAt: new Date().toISOString(),
            });
        }
    }
    upsertBook(bookId, persistBatch) {
        const recordId = this.makeBookRecordId(bookId);
        const existing = this.books.get(recordId);
        if (existing)
            return existing;
        const created = { recordId, bookId };
        this.books.set(recordId, created);
        this.addToPersistBatch(persistBatch, 'book', recordId, created);
        return created;
    }
    upsertChapter(input, persistBatch) {
        const recordId = this.makeChapterRecordId(input.bookId, input.chapterId);
        const existing = this.chapters.get(recordId);
        if (existing) {
            const updated = {
                ...existing,
                chapterIndex: input.chapterIndex,
                title: existing.title ?? input.chapterTitle,
            };
            this.chapters.set(recordId, updated);
            this.chaptersByKey.set(chapterKey(input.bookId, input.chapterId), recordId);
            this.addToPersistBatch(persistBatch, 'chapter', recordId, updated);
            return updated;
        }
        const created = {
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
    upsertPartOf(bookRecord, chapterRecord, persistBatch) {
        const recordId = this.makePartOfRecordId(bookRecord.recordId, chapterRecord.recordId);
        if (this.partOfEdges.has(recordId))
            return;
        const edge = {
            recordId,
            in: this.makeChapterRef(chapterRecord.recordId),
            out: this.makeBookRef(bookRecord.recordId),
            bookRecordId: bookRecord.recordId,
            chapterRecordId: chapterRecord.recordId,
        };
        this.partOfEdges.set(recordId, edge);
        this.addToPersistBatch(persistBatch, 'part_of', recordId, edge);
    }
    upsertPerson(chapterRecord, person, persistBatch) {
        const normalizedName = normalizeText(person.name);
        const recordId = this.resolvePersonRecordId(normalizedName, person.aliases);
        const existing = this.people.get(recordId);
        if (!existing) {
            const created = {
                recordId,
                localId: stableLocalId('p', normalizedName),
                name: person.name,
                normalizedName,
                aliases: this.mergeStringArrays(undefined, person.aliases),
                importance: person.importance,
                description: person.description,
                roles: this.mergeStringArrays(undefined, person.roles),
                traits: this.mergeStringArrays(undefined, person.traits),
            };
            this.people.set(recordId, created);
            this.indexPersonAliases(created);
            this.upsertEvidence(chapterRecord, 'person', recordId, person.evidence, persistBatch);
            this.addToPersistBatch(persistBatch, 'person', recordId, created);
            return created;
        }
        const updated = {
            ...existing,
            aliases: this.mergeStringArrays(existing.aliases, person.aliases),
            importance: this.strongestPersonImportance([existing.importance, person.importance]),
            description: existing.description ?? person.description,
            roles: this.mergeStringArrays(existing.roles, person.roles),
            traits: this.mergeStringArrays(existing.traits, person.traits),
        };
        this.people.set(recordId, updated);
        this.reindexPersonAliases(existing, updated);
        this.upsertEvidence(chapterRecord, 'person', recordId, person.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'person', recordId, updated);
        return updated;
    }
    upsertConcept(chapterRecord, idea, persistBatch) {
        const normalizedLabel = normalizeConceptLabel(idea.label);
        const recordId = this.makeGlobalRecordId('concept', normalizedLabel);
        const existing = this.concepts.get(recordId);
        if (!existing) {
            const created = {
                recordId,
                localId: stableLocalId('i', normalizedLabel),
                label: idea.label,
                normalizedLabel,
                description: idea.description,
                kind: idea.kind,
            };
            this.concepts.set(recordId, created);
            this.upsertEvidence(chapterRecord, 'concept', recordId, idea.evidence, persistBatch);
            this.addToPersistBatch(persistBatch, 'concept', recordId, created);
            return created;
        }
        const updated = {
            ...existing,
            description: existing.description ?? idea.description,
            kind: existing.kind ?? idea.kind,
        };
        this.concepts.set(recordId, updated);
        this.upsertEvidence(chapterRecord, 'concept', recordId, idea.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'concept', recordId, updated);
        return updated;
    }
    upsertTheme(chapterRecord, theme, persistBatch) {
        const normalizedLabel = normalizeText(theme.label);
        const recordId = this.makeGlobalRecordId('theme', normalizedLabel);
        const existing = this.themes.get(recordId);
        if (!existing) {
            const created = {
                recordId,
                localId: stableLocalId('t', normalizedLabel),
                label: theme.label,
                normalizedLabel,
                description: theme.description,
                strength: theme.strength,
            };
            this.themes.set(recordId, created);
            this.upsertEvidence(chapterRecord, 'theme', recordId, theme.evidence, persistBatch);
            this.addToPersistBatch(persistBatch, 'theme', recordId, created);
            return created;
        }
        const updated = {
            ...existing,
            description: existing.description ?? theme.description,
            strength: this.maxNumber(existing.strength, theme.strength),
        };
        this.themes.set(recordId, updated);
        this.upsertEvidence(chapterRecord, 'theme', recordId, theme.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'theme', recordId, updated);
        return updated;
    }
    upsertEntity(chapterRecord, entity, persistBatch) {
        const normalizedLabel = normalizeText(entity.label);
        const requestedRecordId = this.makeEntityRecordId(entity.type, normalizedLabel);
        const existing = this.findEntityRecordByNormalizedLabel(normalizedLabel, entity.type)
            ?? this.entities.get(requestedRecordId);
        if (!existing) {
            const created = {
                recordId: requestedRecordId,
                localId: stableLocalId('n', `${entity.type}:${normalizedLabel}`),
                label: entity.label,
                normalizedLabel,
                entityType: entity.type,
                description: entity.description,
            };
            this.entities.set(requestedRecordId, created);
            this.upsertEvidence(chapterRecord, 'entity', requestedRecordId, entity.evidence, persistBatch);
            this.addToPersistBatch(persistBatch, 'entity', requestedRecordId, created);
            return created;
        }
        const updated = {
            ...existing,
            entityType: this.preferredEntityType(existing.entityType, entity.type),
            description: existing.description ?? entity.description,
        };
        this.entities.set(existing.recordId, updated);
        this.upsertEvidence(chapterRecord, 'entity', existing.recordId, entity.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'entity', existing.recordId, updated);
        return updated;
    }
    upsertEvent(chapterRecord, input, event, participantRecordIds, persistBatch) {
        const normalizedLabel = normalizeText(event.label);
        const recordId = this.makeEventRecordId(input.bookId, input.chapterId, normalizedLabel);
        const existing = this.events.get(recordId);
        if (!existing) {
            const created = {
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
            };
            this.events.set(recordId, created);
            this.upsertEvidence(chapterRecord, 'event', recordId, event.evidence, persistBatch);
            this.addToPersistBatch(persistBatch, 'event', recordId, created);
            return created;
        }
        const updated = {
            ...existing,
            description: existing.description ?? event.description,
            participantRecordIds: this.mergeStringArrays(existing.participantRecordIds, participantRecordIds),
            timeHint: existing.timeHint ?? event.time_hint,
            placeHint: existing.placeHint ?? event.place_hint,
        };
        this.events.set(recordId, updated);
        this.upsertEvidence(chapterRecord, 'event', recordId, event.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'event', recordId, updated);
        return updated;
    }
    upsertPersonAppearance(chapterRecord, personRecord, person, persistBatch) {
        const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, personRecord.recordId);
        const existing = this.appearances.get(recordId);
        const updated = existing
            ? {
                ...existing,
                aliases: this.mergeStringArrays(existing.aliases, person.aliases),
                importance: this.strongestPersonImportance([existing.importance, person.importance]),
                description: existing.description ?? person.description,
                roles: this.mergeStringArrays(existing.roles, person.roles),
                traits: this.mergeStringArrays(existing.traits, person.traits),
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
                importance: person.importance ?? personRecord.importance,
                description: person.description,
                roles: this.mergeStringArrays(undefined, person.roles),
                traits: this.mergeStringArrays(undefined, person.traits),
            };
        this.appearances.set(recordId, updated);
        this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
        this.upsertEvidence(chapterRecord, 'appears_in', recordId, person.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
    }
    upsertIdeaAppearance(chapterRecord, conceptRecord, idea, persistBatch) {
        const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, conceptRecord.recordId);
        const existing = this.appearances.get(recordId);
        const updated = existing
            ? {
                ...existing,
                description: existing.description ?? idea.description,
                kind: existing.kind ?? idea.kind,
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
            };
        this.appearances.set(recordId, updated);
        this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
        this.upsertEvidence(chapterRecord, 'appears_in', recordId, idea.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
    }
    upsertThemeAppearance(chapterRecord, themeRecord, theme, persistBatch) {
        const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, themeRecord.recordId);
        const existing = this.appearances.get(recordId);
        const updated = existing
            ? {
                ...existing,
                description: existing.description ?? theme.description,
                strength: this.maxNumber(existing.strength, theme.strength),
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
            };
        this.appearances.set(recordId, updated);
        this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
        this.upsertEvidence(chapterRecord, 'appears_in', recordId, theme.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
    }
    upsertEntityAppearance(chapterRecord, entityRecord, entity, persistBatch) {
        const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, entityRecord.recordId);
        const existing = this.appearances.get(recordId);
        const updated = existing
            ? {
                ...existing,
                description: existing.description ?? entity.description,
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
            };
        this.appearances.set(recordId, updated);
        this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
        this.upsertEvidence(chapterRecord, 'appears_in', recordId, entity.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
    }
    upsertEventAppearance(chapterRecord, eventRecord, event, participantRecordIds, persistBatch) {
        const recordId = this.makeAppearanceRecordId(chapterRecord.recordId, eventRecord.recordId);
        const existing = this.appearances.get(recordId);
        const updated = existing
            ? {
                ...existing,
                description: existing.description ?? event.description,
                participantRecordIds: this.mergeStringArrays(existing.participantRecordIds, participantRecordIds),
                timeHint: existing.timeHint ?? event.time_hint,
                placeHint: existing.placeHint ?? event.place_hint,
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
            };
        this.appearances.set(recordId, updated);
        this.ensureSet(this.appearanceIdsByChapter, chapterRecord.recordId).add(recordId);
        this.upsertEvidence(chapterRecord, 'appears_in', recordId, event.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'appears_in', recordId, updated);
    }
    upsertRelation(chapterRecord, relation, persistBatch) {
        const recordId = this.makeRelationRecordId(chapterRecord.recordId, relation.from_id, relation.relation_type, relation.to_id);
        const existing = this.relations.get(recordId);
        const updated = existing
            ? {
                ...existing,
                description: existing.description ?? relation.description,
                confidence: this.maxNumber(existing.confidence, relation.confidence),
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
            };
        this.relations.set(recordId, updated);
        this.ensureSet(this.relationIdsByChapter, chapterRecord.recordId).add(recordId);
        this.upsertEvidence(chapterRecord, 'related_to', recordId, relation.evidence, persistBatch);
        this.addToPersistBatch(persistBatch, 'related_to', recordId, updated);
    }
    countChapter(chapterRecordId) {
        const counts = {
            peopleCount: 0,
            ideaCount: 0,
            eventCount: 0,
            entityCount: 0,
            themeCount: 0,
            relationCount: this.relationIdsByChapter.get(chapterRecordId)?.size ?? 0,
        };
        for (const appearanceId of this.appearanceIdsByChapter.get(chapterRecordId) ?? []) {
            const appearance = this.appearances.get(appearanceId);
            if (!appearance)
                continue;
            if (appearance.nodeType === 'person')
                counts.peopleCount += 1;
            if (appearance.nodeType === 'idea')
                counts.ideaCount += 1;
            if (appearance.nodeType === 'event')
                counts.eventCount += 1;
            if (appearance.nodeType === 'entity')
                counts.entityCount += 1;
            if (appearance.nodeType === 'theme')
                counts.themeCount += 1;
        }
        return counts;
    }
    async clearChapterKnowledge(chapterRecordId) {
        const appearanceIds = Array.from(this.appearanceIdsByChapter.get(chapterRecordId) ?? []);
        const relationIds = Array.from(this.relationIdsByChapter.get(chapterRecordId) ?? []);
        const evidenceIds = this.removeEvidenceForChapter(chapterRecordId);
        for (const appearanceId of appearanceIds) {
            this.appearances.delete(appearanceId);
        }
        for (const relationId of relationIds) {
            this.relations.delete(relationId);
        }
        this.appearanceIdsByChapter.delete(chapterRecordId);
        this.relationIdsByChapter.delete(chapterRecordId);
        if (!this.surrealService)
            return;
        await this.deleteRecords('appears_in', appearanceIds);
        await this.deleteRecords('related_to', relationIds);
        await this.deleteRecords('knowledge_evidence', evidenceIds);
    }
    buildGlobalPeople(appearances, chapterByRecordId) {
        const appearancesByNodeRecordId = new Map();
        for (const appearance of appearances) {
            if (appearance.nodeType !== 'person')
                continue;
            const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
            if (existing) {
                existing.push(appearance);
            }
            else {
                appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
            }
        }
        return Array.from(appearancesByNodeRecordId.entries())
            .map(([nodeRecordId, personAppearances]) => {
            const personRecord = this.people.get(nodeRecordId);
            if (!personRecord)
                return null;
            const evidence = this.aggregateAppearanceEvidence(personAppearances, chapterByRecordId);
            if (evidence.length === 0)
                return null;
            const chapterIndexes = personAppearances
                .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
                .filter((chapterIndex) => chapterIndex !== undefined);
            if (chapterIndexes.length === 0)
                return null;
            return {
                personId: personRecord.recordId,
                canonicalName: personRecord.name,
                aliases: this.sortStringsStrict(personRecord.aliases ?? []),
                importance: this.strongestPersonImportance([
                    personRecord.importance,
                    ...personAppearances.map((appearance) => appearance.importance),
                ]),
                description: this.resolveGlobalPersonDescription(personRecord, personAppearances),
                roles: this.sortStringsStrict(personRecord.roles ?? []),
                traits: this.sortStringsStrict(personRecord.traits ?? []),
                firstSeenIn: Math.min(...chapterIndexes),
                lastSeenIn: Math.max(...chapterIndexes),
                mentionedIn: this.sortNumbers(chapterIndexes),
                evidence,
            };
        })
            .filter((person) => Boolean(person))
            .sort((left, right) => this.compareStrings(left.canonicalName, right.canonicalName, left.personId, right.personId));
    }
    resolveChapterPersonDescription(appearance, chapterRelations) {
        const personRecord = this.people.get(appearance.nodeRecordId);
        return this.resolvePersonDescription({
            name: appearance.name,
            chapterScope: true,
            descriptions: [appearance.description, personRecord?.description],
            relationDescriptions: this.collectRelationDescriptionsForPerson(appearance.nodeRecordId, chapterRelations),
            roles: [...(appearance.roles ?? []), ...(personRecord?.roles ?? [])],
        });
    }
    resolveGlobalPersonDescription(personRecord, appearances) {
        const relatedDescriptions = new Set();
        for (const appearance of appearances) {
            for (const relationId of this.relationIdsByChapter.get(appearance.chapterRecordId) ?? []) {
                const relation = this.relations.get(relationId);
                if (!relation)
                    continue;
                if (relation.fromRecordId !== personRecord.recordId && relation.toRecordId !== personRecord.recordId)
                    continue;
                const description = this.normalizeNonEmptyText(relation.description);
                if (description)
                    relatedDescriptions.add(description);
            }
        }
        return this.resolvePersonDescription({
            name: personRecord.name,
            chapterScope: false,
            descriptions: [personRecord.description, ...appearances.map((appearance) => appearance.description)],
            relationDescriptions: Array.from(relatedDescriptions),
            roles: [...(personRecord.roles ?? []), ...appearances.flatMap((appearance) => appearance.roles ?? [])],
        });
    }
    collectRelationDescriptionsForPerson(nodeRecordId, relations) {
        return relations
            .filter((relation) => relation.fromRecordId === nodeRecordId || relation.toRecordId === nodeRecordId)
            .map((relation) => this.normalizeNonEmptyText(relation.description))
            .filter((description) => Boolean(description));
    }
    resolvePersonDescription(args) {
        for (const description of args.descriptions) {
            const normalized = this.normalizeNonEmptyText(description);
            if (normalized)
                return normalized;
        }
        const relationDescription = this.pickPreferredRelationDescription(args.name, args.relationDescriptions);
        if (relationDescription)
            return relationDescription;
        const roleDescription = this.formatRoleBackfillDescription(args.name, args.roles, args.chapterScope);
        if (roleDescription)
            return roleDescription;
        return args.chapterScope
            ? `${args.name} is mentioned in this chapter.`
            : `${args.name} is mentioned in this book.`;
    }
    pickPreferredRelationDescription(name, descriptions) {
        const unique = Array.from(new Set(descriptions
            .map((description) => this.normalizeNonEmptyText(description))
            .filter((description) => Boolean(description))));
        if (unique.length === 0)
            return undefined;
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fullNamePattern = new RegExp(`\\b${escapedName}\\b`, 'i');
        const surname = name.trim().split(/\s+/).filter(Boolean).at(-1);
        const surnamePattern = surname
            ? new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
            : null;
        const score = (description) => {
            if (fullNamePattern.test(description))
                return 3;
            if (surnamePattern?.test(description))
                return 2;
            return 1;
        };
        return [...unique].sort((left, right) => {
            const scoreDiff = score(right) - score(left);
            if (scoreDiff !== 0)
                return scoreDiff;
            return right.length - left.length;
        })[0];
    }
    formatRoleBackfillDescription(name, roles, chapterScope) {
        const uniqueRoles = this.sortStringsStrict(Array.from(new Set(roles
            .map((role) => role.trim())
            .filter(Boolean))));
        if (uniqueRoles.length === 0)
            return undefined;
        const roleText = uniqueRoles.join(', ');
        return chapterScope
            ? `${name} is mentioned as ${roleText} in this chapter.`
            : `${name} is described as ${roleText} in this book.`;
    }
    normalizeNonEmptyText(value) {
        const normalized = value?.trim();
        return normalized ? normalized : undefined;
    }
    buildGlobalIdeas(appearances, chapterByRecordId) {
        const appearancesByNodeRecordId = new Map();
        for (const appearance of appearances) {
            if (appearance.nodeType !== 'idea')
                continue;
            const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
            if (existing) {
                existing.push(appearance);
            }
            else {
                appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
            }
        }
        return Array.from(appearancesByNodeRecordId.entries())
            .map(([nodeRecordId, ideaAppearances]) => {
            const conceptRecord = this.concepts.get(nodeRecordId);
            if (!conceptRecord)
                return null;
            const evidence = this.aggregateAppearanceEvidence(ideaAppearances, chapterByRecordId);
            if (evidence.length === 0)
                return null;
            const chapterIndexes = ideaAppearances
                .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
                .filter((chapterIndex) => chapterIndex !== undefined);
            if (chapterIndexes.length === 0)
                return null;
            const variants = this.sortStringsStrict([
                ...(ideaAppearances.map((appearance) => appearance.label)),
            ]).filter((variant) => normalizeConceptLabel(variant) !== conceptRecord.normalizedLabel);
            return {
                ideaId: conceptRecord.recordId,
                canonicalLabel: conceptRecord.label,
                variants,
                description: conceptRecord.description,
                status: 'introduced',
                firstSeenIn: Math.min(...chapterIndexes),
                lastSeenIn: Math.max(...chapterIndexes),
                mentionedIn: this.sortNumbers(chapterIndexes),
                evidence,
            };
        })
            .filter((idea) => Boolean(idea))
            .sort((left, right) => this.compareStrings(left.canonicalLabel, right.canonicalLabel, left.ideaId, right.ideaId));
    }
    buildGlobalEntities(appearances, chapterByRecordId) {
        const appearancesByNodeRecordId = new Map();
        for (const appearance of appearances) {
            if (appearance.nodeType !== 'entity')
                continue;
            const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
            if (existing) {
                existing.push(appearance);
            }
            else {
                appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
            }
        }
        return Array.from(appearancesByNodeRecordId.entries())
            .map(([nodeRecordId, entityAppearances]) => {
            const entityRecord = this.entities.get(nodeRecordId);
            if (!entityRecord)
                return null;
            const evidence = this.aggregateAppearanceEvidence(entityAppearances, chapterByRecordId);
            if (evidence.length === 0)
                return null;
            const chapterIndexes = entityAppearances
                .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
                .filter((chapterIndex) => chapterIndex !== undefined);
            if (chapterIndexes.length === 0)
                return null;
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
                evidence,
            };
        })
            .filter((entity) => Boolean(entity))
            .sort((left, right) => this.compareStrings(left.canonicalLabel, right.canonicalLabel, left.entityId, right.entityId));
    }
    buildGlobalThemes(appearances, chapterByRecordId) {
        const appearancesByNodeRecordId = new Map();
        for (const appearance of appearances) {
            if (appearance.nodeType !== 'theme')
                continue;
            const existing = appearancesByNodeRecordId.get(appearance.nodeRecordId);
            if (existing) {
                existing.push(appearance);
            }
            else {
                appearancesByNodeRecordId.set(appearance.nodeRecordId, [appearance]);
            }
        }
        return Array.from(appearancesByNodeRecordId.entries())
            .map(([nodeRecordId, themeAppearances]) => {
            const themeRecord = this.themes.get(nodeRecordId);
            if (!themeRecord)
                return null;
            const evidence = this.aggregateAppearanceEvidence(themeAppearances, chapterByRecordId);
            if (evidence.length === 0)
                return null;
            const chapterIndexes = themeAppearances
                .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
                .filter((chapterIndex) => chapterIndex !== undefined);
            if (chapterIndexes.length === 0)
                return null;
            const variants = this.sortStringsStrict([
                ...themeAppearances.map((appearance) => appearance.label),
            ]).filter((variant) => normalizeText(variant) !== themeRecord.normalizedLabel);
            return {
                themeId: themeRecord.recordId,
                canonicalLabel: themeRecord.label,
                variants,
                strength: themeRecord.strength ?? 0,
                mentionedIn: this.sortNumbers(chapterIndexes),
                evidence,
            };
        })
            .filter((theme) => Boolean(theme))
            .sort((left, right) => this.compareStrings(left.canonicalLabel, right.canonicalLabel, left.themeId, right.themeId));
    }
    buildGlobalEvents(appearances, chapterByRecordId, eventGlobalIdsByRecordId) {
        const appearancesByGlobalEventId = new Map();
        for (const appearance of appearances) {
            if (appearance.nodeType !== 'event')
                continue;
            const globalEventId = eventGlobalIdsByRecordId.get(appearance.nodeRecordId);
            if (!globalEventId)
                continue;
            const existing = appearancesByGlobalEventId.get(globalEventId);
            if (existing) {
                existing.push(appearance);
            }
            else {
                appearancesByGlobalEventId.set(globalEventId, [appearance]);
            }
        }
        return Array.from(appearancesByGlobalEventId.entries())
            .map(([eventId, eventAppearances]) => {
            const evidence = this.aggregateAppearanceEvidence(eventAppearances, chapterByRecordId);
            if (evidence.length === 0)
                return null;
            const chapterIndexes = eventAppearances
                .map((appearance) => chapterByRecordId.get(appearance.chapterRecordId)?.chapterIndex)
                .filter((chapterIndex) => chapterIndex !== undefined);
            if (chapterIndexes.length === 0)
                return null;
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
                evidence,
            };
        })
            .filter((event) => Boolean(event));
    }
    aggregateAppearanceEvidence(appearances, chapterByRecordId) {
        let aggregated = [];
        for (const appearance of appearances) {
            const chapter = chapterByRecordId.get(appearance.chapterRecordId);
            if (!chapter)
                continue;
            aggregated = this.mergeBookEvidenceRefs(aggregated, this.toBookEvidenceRefs(this.getEvidenceForOwner('appears_in', appearance.recordId), chapter));
        }
        return this.sortBookEvidenceRefs(aggregated);
    }
    toBookEvidenceRefs(evidence, chapter) {
        const normalized = this.normalizeEvidenceList(evidence);
        if (!normalized || normalized.length === 0)
            return [];
        return normalized
            .map((item) => ({
            chapterIndex: chapter.chapterIndex,
            chapterId: chapter.chapterId,
            pageIndex: item.pageIndex,
            pageNumber: item.pageNumber,
            quote: item.quote,
        }));
    }
    mergeBookEvidenceRefs(existing, incoming) {
        const merged = [];
        const seen = new Set();
        for (const value of [...existing, ...incoming]) {
            const quote = value.quote?.trim();
            if (!quote)
                continue;
            const key = [
                value.chapterIndex,
                value.chapterId ?? '',
                value.pageIndex ?? -1,
                value.pageNumber ?? -1,
                quote,
            ].join('|');
            if (seen.has(key))
                continue;
            seen.add(key);
            merged.push({
                ...value,
                quote,
            });
        }
        return merged;
    }
    sortBookEvidenceRefs(values) {
        return [...values].sort((left, right) => {
            const chapterDelta = left.chapterIndex - right.chapterIndex;
            if (chapterDelta !== 0)
                return chapterDelta;
            const pageDelta = (left.pageIndex ?? Number.MAX_SAFE_INTEGER) - (right.pageIndex ?? Number.MAX_SAFE_INTEGER);
            if (pageDelta !== 0)
                return pageDelta;
            return (left.quote ?? '').localeCompare(right.quote ?? '');
        });
    }
    sortNumbers(values) {
        return Array.from(new Set(values)).sort((left, right) => left - right);
    }
    sortStringsStrict(values) {
        const unique = this.mergeStringArrays(undefined, values);
        return unique ? unique.sort((left, right) => left.localeCompare(right)) : [];
    }
    pickPreferredText(existing, incoming) {
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
    resolveProjectionNode(nodeType, nodeRecordId, eventGlobalIdsByRecordId) {
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
    linkConfidence(nodeType) {
        if (nodeType === 'person')
            return 0.9;
        if (nodeType === 'idea')
            return 0.88;
        if (nodeType === 'event')
            return 0.86;
        if (nodeType === 'entity')
            return 0.9;
        return 0.84;
    }
    deduplicateChapterLinks(links) {
        const seen = new Set();
        return [...links]
            .sort((left, right) => this.compareStrings(`${left.chapterIndex}:${left.localType}:${left.localId}:${left.globalType}:${left.globalId}`, `${right.chapterIndex}:${right.localType}:${right.localId}:${right.globalType}:${right.globalId}`, left.chapterId, right.chapterId))
            .filter((link) => {
            const key = [
                link.chapterId,
                link.chapterIndex,
                link.localType,
                link.localId,
                link.globalType,
                link.globalId,
            ].join('|');
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
    createEmptyIdRemap() {
        return {
            person: new Map(),
            idea: new Map(),
            event: new Map(),
            entity: new Map(),
            theme: new Map(),
        };
    }
    remapNodeId(type, localId, remap) {
        return remap[type].get(localId);
    }
    remapNodeIds(ids, remap) {
        if (!ids || ids.length === 0)
            return undefined;
        return this.mergeStringArrays(undefined, ids.map((id) => remap.get(id)).filter((item) => Boolean(item)));
    }
    upsertEvidence(chapterRecord, ownerTable, ownerRecordId, evidence, persistBatch) {
        for (const item of evidence ?? []) {
            const normalized = this.normalizeEvidence(item);
            if (!normalized)
                continue;
            const recordId = this.makeEvidenceRecordId(ownerTable, ownerRecordId, normalized);
            if (this.evidences.has(recordId))
                continue;
            const record = {
                recordId,
                bookId: chapterRecord.bookId,
                chapterId: chapterRecord.chapterId,
                chapterRecordId: chapterRecord.recordId,
                ownerTable,
                ownerRecordId,
                pageIndex: normalized.pageIndex,
                pageNumber: normalized.pageNumber,
                quote: normalized.quote,
                quoteHash: hashText(normalized.quote),
                createdAt: new Date().toISOString(),
            };
            this.addEvidenceToIndexes(record);
            this.addToPersistBatch(persistBatch, 'knowledge_evidence', recordId, record);
        }
    }
    addEvidenceToIndexes(record) {
        if (this.evidences.has(record.recordId))
            return;
        this.evidences.set(record.recordId, record);
        this.ensureSet(this.evidenceIdsByOwner, this.makeEvidenceOwnerKey(record.ownerTable, record.ownerRecordId)).add(record.recordId);
    }
    getEvidenceForOwner(ownerTable, ownerRecordId) {
        const evidence = Array.from(this.evidenceIdsByOwner.get(this.makeEvidenceOwnerKey(ownerTable, ownerRecordId)) ?? [])
            .map((recordId) => this.evidences.get(recordId))
            .filter((record) => Boolean(record))
            .map((record) => ({
            quote: record.quote,
            pageIndex: record.pageIndex,
            pageNumber: record.pageNumber,
        }));
        return this.normalizeEvidenceList(evidence);
    }
    removeEvidenceForChapter(chapterRecordId) {
        const recordIds = Array.from(this.evidences.values())
            .filter((record) => record.chapterRecordId === chapterRecordId)
            .map((record) => record.recordId);
        for (const recordId of recordIds) {
            const record = this.evidences.get(recordId);
            if (!record)
                continue;
            const ownerKey = this.makeEvidenceOwnerKey(record.ownerTable, record.ownerRecordId);
            const ownerSet = this.evidenceIdsByOwner.get(ownerKey);
            ownerSet?.delete(recordId);
            if (ownerSet?.size === 0) {
                this.evidenceIdsByOwner.delete(ownerKey);
            }
            this.evidences.delete(recordId);
        }
        return recordIds;
    }
    normalizeEvidence(value) {
        const quote = value.quote?.trim();
        if (!quote)
            return null;
        if (typeof value.pageIndex !== 'number' || typeof value.pageNumber !== 'number')
            return null;
        return {
            quote: truncatePrefix(quote, EVIDENCE_QUOTE_PREFIX_LIMIT_CHARS),
            pageIndex: value.pageIndex,
            pageNumber: value.pageNumber,
        };
    }
    normalizeEvidenceList(values) {
        if (!values || values.length === 0)
            return undefined;
        const normalized = values
            .map((value) => this.normalizeEvidence(value))
            .filter((value) => value !== null);
        return this.sortEvidence(normalized);
    }
    hasRequiredEvidence(evidence) {
        return (this.normalizeEvidenceList(evidence)?.length ?? 0) > 0;
    }
    ownerHasRequiredEvidence(ownerTable, ownerRecordId) {
        return this.hasRequiredEvidence(this.getEvidenceForOwner(ownerTable, ownerRecordId));
    }
    enforceEvidenceCoverageOnGraphExtraction(extraction) {
        const nodeEvidence = this.groupGraphEvidence(extraction.evidence, 'node');
        const keptNodeIds = new Set(extraction.nodes
            .filter((node) => this.hasRequiredEvidence(nodeEvidence.get(node.id)))
            .map((node) => node.id));
        const edgeEvidence = this.groupGraphEvidence(extraction.evidence, 'edge');
        const keptEdgeIds = new Set(extraction.edges
            .filter((edge) => this.hasRequiredEvidence(edgeEvidence.get(edge.id))
            && keptNodeIds.has(edge.from)
            && keptNodeIds.has(edge.to))
            .map((edge) => edge.id));
        return {
            ...extraction,
            nodes: extraction.nodes.filter((node) => keptNodeIds.has(node.id)),
            edges: extraction.edges.filter((edge) => keptEdgeIds.has(edge.id)),
            evidence: extraction.evidence.filter((item) => (item.owner_kind === 'node'
                ? keptNodeIds.has(item.owner_id)
                : keptEdgeIds.has(item.owner_id))),
        };
    }
    isOversizedForSurreal(record) {
        return jsonByteSize(record) > SURREAL_RECORD_SOFT_LIMIT_BYTES;
    }
    mergeStringArrays(existing, incoming) {
        const values = [...(existing ?? []), ...(incoming ?? [])];
        if (values.length === 0)
            return undefined;
        const merged = [];
        const seen = new Set();
        for (const value of values) {
            const normalized = normalizeText(value);
            if (!normalized || seen.has(normalized))
                continue;
            seen.add(normalized);
            merged.push(value.trim());
        }
        return merged.length > 0 ? merged : undefined;
    }
    maxNumber(existing, incoming) {
        if (existing === undefined)
            return incoming;
        if (incoming === undefined)
            return existing;
        return Math.max(existing, incoming);
    }
    strongestPersonImportance(values) {
        let strongest;
        for (const value of values) {
            if (!value)
                continue;
            if (!strongest || this.personImportanceRank(value) > this.personImportanceRank(strongest)) {
                strongest = value;
            }
        }
        return strongest;
    }
    personImportanceRank(value) {
        switch (value) {
            case 'main':
                return 3;
            case 'supporting':
                return 2;
            case 'minor':
                return 1;
        }
    }
    sortStrings(values) {
        if (!values || values.length === 0)
            return undefined;
        return [...values].sort((left, right) => left.localeCompare(right));
    }
    sortEvidence(values) {
        if (!values || values.length === 0)
            return undefined;
        return [...values].sort((left, right) => {
            const pageDelta = (left.pageIndex ?? Number.MAX_SAFE_INTEGER) - (right.pageIndex ?? Number.MAX_SAFE_INTEGER);
            if (pageDelta !== 0)
                return pageDelta;
            return left.quote.localeCompare(right.quote);
        });
    }
    compareStrings(leftValue, rightValue, leftFallback, rightFallback) {
        const delta = leftValue.localeCompare(rightValue);
        if (delta !== 0)
            return delta;
        return leftFallback.localeCompare(rightFallback);
    }
    makeBookRecordId(bookId) {
        return `book_${encodeSegment(bookId)}`;
    }
    makeChapterRecordId(bookId, chapterId) {
        return `chapter_${encodeSegment(bookId)}_${encodeSegment(chapterId)}`;
    }
    makeChapterSnapshotRecordId(bookId, chapterId) {
        return `chapter_snapshot_${encodeSegment(bookId)}_${encodeSegment(chapterId)}`;
    }
    makePageExtractionCacheKey(bookId, chapterId, pageIndex, sourceHash, chapterContentHash, promptVersion) {
        return [
            'page_cache',
            encodeSegment(bookId),
            encodeSegment(chapterId),
            pageIndex,
            encodeSegment(sourceHash),
            encodeSegment(chapterContentHash),
            encodeSegment(promptVersion),
        ].join('_');
    }
    shouldReadThroughSurreal() {
        return runtime_config_1.config.knowledgeExtractionReadThroughSurreal && Boolean(this.surrealService);
    }
    makeEvidenceOwnerKey(ownerTable, ownerRecordId) {
        return `${ownerTable}:${ownerRecordId}`;
    }
    makeEvidenceRecordId(ownerTable, ownerRecordId, evidence) {
        return `evidence_${encodeSegment([
            ownerTable,
            ownerRecordId,
            evidence.pageIndex ?? -1,
            evidence.pageNumber ?? -1,
            evidence.quote,
        ].join('|'))}`;
    }
    makeRecordRef(table, recordId) {
        return `${table}:${recordId}`;
    }
    makeBookRef(recordId) {
        return this.makeRecordRef('book', recordId);
    }
    makeChapterRef(recordId) {
        return this.makeRecordRef('chapter', recordId);
    }
    makePersonRef(recordId) {
        return this.makeRecordRef('person', recordId);
    }
    makeConceptRef(recordId) {
        return this.makeRecordRef('concept', recordId);
    }
    makeThemeRef(recordId) {
        return this.makeRecordRef('theme', recordId);
    }
    makeEntityRef(recordId) {
        return this.makeRecordRef('entity', recordId);
    }
    makeEventRef(recordId) {
        return this.makeRecordRef('event', recordId);
    }
    tableForNodeType(nodeType) {
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
    makeBookEventProjectionId(bookId, normalizedLabel) {
        return `global_event_${encodeSegment(bookId)}_${encodeSegment(normalizedLabel)}`;
    }
    makeProjectedRelationId(key) {
        return `global_relation_${encodeSegment(key)}`;
    }
    makeGlobalRecordId(table, normalizedValue) {
        return `${table}_${encodeSegment(normalizedValue)}`;
    }
    makeEntityRecordId(entityType, normalizedLabel) {
        return `entity_${encodeSegment(entityType)}_${encodeSegment(normalizedLabel)}`;
    }
    findEntityRecordByNormalizedLabel(normalizedLabel, preferredType) {
        const matches = Array.from(this.entities.values())
            .filter((record) => record.normalizedLabel === normalizedLabel);
        if (matches.length === 0)
            return undefined;
        return matches.sort((left, right) => {
            const rightPreferred = this.preferredEntityType(right.entityType, preferredType);
            const leftPreferred = this.preferredEntityType(left.entityType, preferredType);
            const rightScore = Number(right.entityType === rightPreferred);
            const leftScore = Number(left.entityType === leftPreferred);
            if (rightScore !== leftScore)
                return rightScore - leftScore;
            return this.entityTypePriority(right.entityType) - this.entityTypePriority(left.entityType);
        })[0];
    }
    preferredEntityType(left, right) {
        return this.entityTypePriority(right) > this.entityTypePriority(left) ? right : left;
    }
    entityTypePriority(entityType) {
        switch (entityType) {
            case 'organization':
                return 5;
            case 'place':
                return 4;
            case 'time':
                return 3;
            case 'object':
                return 2;
            case 'other':
            default:
                return 1;
        }
    }
    makeEventRecordId(bookId, chapterId, normalizedLabel) {
        return `event_${encodeSegment(bookId)}_${encodeSegment(chapterId)}_${encodeSegment(normalizedLabel)}`;
    }
    makeAppearanceRecordId(chapterRecordId, nodeRecordId) {
        return `appears_in_${encodeSegment(chapterRecordId)}_${encodeSegment(nodeRecordId)}`;
    }
    makeRelationRecordId(chapterRecordId, fromRecordId, relationType, toRecordId) {
        return `related_to_${encodeSegment(chapterRecordId)}_${encodeSegment(fromRecordId)}_${encodeSegment(relationType)}_${encodeSegment(toRecordId)}`;
    }
    makePartOfRecordId(bookRecordId, chapterRecordId) {
        return `part_of_${encodeSegment(bookRecordId)}_${encodeSegment(chapterRecordId)}`;
    }
    ensureSet(target, key) {
        const existing = target.get(key);
        if (existing)
            return existing;
        const created = new Set();
        target.set(key, created);
        return created;
    }
    resolvePersonRecordId(normalizedName, aliases) {
        const byName = this.makeGlobalRecordId('person', normalizedName);
        if (this.people.has(byName))
            return byName;
        for (const alias of aliases ?? []) {
            const normalizedAlias = normalizeText(alias);
            if (!normalizedAlias)
                continue;
            const recordIds = this.personRecordIdsByAlias.get(normalizedAlias);
            if (recordIds?.size === 1) {
                return Array.from(recordIds)[0];
            }
        }
        return byName;
    }
    indexPersonAliases(person) {
        for (const alias of person.aliases ?? []) {
            const normalizedAlias = normalizeText(alias);
            if (!normalizedAlias)
                continue;
            this.ensureSet(this.personRecordIdsByAlias, normalizedAlias).add(person.recordId);
        }
    }
    reindexPersonAliases(previous, next) {
        for (const alias of previous.aliases ?? []) {
            const normalizedAlias = normalizeText(alias);
            if (!normalizedAlias)
                continue;
            const ids = this.personRecordIdsByAlias.get(normalizedAlias);
            ids?.delete(previous.recordId);
            if (ids?.size === 0) {
                this.personRecordIdsByAlias.delete(normalizedAlias);
            }
        }
        this.indexPersonAliases(next);
    }
    addToPersistBatch(persistBatch, table, id, record) {
        persistBatch.set(`${table}:${id}`, { table, id, record });
    }
    async persistBatch(persistBatch) {
        if (!this.surrealService)
            return;
        for (const entry of persistBatch.values()) {
            await this.persistRecord(entry.table, entry.id, entry.record);
        }
    }
    async deleteRecords(table, ids) {
        if (!this.surrealService || ids.length === 0)
            return;
        await this.surrealService.query(ids.map((id) => `DELETE ONLY ${table}:${id};`).join('\n'));
    }
    schedulePersist(task) {
        if (!this.surrealService)
            return;
        this.pendingPersist = this.pendingPersist
            .then(task)
            .catch((error) => {
            console.error('[knowledge-extraction] failed to persist repository state', error);
        });
    }
    withoutEvidence(record) {
        if (!('evidence' in record))
            return record;
        const { evidence: _evidence, ...rest } = record;
        return rest;
    }
    withoutPageCacheExtraction(record) {
        const { extraction: _extraction, ...rest } = record;
        return rest;
    }
    async persistRecord(table, id, record) {
        if (!this.surrealService)
            return;
        if (table === 'appears_in' || table === 'related_to' || table === 'part_of') {
            const relationRecord = this.withoutEvidence(record);
            await this.surrealService.putRelationRecord(table, id, relationRecord.in, relationRecord.out, relationRecord);
            return;
        }
        if (table === 'workflow_run') {
            const workflowRun = record;
            let persistedRun = workflowRun.output
                ? { ...workflowRun, output: this.createSlimResult(workflowRun.output) }
                : workflowRun;
            persistedRun = {
                ...persistedRun,
                partialPieceResults: this.createPersistablePartialPieceResults(persistedRun.partialPieceResults),
            };
            if (this.isOversizedForSurreal(persistedRun) && persistedRun.partialPieceResults) {
                console.warn(`[knowledge-extraction] dropping partial piece results before persisting oversized workflow_run:${id}`);
                persistedRun = {
                    ...persistedRun,
                    partialPieceResults: undefined,
                };
            }
            try {
                await this.surrealService.putRecord(table, id, persistedRun);
            }
            catch (error) {
                if (isSurrealLengthLimitError(error) && persistedRun.partialPieceResults) {
                    console.warn(`[knowledge-extraction] retrying ${table}:${id} without partial piece results after HTTP 413 length limit`);
                    await this.surrealService.putRecord(table, id, {
                        ...persistedRun,
                        partialPieceResults: undefined,
                    });
                    return;
                }
                throw error;
            }
            return;
        }
        if (table === 'chapter_knowledge_snapshot') {
            const snapshot = record;
            const persistedSnapshot = {
                ...snapshot,
                result: this.createSlimResult(snapshot.result),
            };
            await this.surrealService.putRecord(table, id, persistedSnapshot);
            return;
        }
        if (table === 'person'
            || table === 'concept'
            || table === 'theme'
            || table === 'entity'
            || table === 'event') {
            await this.surrealService.putRecord(table, id, this.withoutEvidence(record));
            return;
        }
        if (table === 'page_knowledge_extraction_cache') {
            const pageCacheRecord = record;
            const slimRecord = this.withoutPageCacheExtraction(pageCacheRecord);
            try {
                await this.surrealService.putRecord(table, id, slimRecord);
            }
            catch (error) {
                if (isSurrealLengthLimitError(error)) {
                    console.warn(`[knowledge-extraction] skipping Surreal persist for ${table}:${id} after slim metadata hit HTTP 413 length limit`);
                    return;
                }
                throw error;
            }
            return;
        }
        try {
            await this.surrealService.putRecord(table, id, record);
        }
        catch (error) {
            throw error;
        }
    }
};
exports.KnowledgeExtractionWorkflowRepository = KnowledgeExtractionWorkflowRepository;
exports.KnowledgeExtractionWorkflowRepository = KnowledgeExtractionWorkflowRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)(surrealdb_service_1.SurrealService)),
    __metadata("design:paramtypes", [surrealdb_service_1.SurrealService])
], KnowledgeExtractionWorkflowRepository);
//# sourceMappingURL=knowledge-extraction-workflow.repository.js.map