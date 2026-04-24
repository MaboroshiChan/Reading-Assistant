"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeExtractionWorkflowRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const chapterKey = (bookId, chapterId) => `${bookId}::${chapterId}`;
let KnowledgeExtractionWorkflowRepository = class KnowledgeExtractionWorkflowRepository {
    runs = new Map();
    runIdsByIdempotencyKey = new Map();
    latestResultsByChapter = new Map();
    createOrReuseRun(input) {
        const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
        if (existingRunId) {
            const existingRun = this.runs.get(existingRunId);
            if (existingRun) {
                return {
                    run: { ...existingRun, deduped: true },
                    deduped: true,
                };
            }
        }
        const timestamp = new Date().toISOString();
        const run = {
            id: (0, node_crypto_1.randomUUID)(),
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
        return { run, deduped: false };
    }
    getRun(workflowRunId) {
        return this.runs.get(workflowRunId) ?? null;
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
        return updated;
    }
};
exports.KnowledgeExtractionWorkflowRepository = KnowledgeExtractionWorkflowRepository;
exports.KnowledgeExtractionWorkflowRepository = KnowledgeExtractionWorkflowRepository = __decorate([
    (0, common_1.Injectable)()
], KnowledgeExtractionWorkflowRepository);
//# sourceMappingURL=knowledge-extraction-workflow.repository.js.map