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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeExtractionWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const promises_1 = __importDefault(require("node:fs/promises"));
const llmService_1 = require("../../../services/llmService");
const runtime_config_1 = require("../../config/runtime-config");
const chapter_prefix_cache_1 = require("../../utils/chapter-prefix-cache");
const prompt_path_1 = require("../../utils/prompt-path");
const book_context_service_1 = require("../book-ingestion/book-context.service");
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const quiz_workflow_service_1 = require("../quiz-workflow/quiz-workflow.service");
const workflow_logger_1 = require("../workflow.logger");
const knowledge_extraction_workflow_repository_1 = require("./knowledge-extraction-workflow.repository");
const workflow_queue_service_1 = require("../workflow-queue/workflow-queue.service");
const PROMPT_VERSION = 'knowledge_extraction.v2.3';
const PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('knowledge_extraction.txt');
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
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const CONTEXT_HEAVY_IDEA_TOKENS = [
    'book',
    'chapter',
    'client',
    'campaign',
    'chewing gum',
    'smith',
    'clinton',
    'teacher',
    'sumo',
    'home',
    'election',
];
let cachedSystemPrompt = null;
let KnowledgeExtractionWorkflowService = class KnowledgeExtractionWorkflowService {
    bookIngestionRepository;
    bookContextService;
    knowledgeExtractionWorkflowRepository;
    workflowQueueService;
    moduleRef;
    constructor(bookIngestionRepository, bookContextService, knowledgeExtractionWorkflowRepository, workflowQueueService, moduleRef) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.bookContextService = bookContextService;
        this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
        this.workflowQueueService = workflowQueueService;
        this.moduleRef = moduleRef;
    }
    onApplicationBootstrap() {
        for (const run of this.knowledgeExtractionWorkflowRepository.listRecoverableRuns()) {
            (0, workflow_logger_1.workflowLog)('run.recovered', {
                workflowKind: run.kind,
                workflowRunId: run.id,
                bookId: run.bookId,
                chapterId: run.chapterId,
                chapterIndex: run.chapterIndex,
                workflowVersion: run.workflowVersion,
                status: run.status,
            });
            this.workflowQueueService.enqueue(() => this.executeRun(run.id));
        }
    }
    parseSubmitRequest(rawBody) {
        if (!rawBody || rawBody.trim() === '') {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'knowledge_extraction',
                reason: 'empty_body',
            });
            throw new common_1.BadRequestException('Request body cannot be empty');
        }
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch (error) {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'knowledge_extraction',
                reason: 'invalid_json',
                error: error instanceof Error ? error.message : String(error),
            });
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed)) {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'knowledge_extraction',
                reason: 'non_object_body',
            });
            throw new common_1.BadRequestException('Request body must be a JSON object');
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
        (0, workflow_logger_1.workflowLog)('request.parsed', {
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
    submitKnowledgeExtractionWorkflow(request) {
        const book = this.bookIngestionRepository.getBook(request.bookId);
        const chapter = this.bookIngestionRepository.getChapter(request.bookId, request.chapterId);
        if (!book || !chapter) {
            throw new common_1.NotFoundException('Chapter not found in canonical ingestion state');
        }
        if (chapter.chapterIndex !== request.chapterIndex) {
            throw new common_1.ConflictException('chapterIndex does not match canonical chapter state');
        }
        if (request.expectedSnapshotVersion !== undefined
            && request.expectedSnapshotVersion !== book.snapshotVersion) {
            throw new common_1.ConflictException('expectedSnapshotVersion does not match canonical book state');
        }
        if (request.expectedChapterContentHash !== undefined
            && request.expectedChapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.ConflictException('expectedChapterContentHash does not match canonical chapter state');
        }
        if (chapter.chapterTextMaterialized.trim().length === 0) {
            throw new common_1.ConflictException('Canonical chapter text is empty; ingest pages before submitting knowledge extraction workflow');
        }
        const input = {
            ...request,
            idempotencyKey: request.idempotencyKey ?? this.buildDefaultIdempotencyKey(request.bookId, request.chapterId, request.workflowVersion, chapter.chapterContentHash),
            expectedSnapshotVersion: request.expectedSnapshotVersion ?? book.snapshotVersion,
            expectedChapterContentHash: request.expectedChapterContentHash ?? chapter.chapterContentHash,
        };
        const reusableRun = this.findReusableCompletedRun(input.bookId, input.chapterId, input.expectedSnapshotVersion, input.expectedChapterContentHash);
        if (reusableRun) {
            (0, workflow_logger_1.workflowLog)('run.submitted', {
                workflowKind: reusableRun.kind,
                workflowRunId: reusableRun.id,
                bookId: reusableRun.bookId,
                chapterId: reusableRun.chapterId,
                chapterIndex: reusableRun.chapterIndex,
                workflowVersion: reusableRun.workflowVersion,
                deduped: true,
                status: reusableRun.status,
                reusedFromLatestResult: true,
            });
            return this.toSubmitResponse(reusableRun, true);
        }
        if (runtime_config_1.config.requireKnowledgeExtractionCache) {
            throw new common_1.ConflictException('Knowledge extraction cache is required, but no completed cached result matches the canonical chapter state');
        }
        const { run, deduped } = this.knowledgeExtractionWorkflowRepository.createOrReuseRun(input);
        if (!deduped) {
            this.workflowQueueService.enqueue(() => this.executeRun(run.id));
        }
        const canonicalRun = deduped
            ? this.knowledgeExtractionWorkflowRepository.getRun(run.id) ?? run
            : run;
        (0, workflow_logger_1.workflowLog)('run.submitted', {
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
    getWorkflowStatus(workflowRunId) {
        const run = this.requireRun(workflowRunId);
        (0, workflow_logger_1.workflowLog)('status.read_hit', {
            workflowKind: run.kind,
            workflowRunId: run.id,
            bookId: run.bookId,
            chapterId: run.chapterId,
            status: run.status,
            resultAvailable: Boolean(run.output),
        });
        return this.toStatusResponse(run);
    }
    getWorkflowResult(workflowRunId) {
        const run = this.requireRun(workflowRunId);
        if (run.status !== 'completed'
            || !run.output
            || run.snapshotVersion === undefined
            || !run.chapterContentHash) {
            throw new common_1.ConflictException('Knowledge extraction workflow result is not available yet');
        }
        (0, workflow_logger_1.workflowLog)('result.read_hit', {
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
    getLatestChapterKnowledgeExtraction(bookId, chapterId) {
        const result = this.knowledgeExtractionWorkflowRepository.getLatestResult(bookId, chapterId);
        if (!result) {
            (0, workflow_logger_1.workflowLog)('latest_result.read_miss', {
                workflowKind: 'knowledge_extraction',
                bookId,
                chapterId,
            });
            throw new common_1.NotFoundException('No completed knowledge extraction workflow result found for chapter');
        }
        (0, workflow_logger_1.workflowLog)('latest_result.read_hit', {
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
    async executeRun(workflowRunId) {
        const runningRun = this.knowledgeExtractionWorkflowRepository.markRunning(workflowRunId);
        if (!runningRun)
            return;
        const book = this.bookIngestionRepository.getBook(runningRun.bookId);
        const chapter = this.bookIngestionRepository.getChapter(runningRun.bookId, runningRun.chapterId);
        if (!book || !chapter) {
            this.knowledgeExtractionWorkflowRepository.failRun(workflowRunId, 'KNOWLEDGE_EXTRACTION_CHAPTER_NOT_FOUND', 'Canonical chapter state was not found during workflow execution.');
            return;
        }
        if (runningRun.expectedSnapshotVersion !== undefined
            && runningRun.expectedSnapshotVersion !== book.snapshotVersion) {
            this.knowledgeExtractionWorkflowRepository.markStale(workflowRunId, 'KNOWLEDGE_EXTRACTION_CANONICAL_BOOK_STALE', 'Canonical book snapshot changed before knowledge extraction workflow execution completed.');
            return;
        }
        if (runningRun.expectedChapterContentHash !== undefined
            && runningRun.expectedChapterContentHash !== chapter.chapterContentHash) {
            this.knowledgeExtractionWorkflowRepository.markStale(workflowRunId, 'KNOWLEDGE_EXTRACTION_CANONICAL_CHAPTER_STALE', 'Canonical chapter content changed before knowledge extraction workflow execution completed.');
            return;
        }
        if (chapter.chapterTextMaterialized.trim().length === 0) {
            this.knowledgeExtractionWorkflowRepository.failRun(workflowRunId, 'KNOWLEDGE_EXTRACTION_EMPTY_CHAPTER_TEXT', 'Canonical chapter text is empty; unable to extract knowledge.');
            return;
        }
        const pieces = this.buildPieces(chapter);
        if (pieces.length === 0) {
            this.knowledgeExtractionWorkflowRepository.failRun(workflowRunId, 'KNOWLEDGE_EXTRACTION_EMPTY_CHAPTER_TEXT', 'Canonical chapter text is empty; unable to extract knowledge.');
            return;
        }
        try {
            const result = await this.generateKnowledgeExtraction({
                bookId: runningRun.bookId,
                chapterId: runningRun.chapterId,
                chapterIndex: runningRun.chapterIndex,
                chapterTitle: chapter.chapterTitle,
                chapterText: chapter.chapterTextMaterialized,
                chapterContentHash: chapter.chapterContentHash,
                pieces,
            });
            const completedRun = this.knowledgeExtractionWorkflowRepository.completeRun({
                workflowRunId,
                snapshotVersion: book.snapshotVersion,
                chapterContentHash: chapter.chapterContentHash,
                result,
            });
            (0, workflow_logger_1.workflowLog)('extraction.finished', {
                workflowKind: runningRun.kind,
                workflowRunId: runningRun.id,
                bookId: runningRun.bookId,
                chapterId: runningRun.chapterId,
                chapterIndex: runningRun.chapterIndex,
                workflowVersion: runningRun.workflowVersion,
                snapshotVersion: book.snapshotVersion,
                chapterContentHash: chapter.chapterContentHash,
                pieceCount: pieces.length,
                peopleCount: result.people?.length ?? 0,
                ideaCount: result.ideas?.length ?? 0,
                eventCount: result.events?.length ?? 0,
                entityCount: result.entities?.length ?? 0,
                themeCount: result.themes?.length ?? 0,
                relationCount: result.relations?.length ?? 0,
                completedAt: completedRun?.completedAt,
            });
            if (completedRun) {
                this.autoSubmitQuizWorkflowAfterKnowledgeExtraction(completedRun);
            }
        }
        catch (error) {
            this.knowledgeExtractionWorkflowRepository.failRun(workflowRunId, 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    autoSubmitQuizWorkflowAfterKnowledgeExtraction(completedRun) {
        if (!runtime_config_1.config.autoSubmitQuizWorkflow) {
            (0, workflow_logger_1.workflowLog)('quiz.auto_submit_skipped', {
                workflowKind: completedRun.kind,
                workflowRunId: completedRun.id,
                bookId: completedRun.bookId,
                chapterId: completedRun.chapterId,
                chapterIndex: completedRun.chapterIndex,
                workflowVersion: completedRun.workflowVersion,
                reason: 'disabled',
            });
            return;
        }
        const quizWorkflowService = this.resolveQuizWorkflowService();
        if (!quizWorkflowService) {
            (0, workflow_logger_1.workflowLog)('quiz.auto_submit_skipped', {
                workflowKind: completedRun.kind,
                workflowRunId: completedRun.id,
                bookId: completedRun.bookId,
                chapterId: completedRun.chapterId,
                chapterIndex: completedRun.chapterIndex,
                workflowVersion: completedRun.workflowVersion,
                reason: 'quiz_service_unavailable',
            });
            return;
        }
        try {
            const response = quizWorkflowService.submitQuizWorkflow({
                bookId: completedRun.bookId,
                chapterId: completedRun.chapterId,
                chapterIndex: completedRun.chapterIndex,
                workflowVersion: 'v1',
                expectedSnapshotVersion: completedRun.snapshotVersion,
                expectedChapterContentHash: completedRun.chapterContentHash,
            });
            (0, workflow_logger_1.workflowLog)('quiz.auto_submitted', {
                workflowKind: completedRun.kind,
                workflowRunId: completedRun.id,
                bookId: completedRun.bookId,
                chapterId: completedRun.chapterId,
                chapterIndex: completedRun.chapterIndex,
                workflowVersion: completedRun.workflowVersion,
                snapshotVersion: completedRun.snapshotVersion,
                chapterContentHash: completedRun.chapterContentHash,
                quizWorkflowRunId: response.workflowRunId,
                deduped: response.deduped,
            });
        }
        catch (error) {
            (0, workflow_logger_1.workflowLog)('quiz.auto_submit_failed', {
                workflowKind: completedRun.kind,
                workflowRunId: completedRun.id,
                bookId: completedRun.bookId,
                chapterId: completedRun.chapterId,
                chapterIndex: completedRun.chapterIndex,
                workflowVersion: completedRun.workflowVersion,
                snapshotVersion: completedRun.snapshotVersion,
                chapterContentHash: completedRun.chapterContentHash,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    resolveQuizWorkflowService() {
        try {
            return this.moduleRef?.get(quiz_workflow_service_1.QuizWorkflowService, { strict: false });
        }
        catch {
            return undefined;
        }
    }
    buildPieces(chapter) {
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
    async generateKnowledgeExtraction(input) {
        const bookContext = this.bookContextService.buildBookContextBundle(input.bookId, input.chapterId);
        const chapterContext = this.bookContextService.buildChapterContextBundle(input.bookId, input.chapterId);
        const incrementalRepository = new knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository();
        for (const piece of input.pieces) {
            const memorySnapshot = await incrementalRepository.buildChapterSnapshot(input.bookId, input.chapterId);
            const memoryContext = this.buildMemoryContext(memorySnapshot);
            const pageWindow = this.bookContextService.buildPageWindowContext(input.bookId, input.chapterId, piece.pageIndex) ?? this.createFallbackPageWindow(piece);
            const pieceResult = await this.generateKnowledgeExtractionForPiece({
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                chapterTitle: input.chapterTitle,
                chapterText: input.chapterText,
                chapterContentHash: input.chapterContentHash,
                piece,
                bookContext,
                chapterContext,
                pageWindow,
                memoryContext,
            });
            this.knowledgeExtractionWorkflowRepository.setCachedPageExtraction({
                bookId: input.bookId,
                chapterId: input.chapterId,
                pageIndex: piece.pageIndex,
                sourceHash: piece.sourceHash,
                chapterContentHash: input.chapterContentHash,
                promptVersion: PROMPT_VERSION,
                extraction: pieceResult,
            });
            const chapterCounts = await incrementalRepository.upsertPageExtraction({
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                chapterTitle: input.chapterTitle,
                extraction: pieceResult,
            });
            (0, workflow_logger_1.workflowLog)('piece.processed', {
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
                accumulatedPeopleCount: chapterCounts.peopleCount,
                accumulatedIdeaCount: chapterCounts.ideaCount,
                accumulatedEventCount: chapterCounts.eventCount,
                accumulatedEntityCount: chapterCounts.entityCount,
                accumulatedThemeCount: chapterCounts.themeCount,
                accumulatedRelationCount: chapterCounts.relationCount,
            });
        }
        const knowledge = await incrementalRepository.buildChapterSnapshot(input.bookId, input.chapterId);
        knowledge.title = input.chapterTitle ?? knowledge.title;
        knowledge.summary = this.summarize(input.chapterText, 240);
        await this.knowledgeExtractionWorkflowRepository.replaceChapterExtraction({
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            extraction: knowledge,
        });
        return knowledge;
    }
    async generateKnowledgeExtractionForPiece(input) {
        const cached = this.knowledgeExtractionWorkflowRepository.getCachedPageExtraction(input.bookId, input.chapterId, input.piece.pageIndex, input.piece.sourceHash, input.chapterContentHash, PROMPT_VERSION);
        if (cached) {
            (0, workflow_logger_1.workflowLog)('piece.cache_hit', {
                workflowKind: 'knowledge_extraction',
                bookId: input.bookId,
                chapterId: input.chapterId,
                pageIndex: input.piece.pageIndex,
                sourceHash: input.piece.sourceHash,
                promptVersion: PROMPT_VERSION,
            });
            return cached;
        }
        const [systemPrompt, userPrompt] = await Promise.all([
            this.loadPrompt(),
            Promise.resolve(this.buildPieceSuffixPrompt(input)),
        ]);
        const book = this.bookIngestionRepository.getBook(input.bookId);
        const metadataRecord = isPlainObject(book?.bookMetadata) ? book.bookMetadata : {};
        const llmClient = (0, llmService_1.createLLMClient)({
            systemPrompt,
            prefixCache: (0, chapter_prefix_cache_1.buildSharedChapterPrefixCache)({
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                chapterTitle: input.chapterTitle,
                chapterContentHash: input.chapterContentHash,
                chapterText: input.chapterText,
                bookMetadata: {
                    title: asString(metadataRecord.title),
                    author: asString(metadataRecord.author),
                    language: asString(metadataRecord.language),
                },
            }),
        });
        const response = await llmClient.json(userPrompt);
        let text = '';
        for await (const chunk of response.data) {
            text += chunk;
        }
        try {
            const parsed = (0, llmService_1.extractJsonFromText)(text);
            return this.sanitizeKnowledgeExtraction(parsed, {
                chapterId: input.chapterId,
                chapterTitle: input.chapterTitle,
                chapterText: input.piece.rawText,
                pageRef: this.createPageRef(input.piece.pageIndex, input.piece.pageNumber),
            });
        }
        catch {
            return this.createEmptyKnowledgeExtraction(input.chapterId, input.chapterTitle);
        }
    }
    buildPieceSuffixPrompt(input) {
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
            'Book context:',
            '```json',
            JSON.stringify(input.bookContext ?? this.createFallbackBookContext(input), null, 2),
            '```',
            '',
            'Current chapter context:',
            '```json',
            JSON.stringify(input.chapterContext ?? this.createFallbackChapterContext(input), null, 2),
            '```',
            '',
            'Page window:',
            '```json',
            JSON.stringify(input.pageWindow, null, 2),
            '```',
            '',
            'Memory continuity:',
            '```json',
            JSON.stringify(input.memoryContext, null, 2),
            '```',
            '',
            'Primary evidence page:',
            '```text',
            input.piece.rawText,
            '```',
            '',
            'Use the primary evidence page as the only source of evidence quotes.',
            'Use the cached chapter prefix, book context, chapter context, page window, and memory continuity only for reference resolution and continuity.',
            'Do not cite or import evidence from previous pages, next pages, summaries, or memory continuity.',
            'Reuse an existing local_id from memory continuity only when the current page clearly refers to the same item.',
            'local_id values only need to be unique within this chapter workflow response state.',
            `Every returned knowledge item must include evidence anchored to pageIndex=${input.piece.pageIndex} and pageNumber=${input.piece.pageNumber}.`,
            'Respond with JSON only. Do not wrap the JSON in markdown fences.',
        ];
        return sections.join('\n');
    }
    async loadPrompt() {
        if (cachedSystemPrompt)
            return cachedSystemPrompt;
        cachedSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
        return cachedSystemPrompt;
    }
    createEmptyKnowledgeExtraction(chapterId, chapterTitle) {
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
    sanitizeKnowledgeExtraction(raw, input) {
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
    sanitizeStringArray(value) {
        if (!Array.isArray(value))
            return undefined;
        const items = value.map(asString).filter((item) => Boolean(item));
        return items.length ? items : undefined;
    }
    sortStrings(values) {
        if (!values || values.length === 0)
            return undefined;
        return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
    }
    sanitizeEvidence(value, currentPageRef) {
        if (!Array.isArray(value))
            return undefined;
        const evidence = value
            .map((item) => {
            if (!isPlainObject(item))
                return null;
            const quote = asString(item.quote);
            if (!quote)
                return null;
            return {
                quote,
                pageIndex: currentPageRef.pageIndex,
                pageNumber: currentPageRef.pageNumber,
            };
        })
            .filter((item) => item !== null);
        return evidence.length ? evidence : undefined;
    }
    buildMemoryContext(snapshot) {
        const relationHintsByNode = new Map();
        for (const relation of snapshot.relations) {
            const hint = `${relation.relation_type}:${relation.to_type}:${relation.to_id}`;
            const reverseHint = `${relation.relation_type}:${relation.from_type}:${relation.from_id}`;
            const fromHints = relationHintsByNode.get(relation.from_id) ?? [];
            fromHints.push(hint);
            relationHintsByNode.set(relation.from_id, fromHints);
            const toHints = relationHintsByNode.get(relation.to_id) ?? [];
            toHints.push(reverseHint);
            relationHintsByNode.set(relation.to_id, toHints);
        }
        return {
            people: snapshot.people.map((person) => ({
                local_id: person.local_id,
                canonical_label: person.name,
                aliases: person.aliases,
                relation_hints: this.sortStrings(relationHintsByNode.get(person.local_id)),
                seen_pages: this.collectSeenPages(person.evidence),
            })),
            ideas: snapshot.ideas.map((idea) => ({
                local_id: idea.local_id,
                canonical_label: idea.label,
                relation_hints: this.sortStrings(relationHintsByNode.get(idea.local_id)),
                seen_pages: this.collectSeenPages(idea.evidence),
            })),
            events: snapshot.events.map((event) => ({
                local_id: event.local_id,
                canonical_label: event.label,
                relation_hints: this.sortStrings(relationHintsByNode.get(event.local_id)),
                seen_pages: this.collectSeenPages(event.evidence),
            })),
            entities: snapshot.entities.map((entity) => ({
                local_id: entity.local_id,
                canonical_label: entity.label,
                relation_hints: this.sortStrings(relationHintsByNode.get(entity.local_id)),
                seen_pages: this.collectSeenPages(entity.evidence),
            })),
            themes: snapshot.themes.map((theme) => ({
                local_id: theme.local_id,
                canonical_label: theme.label,
                relation_hints: this.sortStrings(relationHintsByNode.get(theme.local_id)),
                seen_pages: this.collectSeenPages(theme.evidence),
            })),
        };
    }
    collectSeenPages(evidence) {
        if (!evidence || evidence.length === 0)
            return [];
        return Array.from(new Set(evidence
            .map((item) => item.pageIndex)
            .filter((item) => typeof item === 'number'))).sort((left, right) => left - right);
    }
    createFallbackBookContext(input) {
        return {
            bookId: input.bookId,
            snapshotVersion: 0,
            chapters: [{
                    chapterId: input.chapterId,
                    chapterIndex: input.chapterIndex,
                    title: input.chapterTitle,
                }],
            priorChapterSummaries: [],
            currentChapterPages: [{
                    pageIndex: input.piece.pageIndex,
                    pageNumber: input.piece.pageNumber,
                    sourceHash: input.piece.sourceHash,
                }],
        };
    }
    createFallbackChapterContext(input) {
        return {
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            pages: [{
                    pageIndex: input.piece.pageIndex,
                    pageNumber: input.piece.pageNumber,
                    sourceHash: input.piece.sourceHash,
                }],
        };
    }
    createFallbackPageWindow(piece) {
        return {
            radius: 1,
            current: {
                pageIndex: piece.pageIndex,
                pageNumber: piece.pageNumber,
                sourceHash: piece.sourceHash,
                text: piece.rawText,
            },
        };
    }
    sanitizePeople(value, currentPageRef) {
        if (!Array.isArray(value))
            return undefined;
        const people = value
            .map((item, index) => {
            if (!isPlainObject(item))
                return null;
            const name = asString(item.name);
            if (!name)
                return null;
            return {
                local_id: asString(item.local_id) ?? `p${index + 1}`,
                name,
                aliases: this.sanitizeStringArray(item.aliases),
                description: asString(item.description),
                roles: this.sanitizeStringArray(item.roles),
                traits: this.sanitizeStringArray(item.traits),
                evidence: this.sanitizeEvidence(item.evidence, currentPageRef),
            };
        })
            .filter((item) => item !== null);
        return people.length ? people : undefined;
    }
    sanitizeIdeas(value, currentPageRef) {
        if (!Array.isArray(value))
            return undefined;
        const ideas = value
            .map((item, index) => {
            if (!isPlainObject(item))
                return null;
            const label = asString(item.label);
            if (!label)
                return null;
            const kind = asString(item.kind);
            const normalizedKind = kind && IDEA_KINDS.has(kind) ? kind : 'claim';
            const idea = {
                local_id: asString(item.local_id) ?? `i${index + 1}`,
                label,
                description: asString(item.description),
                kind: normalizedKind,
                evidence: this.sanitizeEvidence(item.evidence, currentPageRef),
            };
            if (!this.shouldKeepIdea(idea))
                return null;
            return idea;
        })
            .filter((item) => item !== null);
        return ideas.length ? ideas : undefined;
    }
    shouldKeepIdea(idea) {
        const label = idea.label.trim();
        const normalized = label.toLowerCase();
        const words = normalized.split(/\s+/).filter(Boolean);
        if (words.length === 0)
            return false;
        if (label.length > 72 || words.length > 10)
            return false;
        if (/[.?!:]$/.test(label))
            return false;
        if (idea.kind === 'claim' || idea.kind === 'belief') {
            if (words.length > 6)
                return false;
            if (normalized.includes('\'s'))
                return false;
            if (/\d/.test(normalized))
                return false;
            if (CONTEXT_HEAVY_IDEA_TOKENS.some((token) => normalized.includes(token))) {
                return false;
            }
        }
        return true;
    }
    sanitizeEvents(value, currentPageRef) {
        if (!Array.isArray(value))
            return undefined;
        const events = value
            .map((item, index) => {
            if (!isPlainObject(item))
                return null;
            const label = asString(item.label);
            if (!label)
                return null;
            return {
                local_id: asString(item.local_id) ?? `e${index + 1}`,
                label,
                description: asString(item.description),
                participant_local_ids: this.sanitizeStringArray(item.participant_local_ids),
                time_hint: asString(item.time_hint),
                place_hint: asString(item.place_hint),
                evidence: this.sanitizeEvidence(item.evidence, currentPageRef),
            };
        })
            .filter((item) => item !== null);
        return events.length ? events : undefined;
    }
    sanitizeEntities(value, currentPageRef) {
        if (!Array.isArray(value))
            return undefined;
        const entities = value
            .map((item, index) => {
            if (!isPlainObject(item))
                return null;
            const label = asString(item.label);
            const type = asString(item.type);
            if (!label || !type || !ENTITY_TYPES.has(type))
                return null;
            return {
                local_id: asString(item.local_id) ?? `n${index + 1}`,
                label,
                type: type,
                description: asString(item.description),
                evidence: this.sanitizeEvidence(item.evidence, currentPageRef),
            };
        })
            .filter((item) => item !== null);
        return entities.length ? entities : undefined;
    }
    sanitizeThemes(value, currentPageRef) {
        if (!Array.isArray(value))
            return undefined;
        const themes = value
            .map((item, index) => {
            if (!isPlainObject(item))
                return null;
            const label = asString(item.label);
            if (!label)
                return null;
            const strength = asNumber(item.strength);
            return {
                local_id: asString(item.local_id) ?? `t${index + 1}`,
                label,
                strength: typeof strength === 'number' ? Math.max(0, Math.min(1, strength)) : undefined,
                description: asString(item.description),
                evidence: this.sanitizeEvidence(item.evidence, currentPageRef),
            };
        })
            .filter((item) => item !== null);
        return themes.length ? themes : undefined;
    }
    sanitizeRelations(value, currentPageRef) {
        if (!Array.isArray(value))
            return undefined;
        const relations = value
            .map((item, index) => {
            if (!isPlainObject(item))
                return null;
            const fromId = asString(item.from_id);
            const fromType = asString(item.from_type);
            const toId = asString(item.to_id);
            const toType = asString(item.to_type);
            if (!fromId
                || !fromType
                || !toId
                || !toType
                || !NODE_TYPES.has(fromType)
                || !NODE_TYPES.has(toType)) {
                return null;
            }
            const relationType = asString(item.relation_type);
            const confidence = asNumber(item.confidence);
            return {
                local_id: asString(item.local_id) ?? `r${index + 1}`,
                from_id: fromId,
                from_type: fromType,
                to_id: toId,
                to_type: toType,
                relation_type: relationType && RELATION_TYPES.has(relationType)
                    ? relationType
                    : 'related_to',
                description: asString(item.description),
                confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : undefined,
                evidence: this.sanitizeEvidence(item.evidence, currentPageRef),
            };
        })
            .filter((item) => item !== null);
        return relations.length ? relations : undefined;
    }
    createPageRef(pageIndex, pageNumber) {
        return { pageIndex, pageNumber };
    }
    summarize(text, maxLength) {
        const trimmed = text.trim().replace(/\s+/g, ' ');
        if (trimmed.length <= maxLength)
            return trimmed;
        return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
    }
    buildDefaultIdempotencyKey(bookId, chapterId, workflowVersion, chapterContentHash) {
        return `knowledge-extraction:${workflowVersion}:${bookId}:${chapterId}:${chapterContentHash}`;
    }
    findReusableCompletedRun(bookId, chapterId, expectedSnapshotVersion, expectedChapterContentHash) {
        const latestResult = this.knowledgeExtractionWorkflowRepository.getLatestResult(bookId, chapterId);
        if (!latestResult)
            return null;
        if (expectedSnapshotVersion !== undefined && latestResult.snapshotVersion !== expectedSnapshotVersion) {
            return null;
        }
        if (expectedChapterContentHash !== undefined
            && latestResult.chapterContentHash !== expectedChapterContentHash) {
            return null;
        }
        const run = this.knowledgeExtractionWorkflowRepository.getRun(latestResult.workflowRunId);
        if (!run || run.status !== 'completed' || !run.output) {
            return null;
        }
        return run;
    }
    toSubmitResponse(run, deduped) {
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
    toStatusResponse(run) {
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
    requireRun(workflowRunId) {
        const run = this.knowledgeExtractionWorkflowRepository.getRun(workflowRunId);
        if (!run) {
            (0, workflow_logger_1.workflowLog)('status.read_miss', {
                workflowKind: 'knowledge_extraction',
                workflowRunId,
            });
            throw new common_1.NotFoundException('Knowledge extraction workflow run not found');
        }
        return run;
    }
    requireString(value, fieldName) {
        if (!isNonEmptyString(value)) {
            throw new common_1.BadRequestException(`${fieldName} must be a non-empty string`);
        }
        return value.trim();
    }
    requireNonNegativeInteger(value, fieldName) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            throw new common_1.BadRequestException(`${fieldName} must be a non-negative integer`);
        }
        return value;
    }
};
exports.KnowledgeExtractionWorkflowService = KnowledgeExtractionWorkflowService;
exports.KnowledgeExtractionWorkflowService = KnowledgeExtractionWorkflowService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)((0, common_1.forwardRef)(() => book_ingestion_repository_1.BookIngestionRepository))),
    __param(1, (0, common_1.Inject)(book_context_service_1.BookContextService)),
    __param(2, (0, common_1.Inject)(knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository)),
    __param(3, (0, common_1.Inject)(workflow_queue_service_1.WorkflowQueueService)),
    __param(4, (0, common_1.Optional)()),
    __param(4, (0, common_1.Inject)(core_1.ModuleRef)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        book_context_service_1.BookContextService,
        knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository,
        workflow_queue_service_1.WorkflowQueueService,
        core_1.ModuleRef])
], KnowledgeExtractionWorkflowService);
//# sourceMappingURL=knowledge-extraction-workflow.service.js.map