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
const book_context_service_1 = require("../book-ingestion/book-context.service");
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const knowledge_extraction_workflow_repository_1 = require("../knowledge-extraction-workflow/knowledge-extraction-workflow.repository");
const workflow_logger_1 = require("../workflow.logger");
const prompt_path_1 = require("../../utils/prompt-path");
const quiz_workflow_repository_1 = require("./quiz-workflow.repository");
const llmService_1 = require("../../../services/llmService");
const workflow_queue_service_1 = require("../workflow-queue/workflow-queue.service");
const PROMPT_VERSION = 'quiz.v3.0';
const PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('quiz.txt');
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const hasBlankSemantics = (question) => /_{3,}/.test(question)
    || /\b(fill in the blank|complete the sentence|choose the (?:best|most (?:appropriate|suitable)) (?:word|phrase)|select the (?:best|most (?:appropriate|suitable)) (?:word|phrase))\b/i.test(question);
let cachedQuizSystemPrompt = null;
let QuizWorkflowService = class QuizWorkflowService {
    bookIngestionRepository;
    bookContextService;
    knowledgeExtractionWorkflowRepository;
    quizWorkflowRepository;
    workflowQueueService;
    constructor(bookIngestionRepository, bookContextService, knowledgeExtractionWorkflowRepository, quizWorkflowRepository, workflowQueueService) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.bookContextService = bookContextService;
        this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
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
        this.requireMatchingKnowledgeExtractionResult(request.bookId, request.chapterId, input.expectedSnapshotVersion, input.expectedChapterContentHash);
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
        const matchingKnowledgeExtraction = this.findMatchingKnowledgeExtractionResult(runningRun.bookId, runningRun.chapterId, runningRun.expectedSnapshotVersion, runningRun.expectedChapterContentHash);
        if (!matchingKnowledgeExtraction) {
            this.quizWorkflowRepository.markStale(workflowRunId, 'QUIZ_KNOWLEDGE_EXTRACTION_STALE', 'Matching knowledge extraction result is missing or stale for the current chapter state.');
            return;
        }
        try {
            const result = await this.generateQuiz({
                bookId: runningRun.bookId,
                chapterId: runningRun.chapterId,
                chapterTitle: chapter.chapterTitle,
                chapterText: chapter.chapterTextMaterialized,
                chapterContentHash: chapter.chapterContentHash,
                chapterSummary: matchingKnowledgeExtraction.result.summary,
                knowledge: matchingKnowledgeExtraction.result,
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
        const allUnits = this.deriveKnowledgeUnits(input.knowledge);
        if (allUnits.length === 0) {
            throw new Error('No eligible knowledge units were available for quiz generation');
        }
        const selectedUnits = this.planQuestionUnits(this.selectKnowledgeUnits(allUnits));
        const bookContext = this.bookContextService.buildBookContextBundle(input.bookId, input.chapterId);
        const chapterContext = this.bookContextService.buildChapterContextBundle(input.bookId, input.chapterId);
        const groupedUnits = Array.from(this.groupUnitsByAnchorPage(selectedUnits).values());
        const questions = [];
        for (const groupUnits of groupedUnits) {
            const pageWindow = this.bookContextService.buildPageWindowContext(input.bookId, input.chapterId, groupUnits[0].anchorPageIndex);
            if (!pageWindow)
                continue;
            const groupQuestions = await this.generateQuizForUnits({
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterTitle: input.chapterTitle,
                chapterText: input.chapterText,
                chapterContentHash: input.chapterContentHash,
                chapterSummary: input.chapterSummary,
                bookContext,
                chapterContext,
                pageWindow,
                units: groupUnits,
            });
            questions.push(...groupQuestions);
        }
        if (questions.length === 0) {
            throw new Error('Quiz LLM response did not contain any valid questions');
        }
        return { questions: questions.slice(0, 5) };
    }
    async generateQuizForUnits(input) {
        const [systemPrompt, userPrompt] = await Promise.all([
            this.loadPrompt(),
            Promise.resolve(this.buildUnitsSuffixPrompt(input)),
        ]);
        const llmClient = (0, llmService_1.createLLMClient)({
            systemPrompt,
            prefixCache: {
                cacheKey: `quiz.chapter_prefix:${PROMPT_VERSION}:${input.bookId}:${input.chapterId}:${input.chapterContentHash}`,
                displayName: `quiz-${input.bookId}-${input.chapterId}`,
                prefix: this.buildChapterCachedPrefix(input),
            },
        });
        const response = await llmClient.json(userPrompt);
        let text = '';
        for await (const chunk of response.data) {
            text += chunk;
        }
        const parsed = (0, llmService_1.extractJsonFromText)(text);
        return this.coerceQuizQuestions(parsed, input.units);
    }
    buildChapterCachedPrefix(input) {
        const book = this.bookIngestionRepository.getBook(input.bookId);
        const metadataRecord = isPlainObject(book?.bookMetadata) ? book.bookMetadata : {};
        const stableBookMetadata = {
            bookId: input.bookId,
            title: asString(metadataRecord.title),
            author: asString(metadataRecord.author),
            language: asString(metadataRecord.language),
        };
        return [
            `Book ID: ${input.bookId}`,
            `Chapter ID: ${input.chapterId}`,
            `Chapter Title: ${input.chapterTitle ?? ''}`,
            `Chapter Content Hash: ${input.chapterContentHash}`,
            `Prompt Version: ${PROMPT_VERSION}`,
            '',
            'Stable book metadata:',
            '```json',
            JSON.stringify(stableBookMetadata, null, 2),
            '```',
            '',
            'Canonical chapter text:',
            '```text',
            input.chapterText,
            '```',
            '',
            'Fixed quiz rules:',
            '- The canonical chapter text is background context for the chapter.',
            '- Each generated question must still be grounded in exactly one source knowledge unit supplied in the request suffix.',
            '- Do not introduce facts that cannot be supported by the source units and the anchor page window.',
        ].join('\n');
    }
    buildUnitsSuffixPrompt(input) {
        const sections = [
            `Book ID: ${input.bookId}`,
            `Chapter ID: ${input.chapterId}`,
            `Chapter Title: ${input.chapterTitle ?? ''}`,
            `Prompt Version: ${PROMPT_VERSION}`,
            '',
            'Book context:',
            '```json',
            JSON.stringify(input.bookContext ?? { bookId: input.bookId }, null, 2),
            '```',
            '',
            'Current chapter context:',
            '```json',
            JSON.stringify(input.chapterContext ?? { chapterId: input.chapterId }, null, 2),
            '```',
            '',
            'Current chapter summary:',
            '```text',
            input.chapterSummary,
            '```',
            '',
            'Page window:',
            '```json',
            JSON.stringify(input.pageWindow, null, 2),
            '```',
            '',
            'Source knowledge units:',
            '```json',
            JSON.stringify(input.units, null, 2),
            '```',
            '',
            `Generate exactly ${input.units.length} questions, in the same order as the source knowledge units.`,
            'Generate exactly one question for each source knowledge unit, preserving both order and targetQuestionType.',
            'Each question must be grounded in exactly one source knowledge unit.',
            'Use the cached chapter prefix, chapter summary, and page window only as supporting context; do not introduce facts outside the source units and page window.',
            'Each question must preserve the sourceUnitId, sourceUnitType, and sourcePageRefs for its matching source unit.',
            'For fill_in_blank questions, return exactly 4 options and a correctAnswerIndex between 0 and 3.',
            'For fill_in_blank questions, the question text must contain exactly one blank written as ____ or otherwise explicitly tell the learner to choose the best word or phrase for the blank.',
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
    coerceQuizQuestions(value, sourceUnits) {
        if (!isPlainObject(value) || !Array.isArray(value.questions))
            return [];
        const questions = value.questions
            .map((question, index) => this.coerceQuizQuestion(question, index, sourceUnits[index]))
            .filter((question) => question !== null);
        const unique = new Map();
        for (const question of questions) {
            if (!unique.has(question.id)) {
                unique.set(question.id, question);
            }
        }
        return Array.from(unique.values());
    }
    coerceQuizQuestion(value, index, sourceUnit) {
        if (!isPlainObject(value))
            return null;
        const question = asString(value.question);
        const explanation = asString(value.explanation);
        if (!question || !explanation)
            return null;
        const type = this.normalizeQuestionType(asString(value.type), sourceUnit?.targetQuestionType);
        const baseQuestion = {
            id: asString(value.id) ?? sourceUnit?.unitId ?? `q${index + 1}`,
            type,
            question,
            explanation,
            skill: this.normalizeSkill(asString(value.skill)),
            sourceUnitId: sourceUnit?.unitId,
            sourceUnitType: sourceUnit?.type,
            sourcePageRefs: sourceUnit?.sourcePageRefs,
        };
        if (type === 'multiple_choice') {
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
            return {
                ...baseQuestion,
                type,
                options: [options[0], options[1], options[2], options[3]],
                correctAnswerIndex,
            };
        }
        if (type === 'true_false_not_given') {
            const correctAnswerIndex = asNumber(value.correctAnswerIndex);
            if (correctAnswerIndex !== 0 && correctAnswerIndex !== 1 && correctAnswerIndex !== 2)
                return null;
            return {
                ...baseQuestion,
                type,
                options: ['True', 'False', 'Not Given'],
                correctAnswerIndex,
            };
        }
        if (type === 'fill_in_blank') {
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
            if (!hasBlankSemantics(question))
                return null;
            const acceptableAnswersRaw = value.acceptableAnswers === undefined
                ? undefined
                : this.coerceAcceptableAnswers(value.acceptableAnswers);
            const acceptableAnswers = acceptableAnswersRaw ?? undefined;
            return {
                ...baseQuestion,
                type,
                options: [options[0], options[1], options[2], options[3]],
                correctAnswerIndex,
                blankHint: asString(value.blankHint),
                acceptableAnswers,
            };
        }
        const acceptableAnswers = this.coerceAcceptableAnswers(value.acceptableAnswers);
        if (!acceptableAnswers)
            return null;
        return {
            ...baseQuestion,
            type,
            acceptableAnswers,
            answerGuidance: asString(value.answerGuidance),
        };
    }
    normalizeQuestionType(value, fallback) {
        switch (value) {
            case 'multiple_choice':
            case 'true_false_not_given':
            case 'short_answer':
            case 'fill_in_blank':
                return value;
            default:
                return fallback ?? 'multiple_choice';
        }
    }
    coerceAcceptableAnswers(value) {
        if (!Array.isArray(value))
            return null;
        const answers = value
            .map(asString)
            .filter((entry) => typeof entry === 'string');
        if (answers.length === 0)
            return null;
        const unique = Array.from(new Set(answers));
        return [unique[0], ...unique.slice(1)];
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
    deriveKnowledgeUnits(knowledge) {
        const relationCountByNodeId = new Map();
        const relationHintsByNodeId = new Map();
        for (const relation of knowledge.relations) {
            relationCountByNodeId.set(relation.from_id, (relationCountByNodeId.get(relation.from_id) ?? 0) + 1);
            relationCountByNodeId.set(relation.to_id, (relationCountByNodeId.get(relation.to_id) ?? 0) + 1);
            this.addRelationHint(relationHintsByNodeId, relation.from_id, `${relation.relation_type}:${relation.to_type}:${relation.to_id}`);
            this.addRelationHint(relationHintsByNodeId, relation.to_id, `${relation.relation_type}:${relation.from_type}:${relation.from_id}`);
        }
        const units = [];
        for (const idea of knowledge.ideas) {
            const unit = this.toKnowledgeUnit('idea', idea.local_id, idea.label, idea.description, idea.evidence, 'Argument', undefined, relationHintsByNodeId.get(idea.local_id));
            if (unit)
                units.push(unit);
        }
        for (const event of knowledge.events) {
            const unit = this.toKnowledgeUnit('event', event.local_id, event.label, event.description, event.evidence, 'Inference', undefined, relationHintsByNodeId.get(event.local_id));
            if (unit)
                units.push(unit);
        }
        for (const theme of knowledge.themes) {
            const unit = this.toKnowledgeUnit('theme', theme.local_id, theme.label, theme.description, theme.evidence, 'Tone', undefined, relationHintsByNodeId.get(theme.local_id));
            if (unit)
                units.push(unit);
        }
        for (const person of knowledge.people) {
            const evidenceCount = person.evidence?.length ?? 0;
            const relationCount = relationCountByNodeId.get(person.local_id) ?? 0;
            if (evidenceCount < 2 && relationCount < 1)
                continue;
            const unit = this.toKnowledgeUnit('person', person.local_id, person.name, person.description, person.evidence, 'Facts', person.aliases, relationHintsByNodeId.get(person.local_id));
            if (unit)
                units.push(unit);
        }
        for (const entity of knowledge.entities) {
            const evidenceCount = entity.evidence?.length ?? 0;
            const relationCount = relationCountByNodeId.get(entity.local_id) ?? 0;
            if (evidenceCount < 2 && relationCount < 1)
                continue;
            const unit = this.toKnowledgeUnit('entity', entity.local_id, entity.label, entity.description, entity.evidence, 'Facts', undefined, relationHintsByNodeId.get(entity.local_id));
            if (unit)
                units.push(unit);
        }
        return units.sort((left, right) => {
            const priorityDelta = this.unitPriority(left.type) - this.unitPriority(right.type);
            if (priorityDelta !== 0)
                return priorityDelta;
            const pageDelta = left.anchorPageIndex - right.anchorPageIndex;
            if (pageDelta !== 0)
                return pageDelta;
            return left.unitId.localeCompare(right.unitId);
        });
    }
    selectKnowledgeUnits(units) {
        const targetCount = units.length < 3 ? units.length : Math.min(5, units.length);
        return units.slice(0, targetCount);
    }
    planQuestionUnits(units) {
        return units.map((unit) => ({
            ...unit,
            targetQuestionType: this.selectQuestionType(unit),
        }));
    }
    selectQuestionType(unit) {
        switch (unit.type) {
            case 'idea':
                return 'short_answer';
            case 'event':
                return 'true_false_not_given';
            case 'theme':
                return 'multiple_choice';
            case 'person':
            case 'entity':
                return 'fill_in_blank';
        }
    }
    groupUnitsByAnchorPage(units) {
        const groups = new Map();
        for (const unit of units) {
            const existing = groups.get(unit.anchorPageIndex);
            if (existing) {
                existing.push(unit);
            }
            else {
                groups.set(unit.anchorPageIndex, [unit]);
            }
        }
        return groups;
    }
    toKnowledgeUnit(type, unitId, label, description, evidence, skill, aliases, relationHints) {
        const sourcePageRefs = this.toSourcePageRefs(evidence);
        if (sourcePageRefs.length === 0)
            return null;
        const anchorPage = sourcePageRefs[0];
        return {
            unitId,
            type,
            label,
            description,
            skill,
            anchorPageIndex: anchorPage.pageIndex,
            anchorPageNumber: anchorPage.pageNumber ?? (anchorPage.pageIndex + 1),
            sourcePageRefs,
            aliases,
            relationHints: relationHints ? Array.from(new Set(relationHints)).sort((left, right) => left.localeCompare(right)) : undefined,
        };
    }
    toSourcePageRefs(evidence) {
        if (!evidence || evidence.length === 0)
            return [];
        const unique = new Map();
        for (const item of evidence) {
            if (item.pageIndex === undefined)
                continue;
            const key = `${item.pageIndex}:${item.pageNumber ?? item.pageIndex + 1}`;
            if (!unique.has(key)) {
                unique.set(key, {
                    pageIndex: item.pageIndex,
                    pageNumber: item.pageNumber,
                });
            }
        }
        return Array.from(unique.values()).sort((left, right) => left.pageIndex - right.pageIndex);
    }
    addRelationHint(target, nodeId, hint) {
        const existing = target.get(nodeId);
        if (existing) {
            existing.push(hint);
        }
        else {
            target.set(nodeId, [hint]);
        }
    }
    unitPriority(type) {
        switch (type) {
            case 'idea':
                return 0;
            case 'event':
                return 1;
            case 'theme':
                return 2;
            case 'person':
                return 3;
            case 'entity':
                return 4;
        }
    }
    findMatchingKnowledgeExtractionResult(bookId, chapterId, snapshotVersion, chapterContentHash) {
        const latestResult = this.knowledgeExtractionWorkflowRepository.getLatestResult(bookId, chapterId);
        if (!latestResult)
            return null;
        if (snapshotVersion !== undefined && latestResult.snapshotVersion !== snapshotVersion)
            return null;
        if (chapterContentHash !== undefined && latestResult.chapterContentHash !== chapterContentHash)
            return null;
        return latestResult;
    }
    requireMatchingKnowledgeExtractionResult(bookId, chapterId, snapshotVersion, chapterContentHash) {
        if (this.findMatchingKnowledgeExtractionResult(bookId, chapterId, snapshotVersion, chapterContentHash)) {
            return;
        }
        throw new common_1.ConflictException('Matching completed knowledge extraction result is required before quiz generation');
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
    __param(1, (0, common_1.Inject)(book_context_service_1.BookContextService)),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository))),
    __param(3, (0, common_1.Inject)(quiz_workflow_repository_1.QuizWorkflowRepository)),
    __param(4, (0, common_1.Inject)(workflow_queue_service_1.WorkflowQueueService)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        book_context_service_1.BookContextService,
        knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository,
        quiz_workflow_repository_1.QuizWorkflowRepository,
        workflow_queue_service_1.WorkflowQueueService])
], QuizWorkflowService);
//# sourceMappingURL=quiz-workflow.service.js.map