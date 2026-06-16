"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreReadingWorkflowRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const chapterKey = (bookId, chapterId) => `${bookId}::${chapterId}`;
let PreReadingWorkflowRepository = class PreReadingWorkflowRepository {
    runs = new Map();
    runIdsByIdempotencyKey = new Map();
    latestResultsByChapter = new Map();
    createOrReuseRun(input) {
        const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
        const existingRun = existingRunId ? this.runs.get(existingRunId) : undefined;
        if (existingRun && existingRun.status !== 'failed' && existingRun.status !== 'stale') {
            return { run: existingRun, deduped: true };
        }
        if (existingRunId) {
            this.runIdsByIdempotencyKey.delete(input.idempotencyKey);
        }
        const timestamp = new Date().toISOString();
        const run = {
            id: (0, node_crypto_1.randomUUID)(),
            kind: 'pre_reading_generation',
            status: 'queued',
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            workflowVersion: input.workflowVersion,
            idempotencyKey: input.idempotencyKey,
            expectedSnapshotVersion: input.expectedSnapshotVersion,
            expectedChapterContentHash: input.expectedChapterContentHash,
            requestedByUserId: input.requestedByUserId,
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
    findLatestRunForChapter(bookId, chapterId) {
        return Array.from(this.runs.values())
            .filter((run) => run.bookId === bookId && run.chapterId === chapterId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
    }
    markRunning(workflowRunId) {
        const run = this.runs.get(workflowRunId);
        if (!run || run.status !== 'queued')
            return null;
        return this.store({
            ...run,
            status: 'running',
            startedAt: run.startedAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            error: undefined,
        });
    }
    completeRun(args) {
        const run = this.runs.get(args.workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        const updated = this.store({
            ...run,
            status: 'completed',
            snapshotVersion: args.snapshotVersion,
            chapterContentHash: args.chapterContentHash,
            output: args.result,
            error: undefined,
            updatedAt: timestamp,
            completedAt: timestamp,
        });
        this.latestResultsByChapter.set(chapterKey(updated.bookId, updated.chapterId), {
            workflowRunId: updated.id,
            bookId: updated.bookId,
            chapterId: updated.chapterId,
            chapterIndex: updated.chapterIndex,
            workflowVersion: updated.workflowVersion,
            resultVersion: updated.resultVersion,
            snapshotVersion: args.snapshotVersion,
            chapterContentHash: args.chapterContentHash,
            result: args.result,
            createdAt: updated.createdAt,
            updatedAt: timestamp,
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
    finishWithError(workflowRunId, status, code, message) {
        const run = this.runs.get(workflowRunId);
        if (!run)
            return null;
        const timestamp = new Date().toISOString();
        return this.store({
            ...run,
            status,
            error: { code, message },
            updatedAt: timestamp,
            completedAt: timestamp,
        });
    }
    store(run) {
        this.runs.set(run.id, run);
        return run;
    }
};
exports.PreReadingWorkflowRepository = PreReadingWorkflowRepository;
exports.PreReadingWorkflowRepository = PreReadingWorkflowRepository = __decorate([
    (0, common_1.Injectable)()
], PreReadingWorkflowRepository);
//# sourceMappingURL=pre-reading-workflow.repository.js.map