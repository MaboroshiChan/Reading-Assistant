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
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const llmService_1 = require("../../../services/llmService");
const runtime_config_1 = require("../../config/runtime-config");
const llm_retry_1 = require("../../utils/llm-retry");
const chapter_prefix_cache_1 = require("../../utils/chapter-prefix-cache");
const prompt_path_1 = require("../../utils/prompt-path");
const book_context_service_1 = require("../book-ingestion/book-context.service");
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const quiz_workflow_repository_1 = require("../quiz-workflow/quiz-workflow.repository");
const quiz_workflow_service_1 = require("../quiz-workflow/quiz-workflow.service");
const workflow_logger_1 = require("../workflow.logger");
const knowledge_extraction_workflow_repository_1 = require("./knowledge-extraction-workflow.repository");
const workflow_queue_service_1 = require("../workflow-queue/workflow-queue.service");
const PROMPT_VERSION = 'knowledge_extraction.v2.8';
const FICTION_PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('knowledge_extraction_fiction.txt');
const NON_FICTION_PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('knowledge_extraction_nonfiction.txt');
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
    'founded',
    'authored',
    'mentions',
    'argues',
    'illustrates',
    'reflects',
    'related_to',
]);
const IDEA_KINDS = new Set(['claim', 'belief', 'question', 'principle', 'conflict']);
const INITIAL_RUNNING_PROGRESS_PERCENT = 5;
const FINALIZING_PROGRESS_PERCENT = 100;
const MAX_CONSECUTIVE_PAGES_PER_PIECE = 2;
const MAX_TRANSIENT_LLM_RETRIES = 2;
const DEFAULT_TRANSIENT_LLM_RETRY_DELAY_MS = 2_000;
const MAX_TRANSIENT_LLM_RETRY_DELAY_MS = 12_000;
const MAX_WORKFLOW_LLM_RETRIES = 2;
const DEFAULT_WORKFLOW_LLM_RETRY_DELAY_MS = 5_000;
const MAX_WORKFLOW_LLM_RETRY_DELAY_MS = 30_000;
const MAX_KNOWLEDGE_EXTRACTION_OUTPUT_TOKENS = 6_144;
const MAX_MEMORY_RELATION_HINTS = 6;
const MAX_MEMORY_SEEN_PAGES = 4;
const MEMORY_ITEM_LIMITS = {
    people: 12,
    ideas: 14,
    events: 10,
    entities: 10,
    themes: 6,
};
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asBoolean = (value) => {
    if (typeof value === 'boolean')
        return value;
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true')
        return true;
    if (normalized === 'false')
        return false;
    return undefined;
};
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const normalizeExcerptText = (value) => value
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, '\'')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const clampProgressPercent = (value) => Math.min(100, Math.max(0, Math.round(value)));
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
const IDEA_DEDUP_STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'by',
    'for',
    'from',
    'in',
    'into',
    'of',
    'on',
    'or',
    'the',
    'to',
    'vs',
    'versus',
    'with',
    'within',
]);
const ENTITY_TYPE_PRIORITY = {
    organization: 5,
    place: 4,
    time: 3,
    object: 2,
    other: 1,
};
const ABSTRACT_ENTITY_IDEA_LABEL_PATTERN = /\b(economics?|philosophy|finance|policy|policies|policing|theory|discipline|movement|tradition|school of thought|school)\b/i;
const ABSTRACT_ENTITY_IDEA_DESCRIPTION_PATTERN = /\b(discipline|field|school of thought|movement|tradition|policy|principle|theory|approach|framework)\b/i;
const PLACE_ENTITY_HINT_PATTERN = /\b(city|town|county|state|country|school|university|hospital|office|hall|court|park|street|avenue|road|bridge|station|house|home)\b/i;
const OBJECT_ENTITY_HINT_PATTERN = /\b(book|report|paper|article|essay|study|novel|memoir|journal|magazine|device|tool|machine|car|house|coin|gum)\b/i;
const CORRELATION_CAUSATION_IDEA_PATTERN = /\bcorrelation\b.*\bcausation\b|\bcausation\b.*\bcorrelation\b/i;
const AUTHORED_RELATION_PATTERN = /\b(author(?:ed|s|ing)?|wrote|written|co-?author(?:ed|s|ing)?|published)\b/i;
const FOUNDED_RELATION_PATTERN = /\b(found(?:ed|er|ing)?|pioneer(?:ed|ing)?|originat(?:ed|ing)?|created)\b/i;
const MENTIONS_RELATION_PATTERN = /\b(wrote about|writes about|written about|mentioned|mentions|discuss(?:es|ed|ing)?|describ(?:es|ed|ing)?|examines?|about)\b/i;
const ARGUES_RELATION_PATTERN = /\b(argue(?:s|d|ing)?|argued that|claim(?:s|ed|ing)?|contend(?:s|ed|ing)?|maintain(?:s|ed|ing)?|assert(?:s|ed|ing)?|note(?:s|d|ing)?|hold(?:s|ing)? that)\b/i;
const ILLUSTRATES_RELATION_PATTERN = /\b(illustrat(?:es|ed|ing)|example|exemplif(?:ies|ied|ying)|show(?:s|ed|ing)|demonstrat(?:es|ed|ing)|case(?: study)?|instance)\b/i;
const PLACEHOLDER_PERSON_LABEL_PATTERN = /^candidate(?:\s+[a-z0-9]+)?$/i;
const GENERIC_PERSON_LABELS = new Set([
    'candidate',
    'candidates',
    'political candidate',
    'observer',
    'unknown observer',
    'czar',
    'ruler',
    'real estate agent',
    'real-estate agent',
    'real estate agents',
    'real-estate agents',
    'auto mechanic',
    'auto mechanics',
    'obstetrician',
    'obstetricians',
    'politician',
    'politicians',
    'teacher',
    'teachers',
    'student',
    'students',
    'doctor',
    'doctors',
    'expert',
    'experts',
    'police officer',
    'police officers',
]);
const LOW_SIGNAL_RELATED_TO_PATTERN = /\b(type of|kind of|used as (?:a )?comparison|point of comparison|part of the data used for analysis|analyzed for|setting for the discussion|context in which|compared to|comparison to|key aspect of|contributing to|applied to|contextualiz(?:e|es|ed|ing)|subject being analyzed)\b/i;
const PERSON_TITLE_PREFIX_PATTERN = /^(president|senator|governor|representative|general|judge|justice|professor|prof\.?|doctor|dr\.?|mr\.?|mrs\.?|ms\.?|rev\.?|reverend|sir)\s+/i;
const GENERIC_PERSON_GROUP_PATTERN = /^(?:(?:american|california|chicago|dallas|new york|u s|us|united states)\s+)?(?:real[- ]estate agents?|auto mechanics?|obstetricians?|politicians?|teachers?|students?|doctors?|experts?|police officers?)$/i;
let cachedFictionSystemPrompt = null;
let cachedNonFictionSystemPrompt = null;
let KnowledgeExtractionWorkflowService = class KnowledgeExtractionWorkflowService {
    bookIngestionRepository;
    bookContextService;
    knowledgeExtractionWorkflowRepository;
    workflowQueueService;
    moduleRef;
    quizWorkflowRepository;
    constructor(bookIngestionRepository, bookContextService, knowledgeExtractionWorkflowRepository, workflowQueueService, quizWorkflowRepository, moduleRef) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.bookContextService = bookContextService;
        this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
        this.workflowQueueService = workflowQueueService;
        this.quizWorkflowRepository = quizWorkflowRepository;
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
    parseRestartRequest(rawBody) {
        if (!rawBody || rawBody.trim() === '') {
            return { mode: 'resume' };
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
        const mode = parsed.mode === undefined ? 'resume' : this.requireRestartMode(parsed.mode);
        return { mode };
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
    restartWorkflow(workflowRunId, request) {
        const run = this.requireRun(workflowRunId);
        const restartMode = request.mode ?? 'resume';
        if (run.status === 'queued' || run.status === 'running') {
            return {
                ...this.toStatusResponse(run),
                restartMode,
            };
        }
        if (run.status === 'completed') {
            throw new common_1.ConflictException('Knowledge extraction workflow is already completed and cannot be restarted');
        }
        if (run.status === 'stale') {
            throw new common_1.ConflictException('Knowledge extraction workflow is stale and cannot be restarted');
        }
        const book = this.bookIngestionRepository.getBook(run.bookId);
        const chapter = this.bookIngestionRepository.getChapter(run.bookId, run.chapterId);
        if (!book || !chapter) {
            throw new common_1.NotFoundException('Chapter not found in canonical ingestion state');
        }
        if (run.expectedSnapshotVersion !== undefined
            && run.expectedSnapshotVersion !== book.snapshotVersion) {
            throw new common_1.ConflictException('Canonical book snapshot changed; submit a new knowledge extraction workflow');
        }
        if (run.expectedChapterContentHash !== undefined
            && run.expectedChapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.ConflictException('Canonical chapter content changed; submit a new knowledge extraction workflow');
        }
        const restarted = this.knowledgeExtractionWorkflowRepository.restartFailedRun(workflowRunId, restartMode);
        if (!restarted) {
            throw new common_1.ConflictException('Knowledge extraction workflow cannot be restarted from its current state');
        }
        this.workflowQueueService.enqueue(() => this.executeRun(restarted.id));
        return {
            ...this.toStatusResponse(restarted),
            restartMode,
        };
    }
    async getWorkflowResult(workflowRunId) {
        const run = await this.requireRunForResult(workflowRunId);
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
            result: this.withLatestQuizPreReading(run.output, run.bookId, run.chapterId, run.snapshotVersion, run.chapterContentHash),
        };
    }
    async getLatestChapterKnowledgeExtraction(bookId, chapterId) {
        const result = await this.knowledgeExtractionWorkflowRepository.getLatestResultFromStore(bookId, chapterId);
        if (!result) {
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
            result: this.withLatestQuizPreReading(result.result, result.bookId, result.chapterId, result.snapshotVersion, result.chapterContentHash),
        };
    }
    withLatestQuizPreReading(result, bookId, chapterId, snapshotVersion, chapterContentHash) {
        const latestQuiz = this.quizWorkflowRepository?.getLatestResult(bookId, chapterId);
        if (!latestQuiz)
            return result;
        if (latestQuiz.snapshotVersion !== snapshotVersion
            || latestQuiz.chapterContentHash !== chapterContentHash) {
            return result;
        }
        const teaser = asString(latestQuiz.result.teaser);
        const preReadingQuestions = this.sanitizeStringArray(latestQuiz.result.pre_reading_questions);
        if (!teaser && !preReadingQuestions) {
            return result;
        }
        return {
            ...result,
            teaser: teaser ?? result.teaser,
            pre_reading_questions: preReadingQuestions ?? result.pre_reading_questions,
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
            const result = await (0, llm_retry_1.retryLLMOperation)({
                operation: () => this.generateKnowledgeExtraction({
                    workflowRunId,
                    run: runningRun,
                    bookId: runningRun.bookId,
                    chapterId: runningRun.chapterId,
                    chapterIndex: runningRun.chapterIndex,
                    chapterTitle: chapter.chapterTitle,
                    chapterText: chapter.chapterTextMaterialized,
                    chapterContentHash: chapter.chapterContentHash,
                    pieces,
                }),
                maxRetries: MAX_WORKFLOW_LLM_RETRIES,
                defaultDelayMs: DEFAULT_WORKFLOW_LLM_RETRY_DELAY_MS,
                maxDelayMs: MAX_WORKFLOW_LLM_RETRY_DELAY_MS,
                onRetry: async ({ attempt, delayMs, error, classification }) => {
                    this.publishWorkflowProgress(workflowRunId, {
                        percent: INITIAL_RUNNING_PROGRESS_PERCENT,
                        stage: 'await_llm_retry',
                        message: '模型服务繁忙，正在自动重试',
                    });
                    (0, workflow_logger_1.workflowLog)('run.retry_scheduled', {
                        workflowKind: runningRun.kind,
                        workflowRunId: runningRun.id,
                        bookId: runningRun.bookId,
                        chapterId: runningRun.chapterId,
                        chapterIndex: runningRun.chapterIndex,
                        workflowVersion: runningRun.workflowVersion,
                        retryAttempt: attempt,
                        retryDelayMs: delayMs,
                        llmProvider: classification.provider,
                        llmReason: classification.reason,
                        llmStatusCode: classification.statusCode,
                        error: error instanceof Error ? error.message : String(error),
                    });
                },
                sleep: (ms) => this.sleep(ms),
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
        const pages = Array.from(chapter.pages.entries())
            .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
            .map(([pageIndex, page]) => ({
            pageIndex,
            pageNumber: pageIndex + 1,
            rawText: page.pageTextMaterialized,
            sourceHash: page.sourceHash,
        }))
            .filter((piece) => piece.rawText.trim().length > 0);
        const pieces = [];
        for (const page of pages) {
            const previous = pieces[pieces.length - 1];
            const canExtendPrevious = previous
                && previous.pageRefs.length < MAX_CONSECUTIVE_PAGES_PER_PIECE
                && previous.pageRefs[previous.pageRefs.length - 1]?.pageIndex === page.pageIndex - 1;
            if (canExtendPrevious) {
                previous.pageRefs.push(this.createPageRef(page.pageIndex, page.pageNumber));
                previous.rawText = `${previous.rawText.trimEnd()}\n\n${page.rawText.trimStart()}`;
                previous.sourceHash = this.combinePieceSourceHashes(previous.sourceHash, page.sourceHash);
                continue;
            }
            pieces.push({
                ...page,
                pieceIndex: pieces.length,
                totalPieces: 0,
                pageRefs: [this.createPageRef(page.pageIndex, page.pageNumber)],
            });
        }
        return pieces.map((piece, index) => ({
            ...piece,
            pieceIndex: index,
            totalPieces: pieces.length,
        }));
    }
    async generateKnowledgeExtraction(input) {
        const bookContext = this.bookContextService.buildBookContextBundle(input.bookId, input.chapterId);
        const chapterContext = this.bookContextService.buildChapterContextBundle(input.bookId, input.chapterId);
        const promptCacheVersion = this.pageCachePromptVersion(input.bookId);
        const { incrementalRepository, startPieceIndex } = await this.restorePieceProgress({
            workflowRunId: input.workflowRunId,
            run: input.run,
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            chapterContentHash: input.chapterContentHash,
            pieces: input.pieces,
        });
        this.publishWorkflowProgress(input.workflowRunId, {
            percent: this.progressPercentForProcessedPieces(startPieceIndex, input.pieces.length),
            stage: 'extract_chunk_knowledge',
            message: '正在抽取关键人物与关系',
        });
        if (startPieceIndex === 0) {
            this.knowledgeExtractionWorkflowRepository.updateRunCheckpoint(input.workflowRunId, this.buildPieceCheckpoint(input.pieces, -1));
        }
        for (const piece of input.pieces.slice(startPieceIndex)) {
            const memorySnapshot = await incrementalRepository.buildChapterSnapshot(input.bookId, input.chapterId);
            const memoryContext = this.buildMemoryContext(memorySnapshot, piece.pageIndex);
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
            this.knowledgeExtractionWorkflowRepository.setCachedPageGraphExtraction({
                bookId: input.bookId,
                chapterId: input.chapterId,
                pageIndex: piece.pageIndex,
                sourceHash: piece.sourceHash,
                chapterContentHash: input.chapterContentHash,
                promptVersion: promptCacheVersion,
                extraction: pieceResult,
            });
            const chapterCounts = await incrementalRepository.upsertPageGraphExtraction({
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                chapterTitle: input.chapterTitle,
                extraction: pieceResult,
            });
            this.knowledgeExtractionWorkflowRepository.upsertPartialPieceResult(input.workflowRunId, this.buildPartialPieceResult(piece, pieceResult));
            this.knowledgeExtractionWorkflowRepository.updateRunCheckpoint(input.workflowRunId, this.buildPieceCheckpoint(input.pieces, piece.pieceIndex));
            (0, workflow_logger_1.workflowLog)('piece.processed', {
                workflowKind: 'knowledge_extraction',
                bookId: input.bookId,
                chapterId: input.chapterId,
                pageIndex: piece.pageIndex,
                pageNumber: piece.pageNumber,
                pieceIndex: piece.pieceIndex,
                totalPieces: piece.totalPieces,
                sourceHash: piece.sourceHash,
                extractedPeopleCount: this.countGraphNodes(pieceResult.nodes, 'person'),
                extractedIdeaCount: this.countGraphNodes(pieceResult.nodes, 'idea'),
                extractedEventCount: this.countGraphNodes(pieceResult.nodes, 'event'),
                extractedEntityCount: this.countGraphNodes(pieceResult.nodes, 'entity'),
                extractedThemeCount: this.countGraphNodes(pieceResult.nodes, 'theme'),
                extractedRelationCount: pieceResult.edges.length,
                accumulatedPeopleCount: chapterCounts.peopleCount,
                accumulatedIdeaCount: chapterCounts.ideaCount,
                accumulatedEventCount: chapterCounts.eventCount,
                accumulatedEntityCount: chapterCounts.entityCount,
                accumulatedThemeCount: chapterCounts.themeCount,
                accumulatedRelationCount: chapterCounts.relationCount,
            });
            this.publishWorkflowProgress(input.workflowRunId, {
                percent: this.progressPercentForProcessedPieces(piece.pieceIndex + 1, input.pieces.length),
                stage: 'extract_chunk_knowledge',
                message: '正在抽取关键人物与关系',
            });
        }
        this.publishWorkflowProgress(input.workflowRunId, {
            percent: FINALIZING_PROGRESS_PERCENT,
            stage: 'finalize_chapter_knowledge',
            message: '正在保存结果',
        });
        const knowledge = await incrementalRepository.buildChapterSnapshot(input.bookId, input.chapterId);
        const title = input.chapterTitle ?? knowledge.title;
        const summary = this.summarize(input.chapterText, 240);
        knowledge.title = title;
        knowledge.summary = summary;
        await this.knowledgeExtractionWorkflowRepository.replaceChapterExtraction({
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            extraction: knowledge,
        });
        const canonicalKnowledge = await this.knowledgeExtractionWorkflowRepository.buildChapterSnapshot(input.bookId, input.chapterId);
        canonicalKnowledge.title = title ?? canonicalKnowledge.title;
        canonicalKnowledge.summary = summary;
        return canonicalKnowledge;
    }
    async restorePieceProgress(input) {
        const incrementalRepository = new knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository();
        const checkpoint = input.run.checkpoint;
        if (!checkpoint || checkpoint.nextPieceIndex <= 0) {
            return {
                incrementalRepository,
                startPieceIndex: 0,
            };
        }
        const expectedPieceCount = Math.min(checkpoint.nextPieceIndex, input.pieces.length);
        const isCompatibleCheckpoint = checkpoint.totalPieces === input.pieces.length
            && checkpoint.nextPieceIndex <= input.pieces.length;
        const promptCacheVersion = this.pageCachePromptVersion(input.bookId);
        const cachedExtractions = [];
        const hasReplayablePageCache = isCompatibleCheckpoint && input.pieces
            .slice(0, expectedPieceCount)
            .every((piece) => {
            const cachedExtraction = this.knowledgeExtractionWorkflowRepository.getCachedPageGraphExtraction(input.bookId, input.chapterId, piece.pageIndex, piece.sourceHash, input.chapterContentHash, promptCacheVersion);
            if (!cachedExtraction) {
                return false;
            }
            cachedExtractions.push(cachedExtraction);
            return true;
        });
        if (hasReplayablePageCache) {
            for (const extraction of cachedExtractions) {
                await incrementalRepository.upsertPageGraphExtraction({
                    bookId: input.bookId,
                    chapterId: input.chapterId,
                    chapterIndex: input.chapterIndex,
                    chapterTitle: input.chapterTitle,
                    extraction,
                });
            }
            return {
                incrementalRepository,
                startPieceIndex: checkpoint.nextPieceIndex,
            };
        }
        const partialPieceResults = (input.run.partialPieceResults ?? [])
            .filter((item) => item.pieceIndex >= 0 && item.pieceIndex < expectedPieceCount)
            .sort((left, right) => left.pieceIndex - right.pieceIndex);
        const isSequential = partialPieceResults.length === expectedPieceCount
            && partialPieceResults.every((item, index) => item.pieceIndex === index);
        const matchesPiecePlan = partialPieceResults.every((item) => {
            const piece = input.pieces[item.pieceIndex];
            if (!piece)
                return false;
            return piece.pageIndex === item.pageIndex
                && piece.pageNumber === item.pageNumber
                && piece.sourceHash === item.sourceHash
                && piece.pageRefs.length === item.pageRefs.length
                && piece.pageRefs.every((pageRef, pageRefIndex) => pageRef.pageIndex === item.pageRefs[pageRefIndex]?.pageIndex
                    && pageRef.pageNumber === item.pageRefs[pageRefIndex]?.pageNumber);
        });
        if (!isCompatibleCheckpoint || !isSequential || !matchesPiecePlan) {
            const fallbackReason = !isCompatibleCheckpoint
                ? 'checkpoint_mismatch'
                : !isSequential
                    ? 'missing_partial_piece_results'
                    : 'piece_plan_mismatch';
            (0, workflow_logger_1.workflowLog)('run.resume_fallback_to_start', {
                workflowKind: input.run.kind,
                workflowRunId: input.workflowRunId,
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                workflowVersion: input.run.workflowVersion,
                reason: fallbackReason,
            });
            this.knowledgeExtractionWorkflowRepository.clearRunCheckpoint(input.workflowRunId);
            this.knowledgeExtractionWorkflowRepository.clearPartialPieceResults(input.workflowRunId);
            return {
                incrementalRepository,
                startPieceIndex: 0,
            };
        }
        for (const partialPieceResult of partialPieceResults) {
            await incrementalRepository.upsertPageGraphExtraction({
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                chapterTitle: input.chapterTitle,
                extraction: partialPieceResult.extraction,
            });
        }
        return {
            incrementalRepository,
            startPieceIndex: checkpoint.nextPieceIndex,
        };
    }
    buildPartialPieceResult(piece, extraction) {
        return {
            pieceIndex: piece.pieceIndex,
            pageIndex: piece.pageIndex,
            pageNumber: piece.pageNumber,
            sourceHash: piece.sourceHash,
            pageRefs: piece.pageRefs.map((pageRef) => ({ ...pageRef })),
            extraction,
        };
    }
    buildPieceCheckpoint(pieces, completedPieceIndex) {
        const nextPiece = pieces[completedPieceIndex + 1];
        return {
            totalPieces: pieces.length,
            lastCompletedPieceIndex: completedPieceIndex,
            nextPieceIndex: completedPieceIndex + 1,
            nextPrimaryPageIndex: nextPiece?.pageIndex,
            nextPrimaryPageNumber: nextPiece?.pageNumber,
            updatedAt: new Date().toISOString(),
        };
    }
    async generateKnowledgeExtractionForPiece(input) {
        const promptCacheVersion = this.pageCachePromptVersion(input.bookId);
        const cached = this.knowledgeExtractionWorkflowRepository.getCachedPageGraphExtraction(input.bookId, input.chapterId, input.piece.pageIndex, input.piece.sourceHash, input.chapterContentHash, promptCacheVersion);
        if (cached) {
            (0, workflow_logger_1.workflowLog)('piece.cache_hit', {
                workflowKind: 'knowledge_extraction',
                bookId: input.bookId,
                chapterId: input.chapterId,
                pageIndex: input.piece.pageIndex,
                sourceHash: input.piece.sourceHash,
                promptVersion: promptCacheVersion,
            });
            return cached;
        }
        return this.retryTransientPieceGeneration(input);
    }
    async retryTransientPieceGeneration(input) {
        return (0, llm_retry_1.retryLLMOperation)({
            operation: () => this.generateKnowledgeExtractionForPieceOnce(input),
            maxRetries: MAX_TRANSIENT_LLM_RETRIES,
            defaultDelayMs: DEFAULT_TRANSIENT_LLM_RETRY_DELAY_MS,
            maxDelayMs: MAX_TRANSIENT_LLM_RETRY_DELAY_MS,
            onRetry: ({ attempt, delayMs, error, classification }) => {
                (0, workflow_logger_1.workflowLog)('piece.retry_scheduled', {
                    workflowKind: 'knowledge_extraction',
                    bookId: input.bookId,
                    chapterId: input.chapterId,
                    pageIndex: input.piece.pageIndex,
                    pageNumber: input.piece.pageNumber,
                    pieceIndex: input.piece.pieceIndex,
                    totalPieces: input.piece.totalPieces,
                    retryAttempt: attempt,
                    retryDelayMs: delayMs,
                    llmProvider: classification.provider,
                    llmReason: classification.reason,
                    llmStatusCode: classification.statusCode,
                    error: error instanceof Error ? error.message : String(error),
                });
            },
            sleep: (ms) => this.sleep(ms),
        });
    }
    async generateKnowledgeExtractionForPieceOnce(input) {
        const book = this.bookIngestionRepository.getBook(input.bookId);
        const metadataRecord = isPlainObject(book?.bookMetadata) ? book.bookMetadata : {};
        const promptVariant = this.promptVariantForBook(input.bookId);
        const isFiction = promptVariant === 'fiction';
        const [systemPrompt, userPrompt] = await Promise.all([
            this.loadPrompt(isFiction),
            Promise.resolve(this.buildPieceSuffixPrompt(input)),
        ]);
        const llmClient = (0, llmService_1.createLLMClient)({
            systemPrompt,
            model: runtime_config_1.config.knowledgeExtractionWorkflowModel,
            maxOutputTokens: MAX_KNOWLEDGE_EXTRACTION_OUTPUT_TOKENS,
            timeoutMs: runtime_config_1.config.knowledgeExtractionWorkflowTimeoutMs,
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
            logContext: {
                workflowKind: 'knowledge_extraction',
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                pageIndex: input.piece.pageIndex,
                pageNumber: input.piece.pageNumber,
                pieceIndex: input.piece.pieceIndex,
                totalPieces: input.piece.totalPieces,
                sourceHash: input.piece.sourceHash,
            },
        });
        const response = await llmClient.json(userPrompt);
        let text = '';
        for await (const chunk of response.data) {
            text += chunk;
        }
        try {
            const parsed = (0, llmService_1.extractJsonFromText)(text);
            const pageTextByPageIndex = this.buildPageTextByPageIndex(input.bookId, input.chapterId, input.piece.pageRefs);
            return this.sanitizeKnowledgeExtractionGraph(parsed, {
                chapterId: input.chapterId,
                chapterTitle: input.chapterTitle,
                chapterText: input.chapterText,
                allowedPageRefs: input.piece.pageRefs,
                pageTextByPageIndex,
                promptVariant,
                memoryContext: input.memoryContext,
                primaryPageText: input.piece.rawText,
            });
        }
        catch {
            return this.createEmptyKnowledgeExtractionGraph(input.chapterId, input.chapterTitle);
        }
    }
    async sleep(ms) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }
    buildPieceSuffixPrompt(input) {
        const sections = [
            `Document ID: ${input.bookId}`,
            `Chapter ID: ${input.chapterId}`,
            `Chapter Title: ${input.chapterTitle ?? ''}`,
            `Chunk ID: page-${input.piece.pageIndex}-${input.piece.pageRefs[input.piece.pageRefs.length - 1]?.pageIndex ?? input.piece.pageIndex}`,
            `Chunk Index: ${input.piece.pieceIndex + 1}`,
            `Total Chunks: ${input.piece.totalPieces}`,
            `Primary Page Index: ${input.piece.pageIndex}`,
            `Primary Page Number: ${input.piece.pageNumber}`,
            `Source Hash: ${input.piece.sourceHash}`,
            `Prompt Version: ${PROMPT_VERSION}`,
            '',
            'Chunk pages:',
            '```json',
            JSON.stringify(input.piece.pageRefs, null, 2),
            '```',
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
            'Primary evidence pages:',
            '```text',
            input.piece.rawText,
            '```',
            '',
            'Use the primary evidence pages as the only source of evidence quotes.',
            'Use the cached chapter prefix, book context, chapter context, page window, and memory continuity only for reference resolution and continuity.',
            'Do not cite or import evidence from previous pages, next pages, summaries, or memory continuity.',
            'Reuse an existing local_id from memory continuity only when the current page clearly refers to the same item.',
            'local_id values only need to be unique within this chapter workflow response state.',
            `Every evidence item must include quote, pageIndex, and pageNumber, and pageIndex/pageNumber must match one of: ${input.piece.pageRefs.map((pageRef) => `${pageRef.pageIndex}/${pageRef.pageNumber}`).join(', ')}.`,
            'Respond with JSON only. Do not wrap the JSON in markdown fences.',
        ];
        return sections.join('\n');
    }
    async loadPrompt(isFiction) {
        if (isFiction) {
            if (cachedFictionSystemPrompt)
                return cachedFictionSystemPrompt;
            cachedFictionSystemPrompt = (await promises_1.default.readFile(FICTION_PROMPT_PATH, 'utf8')).trim();
            return cachedFictionSystemPrompt;
        }
        else {
            if (cachedNonFictionSystemPrompt)
                return cachedNonFictionSystemPrompt;
            cachedNonFictionSystemPrompt = (await promises_1.default.readFile(NON_FICTION_PROMPT_PATH, 'utf8')).trim();
            return cachedNonFictionSystemPrompt;
        }
    }
    pageCachePromptVersion(bookId) {
        return `${PROMPT_VERSION}:${this.promptVariantForBook(bookId)}`;
    }
    promptVariantForBook(bookId) {
        const book = this.bookIngestionRepository.getBook(bookId);
        const metadataRecord = isPlainObject(book?.bookMetadata) ? book.bookMetadata : {};
        return asBoolean(metadataRecord.isFiction) === true ? 'fiction' : 'nonfiction';
    }
    createEmptyKnowledgeExtractionGraph(chapterId, chapterTitle) {
        return {
            title: chapterTitle ?? `Chapter ${chapterId}`,
            summary: '',
            nodes: [],
            edges: [],
            evidence: [],
        };
    }
    sanitizeKnowledgeExtractionGraph(raw, input) {
        const record = isPlainObject(raw) ? raw : {};
        const workLikeIdeaIds = this.findWorkLikeIdeaNodeIds(record.nodes, record.edges);
        const rawNodes = this.sanitizeGraphNodes(record.nodes, input.promptVariant, input.memoryContext, input.primaryPageText, input.chapterText, workLikeIdeaIds) ?? [];
        const { nodes, nodeIdRedirects, } = input.promptVariant === 'fiction'
            ? {
                nodes: rawNodes,
                nodeIdRedirects: new Map(),
            }
            : this.deduplicateGraphNodes(rawNodes);
        const nodesById = new Map(nodes.map((node) => [node.id, node]));
        const edges = this.normalizeGraphEdges(this.sanitizeGraphEdges(record.edges, nodesById, nodeIdRedirects) ?? [], nodesById) ?? [];
        const edgeIds = new Set(edges.map((edge) => edge.id));
        const explicitEvidence = this.sanitizeGraphEvidence(record.evidence, input.allowedPageRefs, input.pageTextByPageIndex, nodesById, edgeIds, nodeIdRedirects) ?? [];
        const embeddedEvidence = this.sanitizeEmbeddedGraphEvidence(record, input.allowedPageRefs, input.pageTextByPageIndex, nodesById, edgeIds, nodeIdRedirects) ?? [];
        return {
            title: asString(record.title) ?? input.chapterTitle ?? `Chapter ${input.chapterId}`,
            summary: asString(record.summary) ?? '',
            nodes,
            edges,
            evidence: this.mergeGraphEvidence(explicitEvidence, embeddedEvidence),
        };
    }
    sanitizeKnowledgeExtraction(raw, input) {
        const record = isPlainObject(raw) ? raw : {};
        if (!Array.isArray(record.nodes) && !Array.isArray(record.edges) && !Array.isArray(record.evidence)) {
            return this.enforceEvidenceCoverage({
                title: asString(record.title) ?? input.chapterTitle ?? `Chapter ${input.chapterId}`,
                summary: asString(record.summary) ?? this.summarize(input.chapterText, 240),
                people: this.sanitizePeople(record.people, input.allowedPageRefs, input.pageTextByPageIndex) ?? [],
                ideas: this.sanitizeIdeas(record.ideas, input.allowedPageRefs, input.pageTextByPageIndex, input.promptVariant) ?? [],
                events: this.sanitizeEvents(record.events, input.allowedPageRefs, input.pageTextByPageIndex) ?? [],
                entities: this.sanitizeEntities(record.entities, input.allowedPageRefs, input.pageTextByPageIndex) ?? [],
                themes: this.sanitizeThemes(record.themes, input.allowedPageRefs, input.pageTextByPageIndex) ?? [],
                relations: this.sanitizeRelations(record.relations, input.allowedPageRefs, input.pageTextByPageIndex) ?? [],
            });
        }
        const graph = this.sanitizeKnowledgeExtractionGraph(raw, {
            chapterId: input.chapterId,
            chapterTitle: input.chapterTitle,
            chapterText: input.chapterText,
            allowedPageRefs: input.allowedPageRefs,
            pageTextByPageIndex: input.pageTextByPageIndex,
            promptVariant: input.promptVariant,
        });
        return this.enforceEvidenceCoverage(this.graphToKnowledgeExtractionData({
            ...graph,
            summary: graph.summary || this.summarize(input.chapterText, 240),
        }));
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
    sanitizeEvidence(value, allowedPageRefs, pageTextByPageIndex) {
        if (!Array.isArray(value))
            return undefined;
        const allowedPageMap = new Map(allowedPageRefs.map((pageRef) => [pageRef.pageIndex, pageRef.pageNumber]));
        const evidence = value
            .map((item) => {
            if (!isPlainObject(item))
                return null;
            const quote = asString(item.quote);
            if (!quote)
                return null;
            const inferredPageRef = this.inferEvidencePageRef(quote, allowedPageRefs, pageTextByPageIndex);
            const pageIndex = asNumber(item.pageIndex) ?? inferredPageRef?.pageIndex;
            const pageNumber = asNumber(item.pageNumber) ?? inferredPageRef?.pageNumber;
            if (pageIndex === undefined || pageNumber === undefined)
                return null;
            if (allowedPageMap.get(pageIndex) !== pageNumber)
                return null;
            return {
                quote,
                pageIndex,
                pageNumber,
            };
        })
            .filter((item) => item !== null);
        return evidence.length ? evidence : undefined;
    }
    sanitizeGraphNodes(value, promptVariant = 'nonfiction', memoryContext, primaryPageText, chapterText, workLikeIdeaIds = new Set()) {
        if (!Array.isArray(value))
            return undefined;
        const nodes = [];
        const seenIds = new Set();
        for (const [index, item] of value.entries()) {
            if (!isPlainObject(item))
                continue;
            const type = asString(item.type);
            const label = asString(item.label);
            if (!type || !label || !NODE_TYPES.has(type))
                continue;
            const id = asString(item.id) ?? `${type[0]}${index + 1}`;
            if (seenIds.has(id))
                continue;
            seenIds.add(id);
            switch (type) {
                case 'person': {
                    const rawImportance = asString(item.importance);
                    const importance = rawImportance === 'main' || rawImportance === 'supporting' || rawImportance === 'minor'
                        ? rawImportance
                        : undefined;
                    const person = this.normalizeGraphPersonIdentity({
                        id,
                        type,
                        label,
                        aliases: this.sanitizeStringArray(item.aliases),
                        importance,
                        description: asString(item.description),
                        roles: this.sanitizeStringArray(item.roles),
                        traits: this.sanitizeStringArray(item.traits),
                    }, memoryContext, primaryPageText, chapterText);
                    if (!this.shouldKeepGraphPersonNode(person))
                        continue;
                    nodes.push(person);
                    break;
                }
                case 'idea': {
                    const kind = asString(item.kind);
                    const normalizedKind = kind && IDEA_KINDS.has(kind) ? kind : 'claim';
                    const description = asString(item.description);
                    if (workLikeIdeaIds.has(id) && this.isWorkLikeIdeaLabel(label, description)) {
                        nodes.push({
                            id,
                            type: 'entity',
                            label,
                            entity_type: 'object',
                            description,
                        });
                        break;
                    }
                    const ideaNode = {
                        id,
                        type,
                        label,
                        kind: normalizedKind,
                        description,
                    };
                    const idea = {
                        local_id: id,
                        label,
                        kind: normalizedKind,
                        description: ideaNode.description,
                    };
                    if (!this.shouldKeepIdea(idea, promptVariant))
                        continue;
                    nodes.push(ideaNode);
                    break;
                }
                case 'event':
                    nodes.push({
                        id,
                        type,
                        label,
                        description: asString(item.description),
                        participant_ids: this.sanitizeStringArray(item.participant_ids),
                        time_hint: asString(item.time_hint),
                        place_hint: asString(item.place_hint),
                    });
                    break;
                case 'entity': {
                    const entityType = asString(item.entity_type);
                    if (!entityType || !ENTITY_TYPES.has(entityType))
                        continue;
                    const description = asString(item.description);
                    const normalizedEntityType = this.canonicalizeGraphEntityType(label, entityType, description);
                    if (this.shouldReclassifyEntityNodeAsIdea(label, normalizedEntityType, description)) {
                        nodes.push({
                            id,
                            type: 'idea',
                            label,
                            kind: 'principle',
                            description,
                        });
                        break;
                    }
                    nodes.push({
                        id,
                        type,
                        label,
                        entity_type: normalizedEntityType,
                        description,
                    });
                    break;
                }
                case 'theme': {
                    const strength = asNumber(item.strength);
                    nodes.push({
                        id,
                        type,
                        label,
                        strength: typeof strength === 'number' ? Math.max(0, Math.min(1, strength)) : undefined,
                        description: asString(item.description),
                    });
                    break;
                }
                default:
                    break;
            }
        }
        const nodeTypeById = new Map(nodes.map((node) => [node.id, node.type]));
        return nodes.map((node) => {
            if (node.type !== 'event')
                return node;
            return {
                ...node,
                participant_ids: (node.participant_ids ?? []).filter((participantId) => nodeTypeById.get(participantId) === 'person'),
            };
        });
    }
    sanitizeGraphEdges(value, nodesById, nodeIdRedirects = new Map()) {
        if (!Array.isArray(value))
            return undefined;
        const edges = [];
        const seenIds = new Set();
        for (const [index, item] of value.entries()) {
            if (!isPlainObject(item))
                continue;
            const from = this.rewriteGraphNodeId(asString(item.from), nodeIdRedirects);
            const to = this.rewriteGraphNodeId(asString(item.to), nodeIdRedirects);
            if (!from || !to || !nodesById.has(from) || !nodesById.has(to))
                continue;
            const rawRelationType = asString(item.relation_type);
            const relationType = rawRelationType && RELATION_TYPES.has(rawRelationType)
                ? rawRelationType
                : 'related_to';
            const id = asString(item.id) ?? `r${index + 1}`;
            if (seenIds.has(id))
                continue;
            seenIds.add(id);
            const confidence = asNumber(item.confidence);
            edges.push({
                id,
                from,
                to,
                relation_type: relationType,
                description: asString(item.description),
                confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : undefined,
            });
        }
        return edges.length ? edges : undefined;
    }
    sanitizeGraphEvidence(value, allowedPageRefs, pageTextByPageIndex, nodesById, edgeIds, nodeIdRedirects = new Map()) {
        if (!Array.isArray(value))
            return undefined;
        const allowedPageMap = new Map(allowedPageRefs.map((pageRef) => [pageRef.pageIndex, pageRef.pageNumber]));
        const evidence = [];
        const seenIds = new Set();
        for (const [index, item] of value.entries()) {
            if (!isPlainObject(item))
                continue;
            const ownerKind = asString(item.owner_kind);
            const ownerId = ownerKind === 'node'
                ? this.rewriteGraphNodeId(asString(item.owner_id), nodeIdRedirects)
                : asString(item.owner_id);
            const quote = asString(item.quote);
            if (!ownerKind || !ownerId || !quote)
                continue;
            if (ownerKind !== 'node' && ownerKind !== 'edge')
                continue;
            if (ownerKind === 'node' && !nodesById.has(ownerId))
                continue;
            if (ownerKind === 'edge' && !edgeIds.has(ownerId))
                continue;
            const inferredPageRef = this.inferEvidencePageRef(quote, allowedPageRefs, pageTextByPageIndex);
            const pageIndex = asNumber(item.pageIndex) ?? inferredPageRef?.pageIndex;
            const pageNumber = asNumber(item.pageNumber) ?? inferredPageRef?.pageNumber;
            if (pageIndex === undefined || pageNumber === undefined)
                continue;
            if (allowedPageMap.get(pageIndex) !== pageNumber)
                continue;
            const id = asString(item.id) ?? `ev${index + 1}`;
            if (seenIds.has(id))
                continue;
            seenIds.add(id);
            evidence.push({
                id,
                owner_kind: ownerKind,
                owner_id: ownerId,
                quote,
                pageIndex,
                pageNumber,
            });
        }
        return evidence.length ? evidence : undefined;
    }
    sanitizeEmbeddedGraphEvidence(record, allowedPageRefs, pageTextByPageIndex, nodesById, edgeIds, nodeIdRedirects = new Map()) {
        const evidence = [];
        if (Array.isArray(record.nodes)) {
            for (const [index, item] of record.nodes.entries()) {
                if (!isPlainObject(item))
                    continue;
                const ownerId = this.rewriteGraphNodeId(asString(item.id), nodeIdRedirects);
                if (!ownerId || !nodesById.has(ownerId))
                    continue;
                const sanitized = this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex);
                for (const [evidenceIndex, evidenceItem] of (sanitized ?? []).entries()) {
                    evidence.push({
                        id: `embedded-node-${index + 1}-${evidenceIndex + 1}`,
                        owner_kind: 'node',
                        owner_id: ownerId,
                        quote: evidenceItem.quote,
                        pageIndex: evidenceItem.pageIndex,
                        pageNumber: evidenceItem.pageNumber,
                    });
                }
            }
        }
        if (Array.isArray(record.edges)) {
            for (const [index, item] of record.edges.entries()) {
                if (!isPlainObject(item))
                    continue;
                const ownerId = asString(item.id) ?? `r${index + 1}`;
                if (!edgeIds.has(ownerId))
                    continue;
                const sanitized = this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex);
                for (const [evidenceIndex, evidenceItem] of (sanitized ?? []).entries()) {
                    evidence.push({
                        id: `embedded-edge-${index + 1}-${evidenceIndex + 1}`,
                        owner_kind: 'edge',
                        owner_id: ownerId,
                        quote: evidenceItem.quote,
                        pageIndex: evidenceItem.pageIndex,
                        pageNumber: evidenceItem.pageNumber,
                    });
                }
            }
        }
        return evidence.length ? evidence : undefined;
    }
    mergeGraphEvidence(primary, fallback) {
        if (primary.length === 0)
            return fallback;
        if (fallback.length === 0)
            return primary;
        const merged = [];
        const seen = new Set();
        for (const item of [...primary, ...fallback]) {
            const key = [
                item.owner_kind,
                item.owner_id,
                item.pageIndex,
                item.pageNumber,
                item.quote,
            ].join('|');
            if (seen.has(key))
                continue;
            seen.add(key);
            merged.push(item);
        }
        return merged;
    }
    normalizeGraphPersonIdentity(person, memoryContext, primaryPageText, chapterText) {
        const prepared = this.prepareGraphPersonLabel(person.label);
        const fullName = this.findFullPersonNameInText(prepared.lookupLabel, primaryPageText)
            ?? this.findFullPersonNameInText(prepared.lookupLabel, chapterText)
            ?? this.findFullPersonNameInMemory(prepared.lookupLabel, memoryContext);
        if (!fullName) {
            if (prepared.canonicalLabel === person.label)
                return person;
            return {
                ...person,
                label: prepared.canonicalLabel,
                aliases: this.sanitizeGraphPersonAliases(prepared.canonicalLabel, this.mergeNormalizedStringArrays(person.aliases, prepared.aliases)),
            };
        }
        const aliases = this.sanitizeGraphPersonAliases(fullName, this.mergeNormalizedStringArrays(person.aliases, [
            ...prepared.aliases,
            prepared.canonicalLabel !== fullName ? prepared.canonicalLabel : '',
        ]));
        if (this.normalizePersonLabel(fullName) === this.normalizePersonLabel(prepared.canonicalLabel)) {
            return {
                ...person,
                label: fullName,
                aliases,
            };
        }
        return {
            ...person,
            label: fullName,
            aliases,
        };
    }
    prepareGraphPersonLabel(label) {
        const trimmed = label.trim();
        const aliases = new Set();
        let canonicalLabel = trimmed;
        const reordered = this.reorderCommaSeparatedPersonName(canonicalLabel);
        if (reordered && reordered !== canonicalLabel) {
            aliases.add(canonicalLabel);
            canonicalLabel = reordered;
        }
        const stripped = this.stripLeadingPersonTitle(canonicalLabel);
        if (stripped && stripped !== canonicalLabel && !this.isSurnameLikePersonLabel(stripped)) {
            aliases.add(canonicalLabel);
            canonicalLabel = stripped;
        }
        return {
            canonicalLabel,
            lookupLabel: stripped ?? canonicalLabel,
            aliases: Array.from(aliases),
        };
    }
    findFullPersonNameInText(label, text) {
        const uniqueMatches = this.findFullPersonNameCandidates(label, text);
        return uniqueMatches.length === 1 ? uniqueMatches[0] : undefined;
    }
    findFullPersonNameInMemory(label, memoryContext) {
        const surname = this.surnameToken(label);
        if (!surname || !memoryContext)
            return undefined;
        const matches = memoryContext.people
            .filter((item) => {
            const canonicalLastToken = this.lastToken(item.canonical_label)?.toLowerCase();
            if (canonicalLastToken === surname.toLowerCase())
                return true;
            return (item.aliases ?? []).some((alias) => this.normalizePersonLabel(alias) === surname.toLowerCase());
        })
            .map((item) => item.canonical_label);
        const uniqueMatches = Array.from(new Set(matches));
        return uniqueMatches.length === 1 ? uniqueMatches[0] : undefined;
    }
    findFullPersonNameCandidates(label, text) {
        const surname = this.surnameToken(label);
        if (!surname || !text)
            return [];
        const candidatePattern = /\b([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+){1,3})\b/g;
        return Array.from(new Set(Array.from(text.matchAll(candidatePattern))
            .map((match) => match[1]?.trim())
            .filter((candidate) => Boolean(candidate)
            && this.lastToken(candidate)?.toLowerCase() === surname.toLowerCase())));
    }
    normalizePersonLabel(label) {
        return label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s.]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    stripLeadingPersonTitle(label) {
        const stripped = label.trim().replace(PERSON_TITLE_PREFIX_PATTERN, '').trim();
        return stripped && stripped !== label.trim() ? stripped : undefined;
    }
    reorderCommaSeparatedPersonName(label) {
        const match = label.trim().match(/^([A-Z][A-Za-z'.-]+),\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)*)$/);
        if (!match)
            return undefined;
        const last = match[1]?.trim();
        const first = match[2]?.trim();
        if (!last || !first)
            return undefined;
        return `${first} ${last}`.trim();
    }
    shouldKeepGraphPersonNode(person) {
        const rawLabel = person.label.trim();
        if (!rawLabel)
            return false;
        if (PLACEHOLDER_PERSON_LABEL_PATTERN.test(rawLabel))
            return false;
        const normalized = this.normalizePersonLabel(rawLabel).replace(/\./g, '');
        if (GENERIC_PERSON_LABELS.has(normalized) || GENERIC_PERSON_GROUP_PATTERN.test(normalized))
            return false;
        return true;
    }
    findWorkLikeIdeaNodeIds(rawNodes, rawEdges) {
        if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges))
            return new Set();
        const nodeTypeById = new Map();
        for (const item of rawNodes) {
            if (!isPlainObject(item))
                continue;
            const id = asString(item.id);
            const type = asString(item.type);
            if (!id || !type)
                continue;
            nodeTypeById.set(id, type);
        }
        const result = new Set();
        for (const item of rawEdges) {
            if (!isPlainObject(item))
                continue;
            const from = asString(item.from);
            const to = asString(item.to);
            const relationType = asString(item.relation_type);
            const description = asString(item.description);
            if (!from || !to)
                continue;
            const authoredLikeRelation = relationType === 'authored'
                || Boolean(description
                    && AUTHORED_RELATION_PATTERN.test(description)
                    && !MENTIONS_RELATION_PATTERN.test(description));
            if (!authoredLikeRelation)
                continue;
            if (nodeTypeById.get(from) === 'person' && nodeTypeById.get(to) === 'idea') {
                result.add(to);
            }
        }
        return result;
    }
    sanitizeGraphPersonAliases(canonicalLabel, aliases) {
        if (!aliases?.length)
            return undefined;
        const canonicalNormalized = this.normalizePersonLabel(canonicalLabel);
        const canonicalSurname = this.lastToken(this.prepareGraphPersonLabel(canonicalLabel).canonicalLabel)?.toLowerCase();
        const sanitized = aliases.filter((alias) => {
            const normalizedAlias = this.normalizePersonLabel(alias);
            if (!normalizedAlias || normalizedAlias === canonicalNormalized)
                return false;
            const preparedAlias = this.prepareGraphPersonLabel(alias).canonicalLabel;
            if (!this.looksLikeFullPersonName(preparedAlias))
                return true;
            const aliasSurname = this.lastToken(preparedAlias)?.toLowerCase();
            return !canonicalSurname || !aliasSurname || aliasSurname === canonicalSurname;
        });
        return sanitized.length ? sanitized : undefined;
    }
    surnameToken(label) {
        if (!this.isSurnameLikePersonLabel(label))
            return undefined;
        return this.lastToken(label);
    }
    isSurnameLikePersonLabel(label) {
        const words = label.trim().split(/\s+/).filter(Boolean);
        return words.length === 1 && /^[A-Z][A-Za-z'.-]+$/.test(words[0] ?? '');
    }
    looksLikeFullPersonName(label) {
        return /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+$/.test(label.trim());
    }
    isWorkLikeIdeaLabel(label, description) {
        const trimmed = label.trim();
        const normalizedDescription = description?.toLowerCase() ?? '';
        if (/\b(book|report|paper|article|essay|text|work|journal|magazine|memoir|novel)\b/.test(normalizedDescription)) {
            return true;
        }
        if (/^(the|a|an)\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,6}$/.test(trimmed)) {
            return true;
        }
        return /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){2,6}$/.test(trimmed);
    }
    lastToken(label) {
        const words = label.trim().split(/\s+/).filter(Boolean);
        return words.length ? words[words.length - 1] : undefined;
    }
    mergeNormalizedStringArrays(left, right) {
        const merged = [...(left ?? []), ...(right ?? [])]
            .map((item) => item.trim())
            .filter(Boolean);
        if (merged.length === 0)
            return undefined;
        const seen = new Set();
        const result = [];
        for (const item of merged) {
            const normalized = item.toLowerCase();
            if (seen.has(normalized))
                continue;
            seen.add(normalized);
            result.push(item);
        }
        return result;
    }
    deduplicateGraphNodes(nodes) {
        const deduplicated = [];
        const nodeIdRedirects = new Map();
        for (const node of nodes) {
            if (node.type === 'person') {
                const duplicateIndex = deduplicated.findIndex((candidate) => candidate.type === 'person' && this.areSamePersonNode(candidate, node));
                if (duplicateIndex < 0) {
                    deduplicated.push(node);
                    continue;
                }
                const existing = deduplicated[duplicateIndex];
                const merged = this.mergePersonNodes(existing, node);
                deduplicated[duplicateIndex] = merged;
                const canonicalId = merged.id;
                nodeIdRedirects.set(existing.id, canonicalId);
                nodeIdRedirects.set(node.id, canonicalId);
                continue;
            }
            if (node.type !== 'idea') {
                if (node.type !== 'entity') {
                    deduplicated.push(node);
                    continue;
                }
                const duplicateIndex = deduplicated.findIndex((candidate) => candidate.type === 'entity' && this.areSameEntityNode(candidate, node));
                if (duplicateIndex < 0) {
                    deduplicated.push(node);
                    continue;
                }
                const existing = deduplicated[duplicateIndex];
                const merged = this.mergeEntityNodes(existing, node);
                deduplicated[duplicateIndex] = merged;
                const canonicalId = merged.id;
                nodeIdRedirects.set(existing.id, canonicalId);
                nodeIdRedirects.set(node.id, canonicalId);
                continue;
            }
            if (node.type !== 'idea') {
                deduplicated.push(node);
                continue;
            }
            const duplicateIndex = deduplicated.findIndex((candidate) => candidate.type === 'idea' && this.areNearDuplicateIdeas(candidate, node));
            if (duplicateIndex < 0) {
                deduplicated.push(node);
                continue;
            }
            const existing = deduplicated[duplicateIndex];
            deduplicated[duplicateIndex] = this.mergeIdeaNodes(existing, node);
            nodeIdRedirects.set(node.id, existing.id);
        }
        return {
            nodes: deduplicated,
            nodeIdRedirects,
        };
    }
    mergePersonNodes(left, right) {
        const preferred = this.preferPersonNode(left, right);
        const fallback = preferred.id === left.id ? right : left;
        return {
            ...preferred,
            aliases: this.sortStrings(this.sanitizeGraphPersonAliases(preferred.label, this.mergeNormalizedStringArrays(preferred.aliases, [
                ...(fallback.aliases ?? []),
                preferred.label !== fallback.label ? fallback.label : '',
            ]))),
            roles: this.sortStrings(this.mergeNormalizedStringArrays(preferred.roles, fallback.roles)),
            traits: this.sortStrings(this.mergeNormalizedStringArrays(preferred.traits, fallback.traits)),
            importance: this.strongestGraphPersonImportance(left.importance, right.importance),
            description: preferred.description ?? fallback.description,
        };
    }
    preferPersonNode(left, right) {
        const leftWords = left.label.trim().split(/\s+/).filter(Boolean).length;
        const rightWords = right.label.trim().split(/\s+/).filter(Boolean).length;
        if (rightWords > leftWords)
            return right;
        if (rightWords < leftWords)
            return left;
        if ((right.description?.length ?? 0) > (left.description?.length ?? 0))
            return right;
        return left;
    }
    strongestGraphPersonImportance(left, right) {
        const rank = {
            main: 3,
            supporting: 2,
            minor: 1,
        };
        if (!left)
            return right;
        if (!right)
            return left;
        return rank[right] > rank[left] ? right : left;
    }
    areSamePersonNode(left, right) {
        const leftLabel = this.normalizePersonLabel(left.label);
        const rightLabel = this.normalizePersonLabel(right.label);
        if (!leftLabel || !rightLabel)
            return false;
        if (leftLabel === rightLabel)
            return true;
        const leftAliases = new Set((left.aliases ?? []).map((alias) => this.normalizePersonLabel(alias)));
        const rightAliases = new Set((right.aliases ?? []).map((alias) => this.normalizePersonLabel(alias)));
        if (leftAliases.has(rightLabel) || rightAliases.has(leftLabel))
            return true;
        if (Array.from(leftAliases).some((alias) => rightAliases.has(alias)))
            return true;
        if (this.isSurnameLikePersonLabel(left.label) && this.personNodeContainsSurname(right, leftLabel)) {
            return true;
        }
        if (this.isSurnameLikePersonLabel(right.label) && this.personNodeContainsSurname(left, rightLabel)) {
            return true;
        }
        return false;
    }
    personNodeContainsSurname(node, surname) {
        const normalizedSurname = surname.toLowerCase();
        if (this.lastToken(node.label)?.toLowerCase() === normalizedSurname)
            return true;
        return (node.aliases ?? []).some((alias) => this.normalizePersonLabel(alias) === normalizedSurname);
    }
    mergeIdeaNodes(left, right) {
        const preferred = this.preferIdeaNode(left, right);
        const fallback = preferred.id === left.id ? right : left;
        return {
            ...left,
            label: preferred.label,
            kind: preferred.kind,
            description: preferred.description ?? fallback.description ?? left.description ?? right.description,
        };
    }
    preferIdeaNode(left, right) {
        const leftContextScore = this.ideaContextSpecificityScore(left.label);
        const rightContextScore = this.ideaContextSpecificityScore(right.label);
        if (rightContextScore < leftContextScore)
            return right;
        if (rightContextScore > leftContextScore)
            return left;
        const leftWords = left.label.trim().split(/\s+/).filter(Boolean).length;
        const rightWords = right.label.trim().split(/\s+/).filter(Boolean).length;
        if (rightWords < leftWords)
            return right;
        if (rightWords > leftWords)
            return left;
        if ((right.description?.length ?? 0) > (left.description?.length ?? 0))
            return right;
        return left;
    }
    areNearDuplicateIdeas(left, right) {
        const leftPhrase = this.normalizeIdeaPhrase(left.label);
        const rightPhrase = this.normalizeIdeaPhrase(right.label);
        if (!leftPhrase || !rightPhrase)
            return false;
        if (leftPhrase === rightPhrase)
            return true;
        if (this.isCorrelationCausationIdea(left.label) && this.isCorrelationCausationIdea(right.label)) {
            return true;
        }
        if (leftPhrase.includes(rightPhrase) || rightPhrase.includes(leftPhrase))
            return true;
        const leftTokens = this.ideaDedupTokens(left.label);
        const rightTokens = this.ideaDedupTokens(right.label);
        if (leftTokens.length < 2 || rightTokens.length < 2)
            return false;
        const rightTokenSet = new Set(rightTokens);
        const overlap = leftTokens.filter((token) => rightTokenSet.has(token)).length;
        if (overlap < 2)
            return false;
        const smallerCoverage = overlap / Math.min(leftTokens.length, rightTokens.length);
        const union = new Set([...leftTokens, ...rightTokens]).size;
        const jaccard = union > 0 ? overlap / union : 0;
        return smallerCoverage >= 0.8 && jaccard >= 0.45;
    }
    normalizeIdeaPhrase(label) {
        return label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    ideaDedupTokens(label) {
        return this.normalizeIdeaPhrase(label)
            .split(' ')
            .map((token) => token.trim())
            .filter((token) => token.length > 2
            && !IDEA_DEDUP_STOPWORDS.has(token));
    }
    ideaContextSpecificityScore(label) {
        const normalized = this.normalizeIdeaPhrase(label);
        return CONTEXT_HEAVY_IDEA_TOKENS.filter((token) => normalized.includes(token)).length;
    }
    isCorrelationCausationIdea(label) {
        return CORRELATION_CAUSATION_IDEA_PATTERN.test(label);
    }
    rewriteGraphNodeId(nodeId, nodeIdRedirects) {
        if (!nodeId)
            return undefined;
        return nodeIdRedirects.get(nodeId) ?? nodeId;
    }
    normalizeGraphEdges(edges, nodesById) {
        const normalized = edges
            .map((edge) => this.normalizeGraphEdge(edge, nodesById))
            .filter((edge) => edge !== null);
        return normalized.length ? normalized : undefined;
    }
    normalizeGraphEdge(edge, nodesById) {
        if (edge.from === edge.to)
            return null;
        let normalized = edge;
        let fromNode = nodesById.get(normalized.from);
        let toNode = nodesById.get(normalized.to);
        if (!fromNode || !toNode)
            return null;
        normalized = {
            ...normalized,
            relation_type: this.normalizeSemanticRelationType(normalized, fromNode, toNode),
        };
        if (normalized.relation_type === 'happens_at'
            && toNode.type === 'event'
            && fromNode.type !== 'event') {
            normalized = {
                ...normalized,
                from: edge.to,
                to: edge.from,
            };
        }
        else if (normalized.relation_type === 'located_in'
            && fromNode.type === 'entity'
            && (fromNode.entity_type === 'place' || fromNode.entity_type === 'time')
            && toNode.type === 'event') {
            normalized = {
                ...normalized,
                from: edge.to,
                to: edge.from,
                relation_type: 'happens_at',
            };
        }
        else if (normalized.relation_type === 'located_in'
            && fromNode.type === 'event'
            && toNode.type === 'entity'
            && (toNode.entity_type === 'place' || toNode.entity_type === 'time')) {
            normalized = {
                ...normalized,
                relation_type: 'happens_at',
            };
        }
        else if ((normalized.relation_type === 'supports'
            || normalized.relation_type === 'opposes'
            || normalized.relation_type === 'illustrates'
            || normalized.relation_type === 'reflects')
            && this.isAbstractGraphNodeType(fromNode.type)
            && this.isConcreteGraphNodeType(toNode.type)) {
            normalized = {
                ...normalized,
                from: edge.to,
                to: edge.from,
            };
        }
        fromNode = nodesById.get(normalized.from);
        toNode = nodesById.get(normalized.to);
        if (!fromNode || !toNode)
            return null;
        if (!this.shouldKeepGraphEdge(normalized, fromNode, toNode))
            return null;
        return normalized;
    }
    shouldKeepGraphEdge(edge, fromNode, toNode) {
        if (edge.from === edge.to)
            return false;
        if (edge.relation_type === 'reflects' || edge.relation_type === 'illustrates') {
            if (this.isAbstractGraphNodeType(fromNode.type)
                && this.isAbstractGraphNodeType(toNode.type)) {
                return false;
            }
        }
        if (edge.relation_type === 'happens_at' && toNode.type === 'person') {
            return false;
        }
        if (edge.relation_type === 'happens_at') {
            return fromNode.type === 'event'
                && toNode.type === 'entity'
                && (toNode.entity_type === 'place' || toNode.entity_type === 'time');
        }
        if (edge.relation_type === 'located_in') {
            return false;
        }
        if (edge.relation_type === 'participates_in') {
            return toNode.type === 'event' && !this.isAbstractGraphNodeType(fromNode.type);
        }
        if (edge.relation_type === 'related_to'
            && edge.description
            && LOW_SIGNAL_RELATED_TO_PATTERN.test(edge.description)) {
            return false;
        }
        return true;
    }
    canonicalizeGraphEntityType(label, entityType, description) {
        if (entityType !== 'other')
            return entityType;
        const normalized = this.normalizeEntityLabel(label);
        const normalizedDescription = description?.trim().toLowerCase() ?? '';
        if (/(?:^|\s)(company|corporation|corp|inc|agency|association|committee|department|government|firm|organization|party|school|university|bank|club|union|board|office|press|publisher|team|police)(?:$|\s)/.test(normalized)) {
            return 'organization';
        }
        if (/\b(agents|officers|mechanics|teachers|doctors|lawyers|judges|workers|students|voters|officials|economists|realtors|parents|drivers|editors|reporters)\b/.test(normalized)) {
            return 'organization';
        }
        if (PLACE_ENTITY_HINT_PATTERN.test(normalizedDescription)) {
            return 'place';
        }
        if (OBJECT_ENTITY_HINT_PATTERN.test(normalizedDescription)) {
            return 'object';
        }
        return entityType;
    }
    shouldReclassifyEntityNodeAsIdea(label, entityType, description) {
        if (entityType === 'object' || entityType === 'organization' || entityType === 'time') {
            return false;
        }
        const normalizedLabel = this.normalizeEntityLabel(label);
        const normalizedDescription = description?.trim().toLowerCase() ?? '';
        if (PLACE_ENTITY_HINT_PATTERN.test(normalizedLabel) || PLACE_ENTITY_HINT_PATTERN.test(normalizedDescription)) {
            return false;
        }
        if (OBJECT_ENTITY_HINT_PATTERN.test(normalizedLabel)) {
            return false;
        }
        if (this.isWorkLikeIdeaLabel(label, description)) {
            return false;
        }
        return ABSTRACT_ENTITY_IDEA_LABEL_PATTERN.test(label)
            || ABSTRACT_ENTITY_IDEA_DESCRIPTION_PATTERN.test(normalizedDescription);
    }
    normalizeEntityLabel(label) {
        return label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    areSameEntityNode(left, right) {
        const leftLabel = this.normalizeEntityLabel(left.label);
        const rightLabel = this.normalizeEntityLabel(right.label);
        if (!leftLabel || !rightLabel || leftLabel !== rightLabel)
            return false;
        if (left.entity_type === right.entity_type)
            return true;
        return left.entity_type === 'other' || right.entity_type === 'other';
    }
    mergeEntityNodes(left, right) {
        const preferred = this.preferEntityNode(left, right);
        const fallback = preferred.id === left.id ? right : left;
        return {
            ...preferred,
            description: preferred.description ?? fallback.description,
        };
    }
    preferEntityNode(left, right) {
        const leftPriority = ENTITY_TYPE_PRIORITY[left.entity_type];
        const rightPriority = ENTITY_TYPE_PRIORITY[right.entity_type];
        if (rightPriority > leftPriority)
            return right;
        if (rightPriority < leftPriority)
            return left;
        if ((right.description?.length ?? 0) > (left.description?.length ?? 0))
            return right;
        return left;
    }
    normalizeSemanticRelationType(edge, fromNode, toNode) {
        const description = edge.description?.trim();
        const normalizedDescription = description?.toLowerCase();
        if (edge.relation_type === 'authored') {
            if (this.shouldUseFoundedRelation(description, fromNode, toNode)) {
                return 'founded';
            }
            if (!this.shouldKeepAuthoredRelation(fromNode, toNode)) {
                return 'related_to';
            }
            return edge.relation_type;
        }
        if (edge.relation_type !== 'related_to' && edge.relation_type !== 'reflects') {
            return edge.relation_type;
        }
        if (edge.relation_type === 'related_to'
            && fromNode.type === 'person'
            && toNode.type === 'entity'
            && description
            && AUTHORED_RELATION_PATTERN.test(description)
            && !MENTIONS_RELATION_PATTERN.test(description)) {
            if (this.shouldUseFoundedRelation(description, fromNode, toNode)) {
                return 'founded';
            }
            if (!this.shouldKeepAuthoredRelation(fromNode, toNode)) {
                return 'related_to';
            }
            return 'authored';
        }
        if (edge.relation_type === 'related_to'
            && fromNode.type === 'person'
            && toNode.type === 'idea'
            && description
            && ARGUES_RELATION_PATTERN.test(description)) {
            return 'argues';
        }
        if (edge.relation_type === 'related_to'
            && description
            && MENTIONS_RELATION_PATTERN.test(description)) {
            return 'mentions';
        }
        if (this.shouldUseIllustratesRelation(edge.relation_type, normalizedDescription, fromNode, toNode)) {
            return 'illustrates';
        }
        return edge.relation_type;
    }
    shouldUseFoundedRelation(description, fromNode, toNode) {
        return Boolean(description
            && fromNode.type === 'person'
            && toNode.type === 'entity'
            && toNode.entity_type !== 'object'
            && FOUNDED_RELATION_PATTERN.test(description));
    }
    shouldKeepAuthoredRelation(fromNode, toNode) {
        return fromNode.type === 'person'
            && toNode.type === 'entity'
            && (toNode.entity_type === 'object' || this.isWorkLikeEntity(toNode));
    }
    isWorkLikeEntity(node) {
        const label = node.label.trim();
        const description = node.description?.toLowerCase() ?? '';
        if (node.entity_type === 'object')
            return true;
        if (/\b(book|report|paper|article|essay|text|work|journal|magazine)\b/.test(description)) {
            return true;
        }
        return /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,5}$/.test(label);
    }
    shouldUseIllustratesRelation(relationType, normalizedDescription, fromNode, toNode) {
        if (!this.hasConcreteAbstractPair(fromNode, toNode))
            return false;
        if (relationType === 'reflects')
            return true;
        return Boolean(normalizedDescription && ILLUSTRATES_RELATION_PATTERN.test(normalizedDescription));
    }
    hasConcreteAbstractPair(fromNode, toNode) {
        return ((this.isConcreteGraphNodeType(fromNode.type) && this.isAbstractGraphNodeType(toNode.type))
            || (this.isAbstractGraphNodeType(fromNode.type) && this.isConcreteGraphNodeType(toNode.type)));
    }
    isAbstractGraphNodeType(type) {
        return type === 'idea' || type === 'theme';
    }
    isConcreteGraphNodeType(type) {
        return type === 'person' || type === 'event' || type === 'entity';
    }
    countGraphNodes(nodes, type) {
        return nodes.filter((node) => node.type === type).length;
    }
    graphToKnowledgeExtractionData(graph) {
        const nodeEvidence = new Map();
        const edgeEvidence = new Map();
        for (const item of graph.evidence) {
            const target = item.owner_kind === 'node' ? nodeEvidence : edgeEvidence;
            const existing = target.get(item.owner_id) ?? [];
            existing.push({
                quote: item.quote,
                pageIndex: item.pageIndex,
                pageNumber: item.pageNumber,
            });
            target.set(item.owner_id, existing);
        }
        const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
        const relations = [];
        for (const edge of graph.edges) {
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
            title: graph.title,
            summary: graph.summary,
            people: graph.nodes
                .filter((node) => node.type === 'person')
                .map((node) => ({
                local_id: node.id,
                name: node.label,
                aliases: node.aliases,
                importance: node.importance,
                description: node.description,
                roles: node.roles,
                traits: node.traits,
                evidence: nodeEvidence.get(node.id),
            })),
            ideas: graph.nodes
                .filter((node) => node.type === 'idea')
                .map((node) => ({
                local_id: node.id,
                label: node.label,
                description: node.description,
                kind: node.kind,
                evidence: nodeEvidence.get(node.id),
            })),
            events: graph.nodes
                .filter((node) => node.type === 'event')
                .map((node) => ({
                local_id: node.id,
                label: node.label,
                description: node.description,
                participant_local_ids: node.participant_ids,
                time_hint: node.time_hint,
                place_hint: node.place_hint,
                evidence: nodeEvidence.get(node.id),
            })),
            entities: graph.nodes
                .filter((node) => node.type === 'entity')
                .map((node) => ({
                local_id: node.id,
                label: node.label,
                type: node.entity_type,
                description: node.description,
                evidence: nodeEvidence.get(node.id),
            })),
            themes: graph.nodes
                .filter((node) => node.type === 'theme')
                .map((node) => ({
                local_id: node.id,
                label: node.label,
                strength: node.strength,
                description: node.description,
                evidence: nodeEvidence.get(node.id),
            })),
            relations,
        };
    }
    enforceEvidenceCoverage(data) {
        const people = data.people.filter((person) => this.hasRequiredEvidence(person.evidence));
        const ideas = data.ideas.filter((idea) => this.hasRequiredEvidence(idea.evidence));
        const events = data.events.filter((event) => this.hasRequiredEvidence(event.evidence));
        const entities = data.entities.filter((entity) => this.hasRequiredEvidence(entity.evidence));
        const themes = data.themes.filter((theme) => this.hasRequiredEvidence(theme.evidence));
        const keptNodeIds = new Set([
            ...people.map((person) => person.local_id),
            ...ideas.map((idea) => idea.local_id),
            ...events.map((event) => event.local_id),
            ...entities.map((entity) => entity.local_id),
            ...themes.map((theme) => theme.local_id),
        ]);
        const relations = data.relations.filter((relation) => this.hasRequiredEvidence(relation.evidence)
            && keptNodeIds.has(relation.from_id)
            && keptNodeIds.has(relation.to_id));
        return {
            ...data,
            people,
            ideas,
            events,
            entities,
            themes,
            relations,
        };
    }
    hasRequiredEvidence(evidence) {
        return Array.isArray(evidence) && evidence.length > 0;
    }
    buildMemoryContext(snapshot, currentPageIndex) {
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
            people: this.compactMemoryItems(snapshot.people.map((person) => ({
                local_id: person.local_id,
                canonical_label: person.name,
                aliases: person.aliases,
                importance: person.importance,
                relation_hints: this.limitMemoryRelationHints(relationHintsByNode.get(person.local_id)),
                seen_pages: this.limitMemorySeenPages(this.collectSeenPages(person.evidence)),
            })), currentPageIndex, MEMORY_ITEM_LIMITS.people),
            ideas: this.compactMemoryItems(snapshot.ideas.map((idea) => ({
                local_id: idea.local_id,
                canonical_label: idea.label,
                relation_hints: this.limitMemoryRelationHints(relationHintsByNode.get(idea.local_id)),
                seen_pages: this.limitMemorySeenPages(this.collectSeenPages(idea.evidence)),
            })), currentPageIndex, MEMORY_ITEM_LIMITS.ideas),
            events: this.compactMemoryItems(snapshot.events.map((event) => ({
                local_id: event.local_id,
                canonical_label: event.label,
                relation_hints: this.limitMemoryRelationHints(relationHintsByNode.get(event.local_id)),
                seen_pages: this.limitMemorySeenPages(this.collectSeenPages(event.evidence)),
            })), currentPageIndex, MEMORY_ITEM_LIMITS.events),
            entities: this.compactMemoryItems(snapshot.entities.map((entity) => ({
                local_id: entity.local_id,
                canonical_label: entity.label,
                relation_hints: this.limitMemoryRelationHints(relationHintsByNode.get(entity.local_id)),
                seen_pages: this.limitMemorySeenPages(this.collectSeenPages(entity.evidence)),
            })), currentPageIndex, MEMORY_ITEM_LIMITS.entities),
            themes: this.compactMemoryItems(snapshot.themes.map((theme) => ({
                local_id: theme.local_id,
                canonical_label: theme.label,
                relation_hints: this.limitMemoryRelationHints(relationHintsByNode.get(theme.local_id)),
                seen_pages: this.limitMemorySeenPages(this.collectSeenPages(theme.evidence)),
            })), currentPageIndex, MEMORY_ITEM_LIMITS.themes),
        };
    }
    compactMemoryItems(items, currentPageIndex, limit) {
        if (items.length <= limit)
            return items;
        const importanceRank = {
            main: 3,
            supporting: 2,
            minor: 1,
        };
        return [...items]
            .sort((left, right) => {
            const leftDistance = this.memoryDistance(left.seen_pages, currentPageIndex);
            const rightDistance = this.memoryDistance(right.seen_pages, currentPageIndex);
            if (leftDistance !== rightDistance)
                return leftDistance - rightDistance;
            const leftImportance = left.importance ? importanceRank[left.importance] : 0;
            const rightImportance = right.importance ? importanceRank[right.importance] : 0;
            if (leftImportance !== rightImportance)
                return rightImportance - leftImportance;
            const leftHints = left.relation_hints?.length ?? 0;
            const rightHints = right.relation_hints?.length ?? 0;
            if (leftHints !== rightHints)
                return rightHints - leftHints;
            return left.canonical_label.localeCompare(right.canonical_label);
        })
            .slice(0, limit);
    }
    memoryDistance(seenPages, currentPageIndex) {
        if (currentPageIndex === undefined || !seenPages || seenPages.length === 0) {
            return Number.MAX_SAFE_INTEGER;
        }
        return Math.min(...seenPages.map((pageIndex) => Math.abs(pageIndex - currentPageIndex)));
    }
    limitMemoryRelationHints(value) {
        return value?.slice(0, MAX_MEMORY_RELATION_HINTS);
    }
    limitMemorySeenPages(value) {
        return value.slice(-MAX_MEMORY_SEEN_PAGES);
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
                }, ...input.piece.pageRefs.slice(1).map((pageRef) => ({
                    pageIndex: pageRef.pageIndex,
                    pageNumber: pageRef.pageNumber,
                    sourceHash: input.piece.sourceHash,
                }))],
        };
    }
    createFallbackChapterContext(input) {
        return {
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            pages: input.piece.pageRefs.map((pageRef) => ({
                pageIndex: pageRef.pageIndex,
                pageNumber: pageRef.pageNumber,
                sourceHash: input.piece.sourceHash,
            })),
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
    sanitizePeople(value, allowedPageRefs, pageTextByPageIndex) {
        if (!Array.isArray(value))
            return undefined;
        const people = value
            .map((item, index) => {
            if (!isPlainObject(item))
                return null;
            const name = asString(item.name);
            if (!name)
                return null;
            const rawImportance = asString(item.importance);
            const importance = rawImportance === 'main' || rawImportance === 'supporting' || rawImportance === 'minor'
                ? rawImportance
                : undefined;
            return {
                local_id: asString(item.local_id) ?? `p${index + 1}`,
                name,
                aliases: this.sanitizeStringArray(item.aliases),
                importance,
                description: asString(item.description),
                roles: this.sanitizeStringArray(item.roles),
                traits: this.sanitizeStringArray(item.traits),
                evidence: this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex),
            };
        })
            .filter((item) => item !== null);
        return people.length ? people : undefined;
    }
    sanitizeIdeas(value, allowedPageRefs, pageTextByPageIndex, promptVariant = 'nonfiction') {
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
                evidence: this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex),
            };
            if (!this.shouldKeepIdea(idea, promptVariant))
                return null;
            return idea;
        })
            .filter((item) => item !== null);
        return ideas.length ? ideas : undefined;
    }
    shouldKeepIdea(idea, promptVariant = 'nonfiction') {
        const label = idea.label.trim();
        const normalized = label.toLowerCase();
        const words = normalized.split(/\s+/).filter(Boolean);
        if (words.length === 0)
            return false;
        if (label.length > 72 || words.length > 10)
            return false;
        if (/[.?!:]$/.test(label))
            return false;
        if (promptVariant === 'fiction')
            return true;
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
        if (idea.kind === 'principle') {
            if (normalized.includes('\'s') && words.length > 5)
                return false;
            if (/\bwhen\b/.test(normalized) && words.length > 6)
                return false;
        }
        return true;
    }
    sanitizeEvents(value, allowedPageRefs, pageTextByPageIndex) {
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
                evidence: this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex),
            };
        })
            .filter((item) => item !== null);
        return events.length ? events : undefined;
    }
    sanitizeEntities(value, allowedPageRefs, pageTextByPageIndex) {
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
                evidence: this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex),
            };
        })
            .filter((item) => item !== null);
        return entities.length ? entities : undefined;
    }
    sanitizeThemes(value, allowedPageRefs, pageTextByPageIndex) {
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
                evidence: this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex),
            };
        })
            .filter((item) => item !== null);
        return themes.length ? themes : undefined;
    }
    sanitizeRelations(value, allowedPageRefs, pageTextByPageIndex) {
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
                evidence: this.sanitizeEvidence(item.evidence, allowedPageRefs, pageTextByPageIndex),
            };
        })
            .filter((item) => item !== null);
        return relations.length ? relations : undefined;
    }
    buildPageTextByPageIndex(bookId, chapterId, allowedPageRefs) {
        const pageTextByPageIndex = new Map();
        for (const pageRef of allowedPageRefs) {
            const page = this.bookIngestionRepository.getPage(bookId, chapterId, pageRef.pageIndex);
            const pageText = asString(page?.pageTextMaterialized);
            if (pageText) {
                pageTextByPageIndex.set(pageRef.pageIndex, pageText);
            }
        }
        return pageTextByPageIndex;
    }
    inferEvidencePageRef(quote, allowedPageRefs, pageTextByPageIndex) {
        const singleAllowedPage = allowedPageRefs.length === 1 ? allowedPageRefs[0] : undefined;
        if (singleAllowedPage)
            return singleAllowedPage;
        if (!pageTextByPageIndex || pageTextByPageIndex.size === 0)
            return undefined;
        const normalizedQuote = normalizeExcerptText(quote);
        if (!normalizedQuote)
            return undefined;
        const matchingPageRefs = allowedPageRefs.filter((pageRef) => {
            const pageText = pageTextByPageIndex.get(pageRef.pageIndex);
            return pageText ? normalizeExcerptText(pageText).includes(normalizedQuote) : false;
        });
        return matchingPageRefs.length === 1 ? matchingPageRefs[0] : undefined;
    }
    createPageRef(pageIndex, pageNumber) {
        return { pageIndex, pageNumber };
    }
    combinePieceSourceHashes(left, right) {
        return (0, node_crypto_1.createHash)('sha256').update(`${left}\n${right}`).digest('hex');
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
            progress: this.visibleProgressForStatus(run),
            checkpoint: run.checkpoint,
        };
    }
    visibleProgressForStatus(run) {
        if (run.status !== 'queued' && run.status !== 'running') {
            return undefined;
        }
        if (!run.progress)
            return undefined;
        return {
            percent: clampProgressPercent(run.progress.percent),
            stage: run.progress.stage,
            message: run.progress.message,
        };
    }
    publishWorkflowProgress(workflowRunId, progress) {
        this.knowledgeExtractionWorkflowRepository.updateRunProgress(workflowRunId, {
            percent: clampProgressPercent(progress.percent),
            stage: progress.stage,
            message: progress.message,
        });
    }
    progressPercentForProcessedPieces(processedPieces, totalPieces) {
        if (totalPieces <= 0)
            return INITIAL_RUNNING_PROGRESS_PERCENT;
        const boundedProcessedPieces = Math.min(Math.max(processedPieces, 0), totalPieces);
        const percent = INITIAL_RUNNING_PROGRESS_PERCENT + (boundedProcessedPieces / totalPieces) * 90;
        return clampProgressPercent(Math.min(percent, 99));
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
    async requireRunForResult(workflowRunId) {
        const run = await this.knowledgeExtractionWorkflowRepository.getRunFromStore(workflowRunId);
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
    requireRestartMode(value) {
        const result = asString(value);
        if (result !== 'resume' && result !== 'from_start') {
            throw new common_1.BadRequestException('mode must be "resume" or "from_start"');
        }
        return result;
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
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => quiz_workflow_repository_1.QuizWorkflowRepository))),
    __param(5, (0, common_1.Optional)()),
    __param(5, (0, common_1.Inject)(core_1.ModuleRef)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        book_context_service_1.BookContextService,
        knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository,
        workflow_queue_service_1.WorkflowQueueService,
        quiz_workflow_repository_1.QuizWorkflowRepository,
        core_1.ModuleRef])
], KnowledgeExtractionWorkflowService);
//# sourceMappingURL=knowledge-extraction-workflow.service.js.map