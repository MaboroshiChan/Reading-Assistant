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
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const llmService_1 = require("../../../services/llmService");
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const knowledge_extraction_workflow_repository_1 = require("./knowledge-extraction-workflow.repository");
const PROMPT_VERSION = 'knowledge_extraction.v2.0';
const PROMPT_PATH = node_path_1.default.join(__dirname, '..', '..', '..', '..', 'prompts', 'v1', 'knowledge_extraction.txt');
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
let cachedSystemPrompt = null;
let KnowledgeExtractionWorkflowService = class KnowledgeExtractionWorkflowService {
    bookIngestionRepository;
    knowledgeExtractionWorkflowRepository;
    constructor(bookIngestionRepository, knowledgeExtractionWorkflowRepository) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
    }
    parseSubmitRequest(rawBody) {
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
        const workflowVersion = parsed.workflowVersion === undefined
            ? 'v1'
            : this.requireString(parsed.workflowVersion, 'workflowVersion');
        return {
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
        const { run, deduped } = this.knowledgeExtractionWorkflowRepository.createOrReuseRun(input);
        if (!deduped) {
            void this.executeRun(run.id);
        }
        const canonicalRun = deduped
            ? this.knowledgeExtractionWorkflowRepository.getRun(run.id) ?? run
            : run;
        return this.toSubmitResponse(canonicalRun, deduped);
    }
    getWorkflowStatus(workflowRunId) {
        const run = this.requireRun(workflowRunId);
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
            throw new common_1.NotFoundException('No completed knowledge extraction workflow result found for chapter');
        }
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
        try {
            const result = await this.generateKnowledgeExtraction({
                bookId: runningRun.bookId,
                chapterId: runningRun.chapterId,
                chapterTitle: chapter.chapterTitle,
                chapterText: chapter.chapterTextMaterialized,
            });
            this.knowledgeExtractionWorkflowRepository.completeRun({
                workflowRunId,
                snapshotVersion: book.snapshotVersion,
                chapterContentHash: chapter.chapterContentHash,
                result,
            });
        }
        catch (error) {
            this.knowledgeExtractionWorkflowRepository.failRun(workflowRunId, 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    async generateKnowledgeExtraction(input) {
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
        try {
            const parsed = (0, llmService_1.extractJsonFromText)(text);
            return this.sanitizeKnowledgeExtraction(parsed, input);
        }
        catch {
            return this.buildFallbackKnowledge(input);
        }
    }
    buildPrompt(input) {
        const sections = [
            `Document ID: ${input.bookId}`,
            `Chapter ID: ${input.chapterId}`,
            `Chapter Title: ${input.chapterTitle ?? ''}`,
            'Chunk ID: ',
            'Chunk Index: ',
            'Total Chunks: ',
            `Prompt Version: ${PROMPT_VERSION}`,
            '',
            'Memory context:',
            '```text',
            '',
            '```',
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
        if (cachedSystemPrompt)
            return cachedSystemPrompt;
        cachedSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
        return cachedSystemPrompt;
    }
    buildFallbackKnowledge(input) {
        return {
            title: input.chapterTitle ?? `Chapter ${input.chapterId}`,
            summary: this.summarize(input.chapterText, 240),
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
            people: this.sanitizePeople(record.people) ?? [],
            ideas: this.sanitizeIdeas(record.ideas) ?? [],
            events: this.sanitizeEvents(record.events) ?? [],
            entities: this.sanitizeEntities(record.entities) ?? [],
            themes: this.sanitizeThemes(record.themes) ?? [],
            relations: this.sanitizeRelations(record.relations) ?? [],
        };
    }
    sanitizeStringArray(value) {
        if (!Array.isArray(value))
            return undefined;
        const items = value.map(asString).filter((item) => Boolean(item));
        return items.length ? items : undefined;
    }
    sanitizeEvidence(value) {
        if (!Array.isArray(value))
            return undefined;
        const evidence = value
            .map((item) => {
            if (!isPlainObject(item))
                return null;
            const quote = asString(item.quote);
            return quote ? { quote } : null;
        })
            .filter((item) => item !== null);
        return evidence.length ? evidence : undefined;
    }
    sanitizePeople(value) {
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
                evidence: this.sanitizeEvidence(item.evidence),
            };
        })
            .filter((item) => item !== null);
        return people.length ? people : undefined;
    }
    sanitizeIdeas(value) {
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
            return {
                local_id: asString(item.local_id) ?? `i${index + 1}`,
                label,
                description: asString(item.description),
                kind: kind && IDEA_KINDS.has(kind) ? kind : 'claim',
                evidence: this.sanitizeEvidence(item.evidence),
            };
        })
            .filter((item) => item !== null);
        return ideas.length ? ideas : undefined;
    }
    sanitizeEvents(value) {
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
                evidence: this.sanitizeEvidence(item.evidence),
            };
        })
            .filter((item) => item !== null);
        return events.length ? events : undefined;
    }
    sanitizeEntities(value) {
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
                evidence: this.sanitizeEvidence(item.evidence),
            };
        })
            .filter((item) => item !== null);
        return entities.length ? entities : undefined;
    }
    sanitizeThemes(value) {
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
                evidence: this.sanitizeEvidence(item.evidence),
            };
        })
            .filter((item) => item !== null);
        return themes.length ? themes : undefined;
    }
    sanitizeRelations(value) {
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
                evidence: this.sanitizeEvidence(item.evidence),
            };
        })
            .filter((item) => item !== null);
        return relations.length ? relations : undefined;
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
    __param(1, (0, common_1.Inject)(knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository])
], KnowledgeExtractionWorkflowService);
//# sourceMappingURL=knowledge-extraction-workflow.service.js.map