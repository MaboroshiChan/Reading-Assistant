"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterOpenAnalysisRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const workflow_logger_1 = require("../workflow.logger");
const chapterKey = (bookId, chapterId) => `${bookId}::${chapterId}`;
let ChapterOpenAnalysisRepository = class ChapterOpenAnalysisRepository {
    runs = new Map();
    runIdsByIdempotencyKey = new Map();
    latestRunIdsByChapter = new Map();
    createOrReuseRun(input) {
        const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
        if (existingRunId) {
            const existingRun = this.runs.get(existingRunId);
            if (existingRun) {
                if (existingRun.status === 'failed' || existingRun.status === 'stale') {
                    this.runIdsByIdempotencyKey.delete(input.idempotencyKey);
                }
                else {
                    return {
                        run: { ...existingRun },
                        deduped: true,
                    };
                }
            }
        }
        const timestamp = new Date().toISOString();
        const run = {
            id: (0, node_crypto_1.randomUUID)(),
            kind: 'chapter_open_analysis',
            status: 'queued',
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            pipelineVersion: input.pipelineVersion,
            idempotencyKey: input.idempotencyKey,
            expectedSnapshotVersion: input.expectedSnapshotVersion,
            expectedChapterContentHash: input.expectedChapterContentHash,
            clientSessionId: input.clientSessionId,
            trigger: input.trigger,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.runs.set(run.id, run);
        this.runIdsByIdempotencyKey.set(input.idempotencyKey, run.id);
        this.latestRunIdsByChapter.set(chapterKey(run.bookId, run.chapterId), run.id);
        (0, workflow_logger_1.workflowLog)('run.queued', {
            workflowKind: run.kind,
            workflowRunId: run.id,
            bookId: run.bookId,
            chapterId: run.chapterId,
            chapterIndex: run.chapterIndex,
            pipelineVersion: run.pipelineVersion,
            idempotencyKey: run.idempotencyKey,
        });
        return { run, deduped: false };
    }
    getRun(runId) {
        return this.runs.get(runId) ?? null;
    }
    getLatestRun(bookId, chapterId) {
        const runId = this.latestRunIdsByChapter.get(chapterKey(bookId, chapterId));
        return runId ? this.runs.get(runId) ?? null : null;
    }
    markRunning(runId, snapshotVersion, chapterContentHash) {
        return this.update(runId, (run) => ({
            ...run,
            status: 'running',
            snapshotVersion: snapshotVersion ?? run.snapshotVersion,
            chapterContentHash: chapterContentHash ?? run.chapterContentHash,
            startedAt: run.startedAt ?? new Date().toISOString(),
            completedAt: undefined,
            error: undefined,
        }));
    }
    attachChildRuns(args) {
        return this.update(args.runId, (run) => ({
            ...run,
            preReadingWorkflowRunId: args.preReadingWorkflowRunId ?? run.preReadingWorkflowRunId,
            chapterKeywordsWorkflowRunId: args.chapterKeywordsWorkflowRunId ?? run.chapterKeywordsWorkflowRunId,
            knowledgeExtractionWorkflowRunId: args.knowledgeExtractionWorkflowRunId ?? run.knowledgeExtractionWorkflowRunId,
            quizWorkflowRunId: args.quizWorkflowRunId ?? run.quizWorkflowRunId,
        }));
    }
    finish(runId, status, error) {
        return this.update(runId, (run) => ({
            ...run,
            status,
            error,
            completedAt: new Date().toISOString(),
        }));
    }
    updateSnapshot(runId, snapshotVersion, chapterContentHash) {
        return this.update(runId, (run) => ({
            ...run,
            snapshotVersion,
            chapterContentHash,
        }));
    }
    update(runId, mutate) {
        const run = this.runs.get(runId);
        if (!run)
            return null;
        const updated = {
            ...mutate(run),
            updatedAt: new Date().toISOString(),
        };
        this.runs.set(runId, updated);
        this.latestRunIdsByChapter.set(chapterKey(updated.bookId, updated.chapterId), updated.id);
        return updated;
    }
};
exports.ChapterOpenAnalysisRepository = ChapterOpenAnalysisRepository;
exports.ChapterOpenAnalysisRepository = ChapterOpenAnalysisRepository = __decorate([
    (0, common_1.Injectable)()
], ChapterOpenAnalysisRepository);
//# sourceMappingURL=chapter-open-analysis.repository.js.map