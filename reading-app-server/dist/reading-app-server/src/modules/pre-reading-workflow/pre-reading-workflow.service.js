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
exports.PreReadingWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const promises_1 = __importDefault(require("node:fs/promises"));
const book_context_service_1 = require("../book-ingestion/book-context.service");
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const runtime_config_1 = require("../../config/runtime-config");
const chapter_prefix_cache_1 = require("../../utils/chapter-prefix-cache");
const llm_retry_1 = require("../../utils/llm-retry");
const prompt_path_1 = require("../../utils/prompt-path");
const llmService_1 = require("../../../services/llmService");
const workflow_queue_service_1 = require("../workflow-queue/workflow-queue.service");
const pre_reading_workflow_repository_1 = require("./pre-reading-workflow.repository");
const PROMPT_VERSION = 'pre-reading.v1';
const PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('quiz.txt');
const MAX_WORKFLOW_LLM_RETRIES = 2;
const DEFAULT_WORKFLOW_LLM_RETRY_DELAY_MS = 5_000;
const MAX_WORKFLOW_LLM_RETRY_DELAY_MS = 30_000;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
let cachedSystemPrompt = null;
let PreReadingWorkflowService = class PreReadingWorkflowService {
    bookIngestionRepository;
    bookContextService;
    repository;
    workflowQueueService;
    constructor(bookIngestionRepository, bookContextService, repository, workflowQueueService) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.bookContextService = bookContextService;
        this.repository = repository;
        this.workflowQueueService = workflowQueueService;
    }
    parseSubmitRequest(rawBody) {
        if (!rawBody?.trim())
            throw new common_1.BadRequestException('Request body cannot be empty');
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch (error) {
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed))
            throw new common_1.BadRequestException('Request body must be a JSON object');
        return {
            bookId: this.requireString(parsed.bookId, 'bookId'),
            chapterId: this.requireString(parsed.chapterId, 'chapterId'),
            chapterIndex: this.requireNonNegativeInteger(parsed.chapterIndex, 'chapterIndex'),
            workflowVersion: parsed.workflowVersion === undefined
                ? 'v1'
                : this.requireString(parsed.workflowVersion, 'workflowVersion'),
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
    }
    submitPreReadingWorkflow(request, options = {}) {
        const book = this.bookIngestionRepository.getBook(request.bookId);
        const chapter = this.bookIngestionRepository.getChapter(request.bookId, request.chapterId);
        if (!book || !chapter)
            throw new common_1.NotFoundException('Chapter not found in canonical ingestion state');
        if (chapter.chapterIndex !== request.chapterIndex) {
            throw new common_1.ConflictException('chapterIndex does not match canonical chapter state');
        }
        if (request.expectedSnapshotVersion !== undefined
            && request.expectedSnapshotVersion !== book.snapshotVersion
            && request.expectedChapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.ConflictException('expectedSnapshotVersion does not match canonical book state');
        }
        if (request.expectedChapterContentHash !== undefined
            && request.expectedChapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.ConflictException('expectedChapterContentHash does not match canonical chapter state');
        }
        if (!chapter.chapterTextMaterialized.trim()) {
            throw new common_1.ConflictException('Canonical chapter text is empty; ingest pages before submitting pre-reading workflow');
        }
        const input = {
            ...request,
            idempotencyKey: request.idempotencyKey ?? [
                'pre-reading',
                request.workflowVersion,
                request.bookId,
                request.chapterId,
                chapter.chapterContentHash,
            ].join(':'),
            expectedSnapshotVersion: book.snapshotVersion,
            expectedChapterContentHash: chapter.chapterContentHash,
        };
        const { run, deduped } = this.repository.createOrReuseRun(input);
        if (!deduped && options.enqueue !== false) {
            this.workflowQueueService.enqueue(() => this.executeRun(run.id));
        }
        return this.toSubmitResponse(run, deduped);
    }
    async executeRun(workflowRunId) {
        const run = this.repository.markRunning(workflowRunId);
        if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'stale')
            return;
        const book = this.bookIngestionRepository.getBook(run.bookId);
        const chapter = this.bookIngestionRepository.getChapter(run.bookId, run.chapterId);
        if (!book || !chapter) {
            this.repository.failRun(workflowRunId, 'PRE_READING_CHAPTER_NOT_FOUND', 'Canonical chapter state was not found.');
            return;
        }
        if (run.expectedChapterContentHash !== undefined
            && run.expectedChapterContentHash !== chapter.chapterContentHash) {
            this.repository.markStale(workflowRunId, 'PRE_READING_CHAPTER_STALE', 'Canonical chapter content changed.');
            return;
        }
        try {
            const result = await (0, llm_retry_1.retryLLMOperation)({
                operation: () => this.generate({
                    bookId: run.bookId,
                    chapterId: run.chapterId,
                    chapterIndex: run.chapterIndex,
                    chapterTitle: chapter.chapterTitle,
                    chapterText: chapter.chapterTextMaterialized,
                    chapterContentHash: chapter.chapterContentHash,
                }),
                maxRetries: MAX_WORKFLOW_LLM_RETRIES,
                defaultDelayMs: DEFAULT_WORKFLOW_LLM_RETRY_DELAY_MS,
                maxDelayMs: MAX_WORKFLOW_LLM_RETRY_DELAY_MS,
                sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            });
            this.repository.completeRun({
                workflowRunId,
                snapshotVersion: book.snapshotVersion,
                chapterContentHash: chapter.chapterContentHash,
                result,
            });
        }
        catch (error) {
            this.repository.failRun(workflowRunId, 'PRE_READING_GENERATION_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    getWorkflowStatus(workflowRunId) {
        return this.toStatusResponse(this.requireRun(workflowRunId));
    }
    getWorkflowResult(workflowRunId) {
        const run = this.requireRun(workflowRunId);
        if (run.status !== 'completed'
            || !run.output
            || run.snapshotVersion === undefined
            || !run.chapterContentHash) {
            throw new common_1.ConflictException('Pre-reading workflow result is not available yet');
        }
        return {
            workflowRunId: run.id,
            kind: run.kind,
            bookId: run.bookId,
            chapterId: run.chapterId,
            chapterIndex: run.chapterIndex,
            workflowVersion: run.workflowVersion,
            resultVersion: run.resultVersion,
            snapshotVersion: run.snapshotVersion,
            chapterContentHash: run.chapterContentHash,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            result: run.output,
        };
    }
    getLatestChapterPreReading(bookId, chapterId) {
        const stored = this.repository.getLatestResult(bookId, chapterId);
        const chapter = this.bookIngestionRepository.getChapter(bookId, chapterId);
        if (!stored || !chapter || stored.chapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.NotFoundException('No current pre-reading workflow result found for chapter');
        }
        return {
            workflowRunId: stored.workflowRunId,
            bookId: stored.bookId,
            chapterId: stored.chapterId,
            chapterIndex: stored.chapterIndex,
            workflowVersion: stored.workflowVersion,
            resultVersion: stored.resultVersion,
            snapshotVersion: stored.snapshotVersion,
            chapterContentHash: stored.chapterContentHash,
            updatedAt: stored.updatedAt,
            result: stored.result,
        };
    }
    async generate(input) {
        const book = this.bookIngestionRepository.getBook(input.bookId);
        const metadata = isPlainObject(book?.bookMetadata) ? book.bookMetadata : {};
        const llmClient = (0, llmService_1.createLLMClient)({
            systemPrompt: await this.loadPrompt(),
            model: runtime_config_1.config.quizWorkflowModel,
            prefixCache: (0, chapter_prefix_cache_1.buildSharedChapterPrefixCache)({
                ...input,
                bookMetadata: {
                    title: asString(metadata.title),
                    author: asString(metadata.author),
                    language: asString(metadata.language),
                },
            }),
        });
        const response = await llmClient.json(this.buildPrompt(input));
        let text = '';
        for await (const chunk of response.data)
            text += chunk;
        return this.coerceResult((0, llmService_1.extractJsonFromText)(text));
    }
    buildPrompt(input) {
        const bookContext = this.bookContextService.buildBookContextBundle(input.bookId, input.chapterId);
        return [
            `Book ID: ${input.bookId}`,
            `Chapter ID: ${input.chapterId}`,
            `Chapter Index: ${input.chapterIndex}`,
            `Chapter Title: ${input.chapterTitle ?? ''}`,
            `Prompt Version: ${PROMPT_VERSION}`,
            '',
            'Book context:',
            '```json',
            JSON.stringify(bookContext ?? { bookId: input.bookId }, null, 2),
            '```',
            '',
            'Generate the chapter pre-reading guide before any insight extraction or quiz generation.',
            'Use only the canonical chapter text supplied in the cached chapter prefix.',
            'Return exactly one spoiler-light `teaser` and exactly 3 open-ended `pre_reading_questions`.',
            'Do not reveal outcomes, answers, late-chapter events, or extracted insight labels.',
            'Set `questions` to an empty array.',
            'Respond with JSON only.',
        ].join('\n');
    }
    coerceResult(value) {
        if (!isPlainObject(value))
            throw new Error('Pre-reading LLM response was not a JSON object');
        const teaser = asString(value.teaser);
        const questions = Array.isArray(value.pre_reading_questions)
            ? value.pre_reading_questions
                .map(asString)
                .filter((item) => typeof item === 'string')
            : [];
        const uniqueQuestions = Array.from(new Set(questions)).slice(0, 3);
        if (!teaser || uniqueQuestions.length !== 3) {
            throw new Error('Pre-reading LLM response must contain one teaser and exactly 3 questions');
        }
        return { teaser, pre_reading_questions: uniqueQuestions };
    }
    async loadPrompt() {
        if (!cachedSystemPrompt)
            cachedSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
        return cachedSystemPrompt;
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
        const run = this.repository.getRun(workflowRunId);
        if (!run)
            throw new common_1.NotFoundException('Pre-reading workflow run not found');
        return run;
    }
    requireString(value, field) {
        const result = asString(value);
        if (!result)
            throw new common_1.BadRequestException(`${field} must be a non-empty string`);
        return result;
    }
    requireNonNegativeInteger(value, field) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            throw new common_1.BadRequestException(`${field} must be a non-negative integer`);
        }
        return value;
    }
};
exports.PreReadingWorkflowService = PreReadingWorkflowService;
exports.PreReadingWorkflowService = PreReadingWorkflowService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(book_ingestion_repository_1.BookIngestionRepository)),
    __param(1, (0, common_1.Inject)(book_context_service_1.BookContextService)),
    __param(2, (0, common_1.Inject)(pre_reading_workflow_repository_1.PreReadingWorkflowRepository)),
    __param(3, (0, common_1.Inject)(workflow_queue_service_1.WorkflowQueueService)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        book_context_service_1.BookContextService,
        pre_reading_workflow_repository_1.PreReadingWorkflowRepository,
        workflow_queue_service_1.WorkflowQueueService])
], PreReadingWorkflowService);
//# sourceMappingURL=pre-reading-workflow.service.js.map