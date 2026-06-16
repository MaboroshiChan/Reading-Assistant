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
exports.ChapterOpenAnalysisService = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const chapter_keywords_workflow_service_1 = require("../chapter-keywords-workflow/chapter-keywords-workflow.service");
const chapter_keywords_workflow_repository_1 = require("../chapter-keywords-workflow/chapter-keywords-workflow.repository");
const knowledge_extraction_workflow_repository_1 = require("../knowledge-extraction-workflow/knowledge-extraction-workflow.repository");
const knowledge_extraction_workflow_service_1 = require("../knowledge-extraction-workflow/knowledge-extraction-workflow.service");
const quiz_workflow_repository_1 = require("../quiz-workflow/quiz-workflow.repository");
const workflow_queue_service_1 = require("../workflow-queue/workflow-queue.service");
const pre_reading_workflow_repository_1 = require("../pre-reading-workflow/pre-reading-workflow.repository");
const pre_reading_workflow_service_1 = require("../pre-reading-workflow/pre-reading-workflow.service");
const chapter_open_analysis_repository_1 = require("./chapter-open-analysis.repository");
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
let ChapterOpenAnalysisService = class ChapterOpenAnalysisService {
    bookIngestionRepository;
    chapterOpenAnalysisRepository;
    chapterKeywordsWorkflowService;
    chapterKeywordsWorkflowRepository;
    knowledgeExtractionWorkflowService;
    knowledgeExtractionWorkflowRepository;
    quizWorkflowRepository;
    workflowQueueService;
    preReadingWorkflowService;
    preReadingWorkflowRepository;
    constructor(bookIngestionRepository, chapterOpenAnalysisRepository, chapterKeywordsWorkflowService, chapterKeywordsWorkflowRepository, knowledgeExtractionWorkflowService, knowledgeExtractionWorkflowRepository, quizWorkflowRepository, workflowQueueService, preReadingWorkflowService, preReadingWorkflowRepository) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.chapterOpenAnalysisRepository = chapterOpenAnalysisRepository;
        this.chapterKeywordsWorkflowService = chapterKeywordsWorkflowService;
        this.chapterKeywordsWorkflowRepository = chapterKeywordsWorkflowRepository;
        this.knowledgeExtractionWorkflowService = knowledgeExtractionWorkflowService;
        this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
        this.quizWorkflowRepository = quizWorkflowRepository;
        this.workflowQueueService = workflowQueueService;
        this.preReadingWorkflowService = preReadingWorkflowService;
        this.preReadingWorkflowRepository = preReadingWorkflowRepository;
    }
    parseSubmitRequest(bookId, chapterId, rawBody) {
        if (!rawBody || rawBody.trim() === '') {
            throw new common_1.BadRequestException('Request body cannot be empty');
        }
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch (error) {
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed)) {
            throw new common_1.BadRequestException('Request body must be a JSON object');
        }
        return {
            bookId,
            chapterId,
            chapterIndex: this.requireNonNegativeInteger(parsed.chapterIndex, 'chapterIndex'),
            pipelineVersion: parsed.pipelineVersion === undefined
                ? 'v1'
                : this.requireString(parsed.pipelineVersion, 'pipelineVersion'),
            idempotencyKey: parsed.idempotencyKey === undefined
                ? undefined
                : this.requireString(parsed.idempotencyKey, 'idempotencyKey'),
            expectedSnapshotVersion: parsed.expectedSnapshotVersion === undefined
                ? undefined
                : this.requireNonNegativeInteger(parsed.expectedSnapshotVersion, 'expectedSnapshotVersion'),
            expectedChapterContentHash: parsed.expectedChapterContentHash === undefined
                ? undefined
                : this.requireString(parsed.expectedChapterContentHash, 'expectedChapterContentHash'),
            clientSessionId: parsed.clientSessionId === undefined
                ? undefined
                : this.requireString(parsed.clientSessionId, 'clientSessionId'),
            trigger: parsed.trigger === undefined
                ? undefined
                : this.requireString(parsed.trigger, 'trigger'),
        };
    }
    submitChapterOpenAnalysis(request) {
        const book = this.bookIngestionRepository.getBook(request.bookId);
        const chapter = this.bookIngestionRepository.getChapter(request.bookId, request.chapterId);
        if (!book || !chapter) {
            throw new common_1.NotFoundException('Chapter not found in canonical ingestion state');
        }
        if (chapter.chapterIndex !== request.chapterIndex) {
            throw new common_1.ConflictException('chapterIndex does not match canonical chapter state');
        }
        if (request.expectedChapterContentHash !== undefined
            && request.expectedChapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.ConflictException('expectedChapterContentHash does not match canonical chapter state');
        }
        if (chapter.chapterTextMaterialized.trim().length === 0) {
            throw new common_1.ConflictException('Canonical chapter text is empty; ingest pages before opening analysis');
        }
        const expectedSnapshotVersion = this.resolveExpectedSnapshotVersion(request.expectedSnapshotVersion, request.expectedChapterContentHash, book.snapshotVersion, chapter.chapterContentHash);
        const input = {
            bookId: request.bookId,
            chapterId: request.chapterId,
            chapterIndex: request.chapterIndex,
            pipelineVersion: request.pipelineVersion,
            idempotencyKey: request.idempotencyKey ?? this.buildDefaultIdempotencyKey(request.bookId, request.chapterId, request.pipelineVersion, chapter.chapterContentHash),
            expectedSnapshotVersion,
            expectedChapterContentHash: request.expectedChapterContentHash ?? chapter.chapterContentHash,
            clientSessionId: request.clientSessionId,
            trigger: request.trigger,
        };
        const { run, deduped } = this.chapterOpenAnalysisRepository.createOrReuseRun(input);
        if (!deduped) {
            this.workflowQueueService.enqueue(() => this.executeRun(run.id));
        }
        const canonicalRun = deduped ? this.chapterOpenAnalysisRepository.getRun(run.id) ?? run : run;
        const reconciliation = this.reconcileRun(canonicalRun);
        return {
            chapterAnalysisRunId: canonicalRun.id,
            status: reconciliation.run.status,
            deduped,
            pipelineVersion: canonicalRun.pipelineVersion,
            bookId: canonicalRun.bookId,
            chapterId: canonicalRun.chapterId,
            chapterIndex: canonicalRun.chapterIndex,
            snapshotVersion: reconciliation.run.snapshotVersion,
            chapterContentHash: reconciliation.run.chapterContentHash,
            tasks: reconciliation.tasks,
        };
    }
    getChapterOpenAnalysisStatus(bookId, chapterId) {
        const run = this.resolveLatestRun(bookId, chapterId);
        if (!run) {
            throw new common_1.NotFoundException('No chapter open analysis run found for chapter');
        }
        const reconciliation = this.reconcileRun(run);
        return {
            chapterAnalysisRunId: reconciliation.run.id,
            status: reconciliation.run.status,
            pipelineVersion: reconciliation.run.pipelineVersion,
            bookId: reconciliation.run.bookId,
            chapterId: reconciliation.run.chapterId,
            chapterIndex: reconciliation.run.chapterIndex,
            snapshotVersion: reconciliation.run.snapshotVersion,
            chapterContentHash: reconciliation.run.chapterContentHash,
            tasks: reconciliation.tasks,
            progress: reconciliation.progress,
            error: reconciliation.run.error,
            createdAt: reconciliation.run.createdAt,
            updatedAt: reconciliation.run.updatedAt,
            startedAt: reconciliation.run.startedAt,
            completedAt: reconciliation.run.completedAt,
        };
    }
    getChapterOpenAnalysisResult(bookId, chapterId) {
        const run = this.resolveLatestRun(bookId, chapterId);
        if (!run) {
            throw new common_1.NotFoundException('No chapter open analysis run found for chapter');
        }
        const reconciliation = this.reconcileRun(run);
        return {
            chapterAnalysisRunId: reconciliation.run.id,
            status: reconciliation.run.status,
            pipelineVersion: reconciliation.run.pipelineVersion,
            bookId: reconciliation.run.bookId,
            chapterId: reconciliation.run.chapterId,
            chapterIndex: reconciliation.run.chapterIndex,
            snapshotVersion: reconciliation.run.snapshotVersion,
            chapterContentHash: reconciliation.run.chapterContentHash,
            data: reconciliation.aggregateResult,
        };
    }
    async executeRun(runId) {
        const run = this.chapterOpenAnalysisRepository.getRun(runId);
        if (!run)
            return;
        const book = this.bookIngestionRepository.getBook(run.bookId);
        const chapter = this.bookIngestionRepository.getChapter(run.bookId, run.chapterId);
        if (!book || !chapter) {
            this.chapterOpenAnalysisRepository.finish(runId, 'failed', {
                code: 'CHAPTER_OPEN_ANALYSIS_CHAPTER_NOT_FOUND',
                message: 'Canonical chapter state was not found during chapter open analysis execution.',
            });
            return;
        }
        this.chapterOpenAnalysisRepository.markRunning(runId, book.snapshotVersion, chapter.chapterContentHash);
        try {
            if (!this.preReadingWorkflowService) {
                throw new Error('Pre-reading workflow service is unavailable');
            }
            const preReading = this.preReadingWorkflowService.submitPreReadingWorkflow({
                bookId: run.bookId,
                chapterId: run.chapterId,
                chapterIndex: run.chapterIndex,
                workflowVersion: 'v1',
                expectedSnapshotVersion: book.snapshotVersion,
                expectedChapterContentHash: chapter.chapterContentHash,
            }, { enqueue: false });
            this.chapterOpenAnalysisRepository.attachChildRuns({
                runId,
                preReadingWorkflowRunId: preReading.workflowRunId,
            });
            await this.preReadingWorkflowService.executeRun(preReading.workflowRunId);
            const chapterKeywords = this.chapterKeywordsWorkflowService.submitChapterKeywordsWorkflow({
                bookId: run.bookId,
                chapterId: run.chapterId,
                chapterIndex: run.chapterIndex,
                workflowVersion: 'v1',
                expectedSnapshotVersion: book.snapshotVersion,
                expectedChapterContentHash: chapter.chapterContentHash,
            });
            const knowledgeExtraction = this.knowledgeExtractionWorkflowService.submitKnowledgeExtractionWorkflow({
                bookId: run.bookId,
                chapterId: run.chapterId,
                chapterIndex: run.chapterIndex,
                workflowVersion: 'v1',
                expectedSnapshotVersion: book.snapshotVersion,
                expectedChapterContentHash: chapter.chapterContentHash,
            });
            this.chapterOpenAnalysisRepository.attachChildRuns({
                runId,
                chapterKeywordsWorkflowRunId: chapterKeywords.workflowRunId,
                knowledgeExtractionWorkflowRunId: knowledgeExtraction.workflowRunId,
            });
            this.reconcileRun(this.chapterOpenAnalysisRepository.getRun(runId) ?? run);
        }
        catch (error) {
            this.chapterOpenAnalysisRepository.finish(runId, 'failed', {
                code: 'CHAPTER_OPEN_ANALYSIS_SUBMISSION_FAILED',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    reconcileRun(run) {
        let currentRun = this.chapterOpenAnalysisRepository.getRun(run.id) ?? run;
        const book = this.bookIngestionRepository.getBook(currentRun.bookId);
        const chapter = this.bookIngestionRepository.getChapter(currentRun.bookId, currentRun.chapterId);
        if (!book || !chapter) {
            currentRun = this.chapterOpenAnalysisRepository.finish(currentRun.id, 'failed', {
                code: 'CHAPTER_OPEN_ANALYSIS_CHAPTER_NOT_FOUND',
                message: 'Canonical chapter state is no longer available.',
            }) ?? currentRun;
            return {
                run: currentRun,
                tasks: {
                    preReading: { status: 'failed', workflowRunId: currentRun.preReadingWorkflowRunId, error: currentRun.error },
                    chapterKeywords: { status: 'failed', workflowRunId: currentRun.chapterKeywordsWorkflowRunId, error: currentRun.error },
                    knowledgeExtraction: { status: 'failed', workflowRunId: currentRun.knowledgeExtractionWorkflowRunId, error: currentRun.error },
                    quiz: { status: 'failed', workflowRunId: currentRun.quizWorkflowRunId, error: currentRun.error },
                },
                aggregateResult: {
                    preReading: null,
                    chapterKeywords: null,
                    knowledgeExtraction: null,
                    quiz: null,
                },
            };
        }
        if (currentRun.expectedSnapshotVersion !== undefined
            && currentRun.expectedSnapshotVersion !== book.snapshotVersion) {
            currentRun = this.chapterOpenAnalysisRepository.finish(currentRun.id, 'stale', {
                code: 'CHAPTER_OPEN_ANALYSIS_CANONICAL_BOOK_STALE',
                message: 'Canonical book snapshot changed before chapter open analysis completed.',
            }) ?? currentRun;
        }
        else if (currentRun.expectedChapterContentHash !== undefined
            && currentRun.expectedChapterContentHash !== chapter.chapterContentHash) {
            currentRun = this.chapterOpenAnalysisRepository.finish(currentRun.id, 'stale', {
                code: 'CHAPTER_OPEN_ANALYSIS_CANONICAL_CHAPTER_STALE',
                message: 'Canonical chapter content changed before chapter open analysis completed.',
            }) ?? currentRun;
        }
        else {
            currentRun = this.chapterOpenAnalysisRepository.updateSnapshot(currentRun.id, book.snapshotVersion, chapter.chapterContentHash) ?? currentRun;
        }
        const preReadingRun = currentRun.preReadingWorkflowRunId
            ? this.preReadingWorkflowRepository?.getRun(currentRun.preReadingWorkflowRunId) ?? null
            : null;
        const latestPreReadingRun = preReadingRun
            ?? this.preReadingWorkflowRepository?.findLatestRunForChapter(currentRun.bookId, currentRun.chapterId) ?? null;
        const preReadingLatest = this.preReadingWorkflowRepository?.getLatestResult(currentRun.bookId, currentRun.chapterId) ?? null;
        const chapterKeywordsRun = currentRun.chapterKeywordsWorkflowRunId
            ? this.chapterKeywordsWorkflowRepository.getRun(currentRun.chapterKeywordsWorkflowRunId)
            : null;
        const latestChapterKeywordsRun = chapterKeywordsRun
            ?? (typeof this.chapterKeywordsWorkflowRepository.findLatestRunForChapter === 'function'
                ? this.chapterKeywordsWorkflowRepository.findLatestRunForChapter(currentRun.bookId, currentRun.chapterId)
                : null);
        const chapterKeywordsLatest = this.chapterKeywordsWorkflowRepository.getLatestResult(currentRun.bookId, currentRun.chapterId);
        const knowledgeRun = currentRun.knowledgeExtractionWorkflowRunId
            ? this.knowledgeExtractionWorkflowRepository.getRun(currentRun.knowledgeExtractionWorkflowRunId)
            : null;
        const latestKnowledgeRun = knowledgeRun
            ?? (typeof this.knowledgeExtractionWorkflowRepository.findLatestRunForChapter === 'function'
                ? this.knowledgeExtractionWorkflowRepository.findLatestRunForChapter(currentRun.bookId, currentRun.chapterId)
                : null);
        const knowledgeLatest = this.knowledgeExtractionWorkflowRepository.getLatestResult(currentRun.bookId, currentRun.chapterId);
        const quizLatest = this.quizWorkflowRepository.getLatestResult(currentRun.bookId, currentRun.chapterId);
        const latestQuizRun = typeof this.quizWorkflowRepository.findLatestRunForChapter === 'function'
            ? this.quizWorkflowRepository.findLatestRunForChapter(currentRun.bookId, currentRun.chapterId)
            : null;
        const matchesExpected = (snapshotVersion, contentHash) => snapshotVersion !== undefined
            && contentHash !== undefined
            && snapshotVersion === currentRun.expectedSnapshotVersion
            && contentHash === currentRun.expectedChapterContentHash;
        const preReadingResult = preReadingLatest && matchesExpected(preReadingLatest.snapshotVersion, preReadingLatest.chapterContentHash)
            ? preReadingLatest.result
            : null;
        const chapterKeywordsResult = chapterKeywordsLatest && matchesExpected(chapterKeywordsLatest.snapshotVersion, chapterKeywordsLatest.chapterContentHash)
            ? chapterKeywordsLatest.result
            : null;
        const knowledgeResult = knowledgeLatest && matchesExpected(knowledgeLatest.snapshotVersion, knowledgeLatest.chapterContentHash)
            ? knowledgeLatest.result
            : null;
        const quizResult = quizLatest && matchesExpected(quizLatest.snapshotVersion, quizLatest.chapterContentHash)
            ? quizLatest.result
            : null;
        const preReadingTask = preReadingResult
            ? {
                status: 'completed',
                workflowRunId: preReadingLatest?.workflowRunId ?? latestPreReadingRun?.id,
            }
            : this.taskFromChildRun(latestPreReadingRun?.status, latestPreReadingRun?.id, latestPreReadingRun?.error);
        const chapterKeywordsTask = chapterKeywordsResult
            ? {
                status: 'completed',
                workflowRunId: chapterKeywordsLatest?.workflowRunId ?? latestChapterKeywordsRun?.id,
            }
            : (preReadingTask.status === 'queued' || preReadingTask.status === 'running')
                && !latestChapterKeywordsRun
                ? { status: 'blocked', blockedBy: 'preReading' }
                : this.taskFromChildRun(latestChapterKeywordsRun?.status, latestChapterKeywordsRun?.id, latestChapterKeywordsRun?.error);
        const knowledgeTask = knowledgeResult
            ? {
                status: 'completed',
                workflowRunId: knowledgeLatest?.workflowRunId ?? latestKnowledgeRun?.id,
            }
            : (preReadingTask.status === 'queued' || preReadingTask.status === 'running')
                && !latestKnowledgeRun
                ? { status: 'blocked', blockedBy: 'preReading' }
                : this.taskFromChildRun(latestKnowledgeRun?.status, latestKnowledgeRun?.id, latestKnowledgeRun?.error);
        const quizTask = (() => {
            if (quizResult) {
                return {
                    status: 'completed',
                    workflowRunId: quizLatest?.workflowRunId,
                };
            }
            if (knowledgeTask.status === 'completed') {
                if (latestQuizRun) {
                    return this.taskFromChildRun(latestQuizRun.status, latestQuizRun.id, latestQuizRun.error);
                }
                return { status: 'queued' };
            }
            if (knowledgeTask.status === 'failed' || knowledgeTask.status === 'stale') {
                return {
                    status: 'failed',
                    blockedBy: 'knowledgeExtraction',
                    error: knowledgeTask.error,
                };
            }
            return {
                status: 'blocked',
                blockedBy: 'knowledgeExtraction',
            };
        })();
        if (quizLatest?.workflowRunId && currentRun.quizWorkflowRunId !== quizLatest.workflowRunId) {
            currentRun = this.chapterOpenAnalysisRepository.attachChildRuns({
                runId: currentRun.id,
                quizWorkflowRunId: quizLatest.workflowRunId,
            }) ?? currentRun;
        }
        const completedCount = [
            Boolean(preReadingResult),
            Boolean(chapterKeywordsResult),
            Boolean(knowledgeResult),
            Boolean(quizResult),
        ].filter(Boolean).length;
        const hasActiveTask = [preReadingTask, chapterKeywordsTask, knowledgeTask, quizTask]
            .some((task) => task.status === 'queued' || task.status === 'running' || task.status === 'blocked');
        const hasTerminalFailure = [preReadingTask, chapterKeywordsTask, knowledgeTask, quizTask]
            .some((task) => task.status === 'failed' || task.status === 'stale');
        const aggregateStatus = (() => {
            if (currentRun.status === 'stale')
                return 'stale';
            if (completedCount === 4)
                return 'completed';
            if (hasActiveTask)
                return 'running';
            if (hasTerminalFailure)
                return completedCount > 0 ? 'partial' : 'failed';
            return completedCount > 0 ? 'partial' : currentRun.status;
        })();
        const progress = this.deriveProgress({
            aggregateStatus,
            knowledgeTask,
            knowledgeRun: latestKnowledgeRun,
            chapterKeywordsTask,
            preReadingTask,
        });
        if (currentRun.status !== aggregateStatus) {
            if (aggregateStatus === 'running') {
                currentRun = this.chapterOpenAnalysisRepository.markRunning(currentRun.id, book.snapshotVersion, chapter.chapterContentHash) ?? currentRun;
            }
            else {
                currentRun = this.chapterOpenAnalysisRepository.finish(currentRun.id, aggregateStatus, aggregateStatus === 'failed' ? {
                    code: 'CHAPTER_OPEN_ANALYSIS_TASK_FAILED',
                    message: 'One or more chapter analysis tasks failed before producing any usable result.',
                } : undefined) ?? currentRun;
            }
        }
        return {
            run: currentRun,
            tasks: {
                preReading: preReadingTask,
                chapterKeywords: chapterKeywordsTask,
                knowledgeExtraction: knowledgeTask,
                quiz: quizTask,
            },
            progress,
            aggregateResult: {
                preReading: preReadingResult,
                chapterKeywords: chapterKeywordsResult,
                knowledgeExtraction: knowledgeResult,
                quiz: quizResult,
            },
        };
    }
    resolveLatestRun(bookId, chapterId) {
        const run = this.chapterOpenAnalysisRepository.getLatestRun(bookId, chapterId);
        if (run)
            return run;
        return this.synthesizeLatestRun(bookId, chapterId);
    }
    taskFromChildRun(status, workflowRunId, error) {
        switch (status) {
            case 'completed':
                return { status: 'completed', workflowRunId };
            case 'running':
                return { status: 'running', workflowRunId };
            case 'failed':
                return { status: 'failed', workflowRunId, error };
            case 'stale':
                return { status: 'stale', workflowRunId, error };
            case 'queued':
            default:
                return { status: 'queued', workflowRunId };
        }
    }
    buildDefaultIdempotencyKey(bookId, chapterId, pipelineVersion, chapterContentHash) {
        return `chapter-open:${pipelineVersion}:${bookId}:${chapterId}:${chapterContentHash}`;
    }
    synthesizeLatestRun(bookId, chapterId) {
        const book = this.bookIngestionRepository.getBook(bookId);
        const chapter = this.bookIngestionRepository.getChapter(bookId, chapterId);
        if (!book || !chapter)
            return null;
        const preReadingRun = this.preReadingWorkflowRepository?.findLatestRunForChapter(bookId, chapterId) ?? null;
        const preReadingLatest = this.preReadingWorkflowRepository?.getLatestResult(bookId, chapterId) ?? null;
        const chapterKeywordsRun = typeof this.chapterKeywordsWorkflowRepository.findLatestRunForChapter === 'function'
            ? this.chapterKeywordsWorkflowRepository.findLatestRunForChapter(bookId, chapterId)
            : null;
        const chapterKeywordsLatest = this.chapterKeywordsWorkflowRepository.getLatestResult(bookId, chapterId);
        const knowledgeRun = typeof this.knowledgeExtractionWorkflowRepository.findLatestRunForChapter === 'function'
            ? this.knowledgeExtractionWorkflowRepository.findLatestRunForChapter(bookId, chapterId)
            : null;
        const knowledgeLatest = this.knowledgeExtractionWorkflowRepository.getLatestResult(bookId, chapterId);
        const quizRun = typeof this.quizWorkflowRepository.findLatestRunForChapter === 'function'
            ? this.quizWorkflowRepository.findLatestRunForChapter(bookId, chapterId)
            : null;
        const quizLatest = this.quizWorkflowRepository.getLatestResult(bookId, chapterId);
        if (!preReadingRun
            && !preReadingLatest
            && !chapterKeywordsRun
            && !chapterKeywordsLatest
            && !knowledgeRun
            && !knowledgeLatest
            && !quizRun
            && !quizLatest) {
            return null;
        }
        const timestamps = [
            preReadingRun?.createdAt,
            preReadingRun?.updatedAt,
            preReadingLatest?.createdAt,
            preReadingLatest?.updatedAt,
            chapterKeywordsRun?.createdAt,
            chapterKeywordsRun?.updatedAt,
            chapterKeywordsLatest?.createdAt,
            chapterKeywordsLatest?.updatedAt,
            knowledgeRun?.createdAt,
            knowledgeRun?.updatedAt,
            knowledgeLatest?.createdAt,
            knowledgeLatest?.updatedAt,
            quizRun?.createdAt,
            quizRun?.updatedAt,
            quizLatest?.createdAt,
            quizLatest?.updatedAt,
        ].filter((value) => Boolean(value));
        const sortedTimestamps = timestamps.sort((left, right) => left.localeCompare(right));
        const createdAt = sortedTimestamps[0] ?? new Date().toISOString();
        const updatedAt = sortedTimestamps[sortedTimestamps.length - 1] ?? createdAt;
        return {
            id: `recovered:${bookId}:${chapterId}`,
            kind: 'chapter_open_analysis',
            status: 'running',
            bookId,
            chapterId,
            chapterIndex: chapter.chapterIndex,
            pipelineVersion: 'v1',
            idempotencyKey: this.buildDefaultIdempotencyKey(bookId, chapterId, 'v1', chapter.chapterContentHash),
            expectedSnapshotVersion: book.snapshotVersion,
            expectedChapterContentHash: chapter.chapterContentHash,
            snapshotVersion: book.snapshotVersion,
            chapterContentHash: chapter.chapterContentHash,
            preReadingWorkflowRunId: preReadingRun?.id ?? preReadingLatest?.workflowRunId,
            chapterKeywordsWorkflowRunId: chapterKeywordsRun?.id ?? chapterKeywordsLatest?.workflowRunId,
            knowledgeExtractionWorkflowRunId: knowledgeRun?.id ?? knowledgeLatest?.workflowRunId,
            quizWorkflowRunId: quizRun?.id ?? quizLatest?.workflowRunId,
            createdAt,
            updatedAt,
            startedAt: createdAt,
        };
    }
    deriveProgress(args) {
        if (args.aggregateStatus !== 'running') {
            return undefined;
        }
        if (args.preReadingTask.status === 'running') {
            return {
                percent: 5,
                stage: 'generate_pre_reading',
                message: '正在准备章节导读',
            };
        }
        if (args.knowledgeTask.status === 'running' || args.knowledgeTask.status === 'queued') {
            return {
                percent: args.knowledgeRun?.progress?.percent ?? 0,
                stage: args.knowledgeRun?.progress?.stage ?? 'queued',
                message: args.knowledgeRun?.progress?.message ?? '正在排队',
            };
        }
        if (args.preReadingTask.status === 'queued') {
            return {
                percent: 0,
                stage: 'queued_pre_reading',
                message: '章节导读正在排队',
            };
        }
        if (args.chapterKeywordsTask.status === 'running' || args.chapterKeywordsTask.status === 'queued') {
            return {
                percent: 0,
                stage: 'queued',
                message: '正在排队',
            };
        }
        return undefined;
    }
    requireString(value, field) {
        const result = asString(value);
        if (!result) {
            throw new common_1.BadRequestException(`${field} must be a non-empty string`);
        }
        return result;
    }
    requireNonNegativeInteger(value, field) {
        const result = asNumber(value);
        if (result === undefined || !Number.isInteger(result) || result < 0) {
            throw new common_1.BadRequestException(`${field} must be a non-negative integer`);
        }
        return result;
    }
    resolveExpectedSnapshotVersion(expectedSnapshotVersion, expectedChapterContentHash, canonicalSnapshotVersion, canonicalChapterContentHash) {
        if (expectedSnapshotVersion === undefined || expectedSnapshotVersion === canonicalSnapshotVersion) {
            return canonicalSnapshotVersion;
        }
        if (expectedChapterContentHash !== undefined
            && expectedChapterContentHash === canonicalChapterContentHash) {
            return canonicalSnapshotVersion;
        }
        throw new common_1.ConflictException('expectedSnapshotVersion does not match canonical book state');
    }
};
exports.ChapterOpenAnalysisService = ChapterOpenAnalysisService;
exports.ChapterOpenAnalysisService = ChapterOpenAnalysisService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(book_ingestion_repository_1.BookIngestionRepository)),
    __param(1, (0, common_1.Inject)(chapter_open_analysis_repository_1.ChapterOpenAnalysisRepository)),
    __param(2, (0, common_1.Inject)(chapter_keywords_workflow_service_1.ChapterKeywordsWorkflowService)),
    __param(3, (0, common_1.Inject)(chapter_keywords_workflow_repository_1.ChapterKeywordsWorkflowRepository)),
    __param(4, (0, common_1.Inject)(knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService)),
    __param(5, (0, common_1.Inject)(knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository)),
    __param(6, (0, common_1.Inject)(quiz_workflow_repository_1.QuizWorkflowRepository)),
    __param(7, (0, common_1.Inject)(workflow_queue_service_1.WorkflowQueueService)),
    __param(8, (0, common_1.Inject)(pre_reading_workflow_service_1.PreReadingWorkflowService)),
    __param(9, (0, common_1.Inject)(pre_reading_workflow_repository_1.PreReadingWorkflowRepository)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        chapter_open_analysis_repository_1.ChapterOpenAnalysisRepository,
        chapter_keywords_workflow_service_1.ChapterKeywordsWorkflowService,
        chapter_keywords_workflow_repository_1.ChapterKeywordsWorkflowRepository,
        knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService,
        knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository,
        quiz_workflow_repository_1.QuizWorkflowRepository,
        workflow_queue_service_1.WorkflowQueueService,
        pre_reading_workflow_service_1.PreReadingWorkflowService,
        pre_reading_workflow_repository_1.PreReadingWorkflowRepository])
], ChapterOpenAnalysisService);
//# sourceMappingURL=chapter-open-analysis.service.js.map