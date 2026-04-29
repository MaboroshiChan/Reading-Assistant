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
exports.QuizWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const promises_1 = __importDefault(require("node:fs/promises"));
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const workflow_logger_1 = require("../workflow.logger");
const prompt_path_1 = require("../../utils/prompt-path");
const quiz_workflow_repository_1 = require("./quiz-workflow.repository");
const llmService_1 = require("../../../services/llmService");
const workflow_queue_service_1 = require("../workflow-queue/workflow-queue.service");
const PROMPT_VERSION = 'quiz.v1.0';
const PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('quiz.txt');
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
let cachedQuizSystemPrompt = null;
let QuizWorkflowService = class QuizWorkflowService {
    bookIngestionRepository;
    quizWorkflowRepository;
    workflowQueueService;
    constructor(bookIngestionRepository, quizWorkflowRepository, workflowQueueService) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.quizWorkflowRepository = quizWorkflowRepository;
        this.workflowQueueService = workflowQueueService;
    }
    parseSubmitRequest(rawBody) {
        if (!rawBody || rawBody.trim() === '') {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'quiz_generation',
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
                workflowKind: 'quiz_generation',
                reason: 'invalid_json',
                error: error instanceof Error ? error.message : String(error),
            });
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed)) {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'quiz_generation',
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
            workflowKind: 'quiz_generation',
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
    submitQuizWorkflow(request) {
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
            throw new common_1.ConflictException('Canonical chapter text is empty; ingest pages before submitting quiz workflow');
        }
        const input = {
            ...request,
            idempotencyKey: request.idempotencyKey ?? this.buildDefaultIdempotencyKey(request.bookId, request.chapterId, request.workflowVersion, chapter.chapterContentHash),
            expectedSnapshotVersion: request.expectedSnapshotVersion ?? book.snapshotVersion,
            expectedChapterContentHash: request.expectedChapterContentHash ?? chapter.chapterContentHash,
        };
        const { run, deduped } = this.quizWorkflowRepository.createOrReuseRun(input);
        if (!deduped) {
            this.workflowQueueService.enqueue(() => this.executeRun(run.id));
        }
        const canonicalRun = deduped ? this.quizWorkflowRepository.getRun(run.id) ?? run : run;
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
            throw new common_1.ConflictException('Quiz workflow result is not available yet');
        }
        (0, workflow_logger_1.workflowLog)('result.read_hit', {
            workflowKind: run.kind,
            workflowRunId: run.id,
            bookId: run.bookId,
            chapterId: run.chapterId,
            status: run.status,
            resultQuestionCount: run.output.questions.length,
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
    getLatestChapterQuiz(bookId, chapterId) {
        const result = this.quizWorkflowRepository.getLatestResult(bookId, chapterId);
        if (!result) {
            (0, workflow_logger_1.workflowLog)('latest_result.read_miss', {
                workflowKind: 'quiz_generation',
                bookId,
                chapterId,
            });
            throw new common_1.NotFoundException('No completed quiz workflow result found for chapter');
        }
        (0, workflow_logger_1.workflowLog)('latest_result.read_hit', {
            workflowKind: 'quiz_generation',
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
        const runningRun = this.quizWorkflowRepository.markRunning(workflowRunId);
        if (!runningRun)
            return;
        const book = this.bookIngestionRepository.getBook(runningRun.bookId);
        const chapter = this.bookIngestionRepository.getChapter(runningRun.bookId, runningRun.chapterId);
        if (!book || !chapter) {
            this.quizWorkflowRepository.failRun(workflowRunId, 'QUIZ_CHAPTER_NOT_FOUND', 'Canonical chapter state was not found during workflow execution.');
            return;
        }
        if (runningRun.expectedSnapshotVersion !== undefined
            && runningRun.expectedSnapshotVersion !== book.snapshotVersion) {
            this.quizWorkflowRepository.markStale(workflowRunId, 'QUIZ_CANONICAL_BOOK_STALE', 'Canonical book snapshot changed before quiz workflow execution completed.');
            return;
        }
        if (runningRun.expectedChapterContentHash !== undefined
            && runningRun.expectedChapterContentHash !== chapter.chapterContentHash) {
            this.quizWorkflowRepository.markStale(workflowRunId, 'QUIZ_CANONICAL_CHAPTER_STALE', 'Canonical chapter content changed before quiz workflow execution completed.');
            return;
        }
        if (chapter.chapterTextMaterialized.trim().length === 0) {
            this.quizWorkflowRepository.failRun(workflowRunId, 'QUIZ_EMPTY_CHAPTER_TEXT', 'Canonical chapter text is empty; unable to generate quiz.');
            return;
        }
        try {
            const result = await this.generateQuiz({
                bookId: runningRun.bookId,
                chapterId: runningRun.chapterId,
                chapterTitle: chapter.chapterTitle,
                chapterText: chapter.chapterTextMaterialized,
            });
            this.quizWorkflowRepository.completeRun({
                workflowRunId,
                snapshotVersion: book.snapshotVersion,
                chapterContentHash: chapter.chapterContentHash,
                result,
            });
        }
        catch (error) {
            this.quizWorkflowRepository.failRun(workflowRunId, 'QUIZ_GENERATION_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    async generateQuiz(input) {
        const [systemPrompt, userPrompt] = await Promise.all([
            this.loadPrompt(),
            Promise.resolve(this.buildPrompt(input)),
        ]);
        const llmClient = (0, llmService_1.createLLMClient)({ systemPrompt });
        const response = await llmClient.json(userPrompt);
        let text = '';
        for await (const chunk of response.data) {
            text += chunk;
        }
        const parsed = (0, llmService_1.extractJsonFromText)(text);
        const questions = this.coerceQuizQuestions(parsed);
        if (questions.length === 0) {
            throw new Error('Quiz LLM response did not contain any valid questions');
        }
        return { questions };
    }
    buildPrompt(input) {
        const sections = [
            `Book ID: ${input.bookId}`,
            `Chapter ID: ${input.chapterId}`,
            `Chapter Title: ${input.chapterTitle ?? ''}`,
            `Prompt Version: ${PROMPT_VERSION}`,
            '',
            'Chapter text:',
            '```text',
            input.chapterText,
            '```',
            '',
            'Respond with JSON only. Do not wrap the JSON in markdown fences.',
        ];
        return sections.join('\n');
    }
    async loadPrompt() {
        if (cachedQuizSystemPrompt)
            return cachedQuizSystemPrompt;
        cachedQuizSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
        return cachedQuizSystemPrompt;
    }
    coerceQuizQuestions(value) {
        if (!isPlainObject(value) || !Array.isArray(value.questions))
            return [];
        const questions = value.questions
            .map((question, index) => this.coerceQuizQuestion(question, index))
            .filter((question) => question !== null);
        const unique = new Map();
        for (const question of questions) {
            if (!unique.has(question.id)) {
                unique.set(question.id, question);
            }
        }
        return Array.from(unique.values());
    }
    coerceQuizQuestion(value, index) {
        if (!isPlainObject(value))
            return null;
        const options = Array.isArray(value.options)
            ? value.options.map(asString).filter((entry) => typeof entry === 'string')
            : [];
        if (options.length !== 4)
            return null;
        const correctAnswerIndex = asNumber(value.correctAnswerIndex);
        if (correctAnswerIndex === undefined || !Number.isInteger(correctAnswerIndex))
            return null;
        if (correctAnswerIndex < 0 || correctAnswerIndex > 3)
            return null;
        const question = asString(value.question);
        const explanation = asString(value.explanation);
        if (!question || !explanation)
            return null;
        return {
            id: asString(value.id) ?? `q${index + 1}`,
            type: 'multiple_choice',
            question,
            options: [options[0], options[1], options[2], options[3]],
            correctAnswerIndex,
            explanation,
            skill: this.normalizeSkill(asString(value.skill)),
        };
    }
    normalizeSkill(value) {
        switch (value) {
            case 'Facts':
            case 'Inference':
            case 'Tone':
            case 'Argument':
                return value;
            default:
                return 'Facts';
        }
    }
    buildDefaultIdempotencyKey(bookId, chapterId, workflowVersion, chapterContentHash) {
        return `quiz:${workflowVersion}:${bookId}:${chapterId}:${chapterContentHash}`;
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
        const run = this.quizWorkflowRepository.getRun(workflowRunId);
        if (!run) {
            (0, workflow_logger_1.workflowLog)('status.read_miss', {
                workflowKind: 'quiz_generation',
                workflowRunId,
            });
            throw new common_1.NotFoundException('Quiz workflow run not found');
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
exports.QuizWorkflowService = QuizWorkflowService;
exports.QuizWorkflowService = QuizWorkflowService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(book_ingestion_repository_1.BookIngestionRepository)),
    __param(1, (0, common_1.Inject)(quiz_workflow_repository_1.QuizWorkflowRepository)),
    __param(2, (0, common_1.Inject)(workflow_queue_service_1.WorkflowQueueService)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        quiz_workflow_repository_1.QuizWorkflowRepository,
        workflow_queue_service_1.WorkflowQueueService])
], QuizWorkflowService);
//# sourceMappingURL=quiz-workflow.service.js.map