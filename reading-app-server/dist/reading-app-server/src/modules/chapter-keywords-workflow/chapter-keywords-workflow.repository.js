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
exports.ChapterKeywordsWorkflowRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const workflow_logger_1 = require("../workflow.logger");
const surrealdb_service_1 = require("../surrealDB/surrealdb.service");
const chapterKey = (bookId, chapterId) => `${bookId}::${chapterId}`;
const normalizeWorkflowRunId = (value) => value.startsWith('chapter_keywords_workflow_run:')
    ? value.slice('chapter_keywords_workflow_run:'.length)
    : value;
let ChapterKeywordsWorkflowRepository = class ChapterKeywordsWorkflowRepository {
    surrealService;
    runs = new Map();
    runIdsByIdempotencyKey = new Map();
    latestResultsByChapter = new Map();
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
            id: (0, node_crypto_1.randomUUID)(),
            kind: 'chapter_keywords',
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
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', run.id, run));
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
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
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
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
        return updated;
    }
    updatePartialChunkResult(workflowRunId, partialChunkResult) {
        const run = this.runs.get(workflowRunId);
        if (!run || (run.status !== 'queued' && run.status !== 'running'))
            return null;
        const nextResults = (run.partialChunkResults ?? [])
            .filter((item) => item.chunkIndex !== partialChunkResult.chunkIndex)
            .concat(partialChunkResult)
            .sort((left, right) => left.chunkIndex - right.chunkIndex);
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            partialChunkResults: nextResults,
            updatedAt: timestamp,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
        return updated;
    }
    clearPartialChunkResults(workflowRunId) {
        const run = this.runs.get(workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        const updated = {
            ...run,
            partialChunkResults: undefined,
            updatedAt: timestamp,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
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
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
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
            startedAt: undefined,
            completedAt: undefined,
            checkpoint: mode === 'resume' ? run.checkpoint : undefined,
            partialChunkResults: mode === 'resume' ? run.partialChunkResults : undefined,
            updatedAt: timestamp,
            deduped: false,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
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
            checkpoint: undefined,
            partialChunkResults: undefined,
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
            await this.persistRecord('chapter_keywords_workflow_run', updated.id, updated);
            await this.persistRecord('chapter_keyword_results', this.makeStoredResultId(updated.bookId, updated.chapterId), storedResult);
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
            resultSentenceCount: args.result.key_sentences.length,
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
    findLatestRunForChapter(bookId, chapterId) {
        const candidates = Array.from(this.runs.values())
            .filter((run) => run.bookId === bookId && run.chapterId === chapterId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return candidates[0] ?? null;
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
            updatedAt: timestamp,
            completedAt: timestamp,
            deduped: false,
        };
        this.runs.set(workflowRunId, updated);
        this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
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
    async ensureSchema() {
        if (!this.surrealService)
            return;
        await this.surrealService.query([
            'DEFINE TABLE IF NOT EXISTS chapter_keywords_workflow_run SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS chapter_keyword_results SCHEMALESS;',
        ].join('\n'));
    }
    async loadFromStore() {
        if (!this.surrealService)
            return;
        const [workflowRuns, results] = await Promise.all([
            this.surrealService.selectTable('chapter_keywords_workflow_run'),
            this.surrealService.selectTable('chapter_keyword_results'),
        ]);
        this.runs.clear();
        this.runIdsByIdempotencyKey.clear();
        this.latestResultsByChapter.clear();
        for (const result of results) {
            const hydratedResult = {
                ...result,
                workflowRunId: normalizeWorkflowRunId(result.workflowRunId),
            };
            this.latestResultsByChapter.set(chapterKey(result.bookId, result.chapterId), hydratedResult);
        }
        for (const run of workflowRuns) {
            const hydratedRun = {
                ...run,
                id: normalizeWorkflowRunId(run.id),
            };
            this.runs.set(hydratedRun.id, hydratedRun);
            this.runIdsByIdempotencyKey.set(hydratedRun.idempotencyKey, hydratedRun.id);
        }
    }
    makeStoredResultId(bookId, chapterId) {
        return `${bookId}::${chapterId}`;
    }
    schedulePersist(task) {
        if (!this.surrealService)
            return;
        this.pendingPersist = this.pendingPersist
            .then(task)
            .catch((error) => {
            console.error('[chapter-keywords] failed to persist repository state', error);
        });
    }
    async persistRecord(table, id, record) {
        if (!this.surrealService)
            return;
        await this.surrealService.putRecord(table, id, record);
    }
};
exports.ChapterKeywordsWorkflowRepository = ChapterKeywordsWorkflowRepository;
exports.ChapterKeywordsWorkflowRepository = ChapterKeywordsWorkflowRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)(surrealdb_service_1.SurrealService)),
    __metadata("design:paramtypes", [surrealdb_service_1.SurrealService])
], ChapterKeywordsWorkflowRepository);
//# sourceMappingURL=chapter-keywords-workflow.repository.js.map