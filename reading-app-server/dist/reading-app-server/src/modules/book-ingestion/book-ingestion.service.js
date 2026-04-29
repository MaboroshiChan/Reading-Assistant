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
exports.BookIngestionService = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_logger_1 = require("./book-ingestion.logger");
const book_ingestion_repository_1 = require("./book-ingestion.repository");
const runtime_config_1 = require("../../config/runtime-config");
const knowledge_extraction_workflow_repository_1 = require("../knowledge-extraction-workflow/knowledge-extraction-workflow.repository");
const knowledge_extraction_workflow_service_1 = require("../knowledge-extraction-workflow/knowledge-extraction-workflow.service");
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const coerceNonNegativeInteger = (value, fieldName) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new common_1.BadRequestException(`${fieldName} must be a non-negative integer`);
    }
    return value;
};
let BookIngestionService = class BookIngestionService {
    repository;
    knowledgeExtractionWorkflowService;
    knowledgeExtractionWorkflowRepository;
    constructor(repository, knowledgeExtractionWorkflowService, knowledgeExtractionWorkflowRepository) {
        this.repository = repository;
        this.knowledgeExtractionWorkflowService = knowledgeExtractionWorkflowService;
        this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
    }
    parseUpsertRequest(rawBody, params) {
        if (!rawBody || rawBody.trim() === '') {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'empty_body',
                bookId: params.bookId,
                chapterId: params.chapterId,
                pageIndex: params.pageIndex,
            });
            throw new common_1.BadRequestException('Request body cannot be empty');
        }
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch (error) {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'invalid_json',
                bookId: params.bookId,
                chapterId: params.chapterId,
                pageIndex: params.pageIndex,
                error: error instanceof Error ? error.message : String(error),
            });
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed)) {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'non_object_body',
                bookId: params.bookId,
                chapterId: params.chapterId,
                pageIndex: params.pageIndex,
            });
            throw new common_1.BadRequestException('Request body must be a JSON object');
        }
        const bookId = this.requireString(parsed.bookId, 'bookId');
        const chapterId = this.requireString(parsed.chapterId, 'chapterId');
        const sourceHash = this.requireString(parsed.sourceHash, 'sourceHash');
        const chapterIndex = coerceNonNegativeInteger(parsed.chapterIndex, 'chapterIndex');
        const pageIndex = coerceNonNegativeInteger(parsed.pageIndex, 'pageIndex');
        if (params.bookId !== bookId) {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'book_id_mismatch',
                pathBookId: params.bookId,
                bodyBookId: bookId,
                chapterId,
                pageIndex,
            });
            throw new common_1.BadRequestException('Path bookId does not match body bookId');
        }
        if (params.chapterId !== chapterId) {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'chapter_id_mismatch',
                bookId,
                pathChapterId: params.chapterId,
                bodyChapterId: chapterId,
                pageIndex,
            });
            throw new common_1.BadRequestException('Path chapterId does not match body chapterId');
        }
        if (params.pageIndex !== pageIndex) {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'page_index_mismatch',
                bookId,
                chapterId,
                pathPageIndex: params.pageIndex,
                bodyPageIndex: pageIndex,
            });
            throw new common_1.BadRequestException('Path pageIndex does not match body pageIndex');
        }
        if (!isPlainObject(parsed.pageParagraphs) || Object.keys(parsed.pageParagraphs).length === 0) {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'invalid_page_paragraphs',
                bookId,
                chapterId,
                pageIndex,
            });
            throw new common_1.BadRequestException('pageParagraphs must be a non-empty object');
        }
        const pageParagraphs = Object.fromEntries(Object.entries(parsed.pageParagraphs).map(([key, value]) => {
            if (!isNonEmptyString(value)) {
                throw new common_1.BadRequestException(`pageParagraphs.${key} must be a non-empty string`);
            }
            return [key, value];
        }));
        let bookMetadata;
        if (parsed.bookMetadata !== undefined) {
            if (!isPlainObject(parsed.bookMetadata)) {
                throw new common_1.BadRequestException('bookMetadata must be a JSON object when provided');
            }
            bookMetadata = { ...parsed.bookMetadata };
        }
        const chapterTitle = parsed.chapterTitle === undefined
            ? undefined
            : this.requireOptionalString(parsed.chapterTitle, 'chapterTitle');
        (0, book_ingestion_logger_1.bookIngestionLog)('request.parsed', {
            bookId,
            chapterId,
            chapterIndex,
            chapterTitle,
            pageIndex,
            sourceHash,
            paragraphCount: Object.keys(pageParagraphs).length,
            hasBookMetadata: bookMetadata !== undefined,
        });
        return {
            bookId,
            chapterId,
            chapterIndex,
            chapterTitle,
            pageIndex,
            sourceHash,
            pageParagraphs,
            bookMetadata,
        };
    }
    upsertPageFragment(input) {
        const result = this.repository.upsertPageFragment(input);
        const chapterTextAvailable = result.chapter.chapterTextMaterialized.trim().length > 0;
        (0, book_ingestion_logger_1.bookIngestionLog)('page.upsert_completed', {
            bookId: result.book.bookId,
            chapterId: result.chapter.chapterId,
            chapterIndex: result.chapter.chapterIndex,
            pageIndex: result.page.pageIndex,
            sourceHash: result.page.sourceHash,
            deduped: result.deduped,
            snapshotVersion: result.book.snapshotVersion,
            pageCountInChapter: result.chapter.pages.size,
            chapterContentHash: result.chapter.chapterContentHash,
            chapterTextAvailable,
            pageTextLength: result.page.pageTextMaterialized.length,
        });
        if (runtime_config_1.config.autoSubmitKnowledgeExtractionWorkflow
            && !result.deduped
            && chapterTextAvailable
            && this.knowledgeExtractionWorkflowService) {
            void this.submitKnowledgeExtractionWorkflowAfterIngestion(result);
        }
        return {
            bookId: result.book.bookId,
            chapterId: result.chapter.chapterId,
            chapterIndex: result.chapter.chapterIndex,
            pageIndex: result.page.pageIndex,
            sourceHash: result.page.sourceHash,
            deduped: result.deduped,
            snapshotVersion: result.book.snapshotVersion,
            chapterContentHash: result.chapter.chapterContentHash,
            pageCountInChapter: result.chapter.pages.size,
            chapterTextAvailable,
        };
    }
    async submitKnowledgeExtractionWorkflowAfterIngestion(result) {
        try {
            const response = this.knowledgeExtractionWorkflowService?.submitKnowledgeExtractionWorkflow({
                bookId: result.book.bookId,
                chapterId: result.chapter.chapterId,
                chapterIndex: result.chapter.chapterIndex,
                workflowVersion: 'v1',
                expectedSnapshotVersion: result.book.snapshotVersion,
                expectedChapterContentHash: result.chapter.chapterContentHash,
            });
            (0, book_ingestion_logger_1.bookIngestionLog)('knowledge_extraction_workflow.auto_submitted', {
                bookId: result.book.bookId,
                chapterId: result.chapter.chapterId,
                chapterIndex: result.chapter.chapterIndex,
                pageIndex: result.page.pageIndex,
                snapshotVersion: result.book.snapshotVersion,
                chapterContentHash: result.chapter.chapterContentHash,
                workflowRunId: response?.workflowRunId,
                deduped: response?.deduped,
            });
        }
        catch (error) {
            (0, book_ingestion_logger_1.bookIngestionLog)('knowledge_extraction_workflow.auto_submit_failed', {
                bookId: result.book.bookId,
                chapterId: result.chapter.chapterId,
                chapterIndex: result.chapter.chapterIndex,
                pageIndex: result.page.pageIndex,
                snapshotVersion: result.book.snapshotVersion,
                chapterContentHash: result.chapter.chapterContentHash,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    getChapter(bookId, chapterId) {
        const chapter = this.repository.getChapter(bookId, chapterId);
        const book = this.repository.getBook(bookId);
        if (!chapter || !book) {
            (0, book_ingestion_logger_1.bookIngestionLog)('chapter.read_miss', {
                bookId,
                chapterId,
            });
            throw new common_1.NotFoundException('Chapter not found');
        }
        (0, book_ingestion_logger_1.bookIngestionLog)('chapter.read_hit', {
            bookId,
            chapterId,
            chapterIndex: chapter.chapterIndex,
            snapshotVersion: book.snapshotVersion,
            pageCount: chapter.pages.size,
            chapterContentHash: chapter.chapterContentHash,
        });
        return {
            bookId,
            chapterId,
            chapterIndex: chapter.chapterIndex,
            chapterTitle: chapter.chapterTitle,
            snapshotVersion: book.snapshotVersion,
            pageCount: chapter.pages.size,
            chapterContentHash: chapter.chapterContentHash,
            chapterTextAvailable: chapter.chapterTextMaterialized.trim().length > 0,
            updatedAt: chapter.updatedAt,
        };
    }
    getPage(bookId, chapterId, pageIndex) {
        const chapter = this.repository.getChapter(bookId, chapterId);
        const page = this.repository.getPage(bookId, chapterId, pageIndex);
        const book = this.repository.getBook(bookId);
        if (!chapter || !page || !book) {
            (0, book_ingestion_logger_1.bookIngestionLog)('page.read_miss', {
                bookId,
                chapterId,
                pageIndex,
            });
            throw new common_1.NotFoundException('Page not found');
        }
        (0, book_ingestion_logger_1.bookIngestionLog)('page.read_hit', {
            bookId,
            chapterId,
            chapterIndex: chapter.chapterIndex,
            pageIndex,
            sourceHash: page.sourceHash,
            snapshotVersion: book.snapshotVersion,
            paragraphCount: Object.keys(page.pageParagraphs).length,
        });
        return {
            bookId,
            chapterId,
            chapterIndex: chapter.chapterIndex,
            chapterTitle: chapter.chapterTitle,
            pageIndex,
            sourceHash: page.sourceHash,
            pageParagraphs: { ...page.pageParagraphs },
            pageTextMaterialized: page.pageTextMaterialized,
            paragraphHashes: { ...page.paragraphHashes },
            snapshotVersion: book.snapshotVersion,
            updatedAt: page.updatedAt,
        };
    }
    async getBookModel(bookId) {
        const book = this.repository.getBook(bookId);
        if (!book) {
            (0, book_ingestion_logger_1.bookIngestionLog)('book_model.read_miss', { bookId });
            throw new common_1.NotFoundException('Book not found');
        }
        const chapters = Array.from(book.chapters.values())
            .sort((left, right) => {
            const chapterDelta = left.chapterIndex - right.chapterIndex;
            if (chapterDelta !== 0)
                return chapterDelta;
            return left.chapterId.localeCompare(right.chapterId);
        });
        const chapterSnapshots = await Promise.all(chapters.map(async (chapter) => {
            const snapshot = this.knowledgeExtractionWorkflowRepository
                ? await this.knowledgeExtractionWorkflowRepository.buildChapterSnapshot(bookId, chapter.chapterId)
                : {
                    title: chapter.chapterTitle ?? `Chapter ${chapter.chapterIndex}`,
                    summary: '',
                    people: [],
                    ideas: [],
                    events: [],
                    entities: [],
                    themes: [],
                    relations: [],
                };
            return {
                chapterId: chapter.chapterId,
                chapterIndex: chapter.chapterIndex,
                snapshotVersion: book.snapshotVersion,
                chapterContentHash: chapter.chapterContentHash,
                title: chapter.chapterTitle ?? snapshot.title,
                summary: snapshot.summary || undefined,
                people: snapshot.people.map((person) => ({
                    localId: person.local_id,
                    name: person.name,
                    aliases: person.aliases ?? [],
                    description: person.description,
                    roles: person.roles ?? [],
                    traits: person.traits ?? [],
                    evidence: (person.evidence ?? []).map((evidence) => ({
                        chapterIndex: chapter.chapterIndex,
                        chapterId: chapter.chapterId,
                        pageIndex: evidence.pageIndex,
                        pageNumber: evidence.pageNumber,
                        quote: evidence.quote,
                    })),
                })),
                ideas: snapshot.ideas.map((idea) => ({
                    localId: idea.local_id,
                    label: idea.label,
                    description: idea.description,
                    kind: idea.kind,
                    evidence: (idea.evidence ?? []).map((evidence) => ({
                        chapterIndex: chapter.chapterIndex,
                        chapterId: chapter.chapterId,
                        pageIndex: evidence.pageIndex,
                        pageNumber: evidence.pageNumber,
                        quote: evidence.quote,
                    })),
                })),
                events: snapshot.events.map((event) => ({
                    localId: event.local_id,
                    label: event.label,
                    description: event.description,
                    participantLocalIds: event.participant_local_ids ?? [],
                    timeHint: event.time_hint,
                    placeHint: event.place_hint,
                    evidence: (event.evidence ?? []).map((evidence) => ({
                        chapterIndex: chapter.chapterIndex,
                        chapterId: chapter.chapterId,
                        pageIndex: evidence.pageIndex,
                        pageNumber: evidence.pageNumber,
                        quote: evidence.quote,
                    })),
                })),
                entities: snapshot.entities.map((entity) => ({
                    localId: entity.local_id,
                    label: entity.label,
                    type: entity.type,
                    description: entity.description,
                    evidence: (entity.evidence ?? []).map((evidence) => ({
                        chapterIndex: chapter.chapterIndex,
                        chapterId: chapter.chapterId,
                        pageIndex: evidence.pageIndex,
                        pageNumber: evidence.pageNumber,
                        quote: evidence.quote,
                    })),
                })),
                themes: snapshot.themes.map((theme) => ({
                    localId: theme.local_id,
                    label: theme.label,
                    strength: theme.strength,
                    description: theme.description,
                    evidence: (theme.evidence ?? []).map((evidence) => ({
                        chapterIndex: chapter.chapterIndex,
                        chapterId: chapter.chapterId,
                        pageIndex: evidence.pageIndex,
                        pageNumber: evidence.pageNumber,
                        quote: evidence.quote,
                    })),
                })),
                relations: snapshot.relations.map((relation) => ({
                    localId: relation.local_id,
                    fromId: relation.from_id,
                    fromType: relation.from_type,
                    toId: relation.to_id,
                    toType: relation.to_type,
                    relationType: relation.relation_type,
                    description: relation.description,
                    confidence: relation.confidence,
                    evidence: (relation.evidence ?? []).map((evidence) => ({
                        chapterIndex: chapter.chapterIndex,
                        chapterId: chapter.chapterId,
                        pageIndex: evidence.pageIndex,
                        pageNumber: evidence.pageNumber,
                        quote: evidence.quote,
                    })),
                })),
                createdAt: chapter.createdAt,
            };
        }));
        const keyInformation = this.knowledgeExtractionWorkflowRepository?.buildBookKeyInformation(bookId) ?? {
            people: [],
            ideas: [],
            events: [],
            entities: [],
            themes: [],
            relations: [],
            arcs: [],
            ideaFlows: [],
            links: [],
        };
        const metadata = book.bookMetadata ?? {};
        const title = typeof metadata.title === 'string' && metadata.title.trim()
            ? metadata.title.trim()
            : undefined;
        const author = typeof metadata.author === 'string' && metadata.author.trim()
            ? metadata.author.trim()
            : undefined;
        const language = typeof metadata.language === 'string' && metadata.language.trim()
            ? metadata.language.trim()
            : undefined;
        (0, book_ingestion_logger_1.bookIngestionLog)('book_model.read_hit', {
            bookId,
            snapshotVersion: book.snapshotVersion,
            chapterCount: chapterSnapshots.length,
            globalPeopleCount: keyInformation.people.length,
            globalIdeaCount: keyInformation.ideas.length,
            globalEventCount: keyInformation.events.length,
            globalEntityCount: keyInformation.entities.length,
            globalThemeCount: keyInformation.themes.length,
            globalRelationCount: keyInformation.relations.length,
        });
        return {
            bookId,
            meta: {
                title,
                author,
                language,
                totalChapters: chapterSnapshots.length,
                createdAt: book.createdAt,
                updatedAt: book.updatedAt,
            },
            chapters: chapterSnapshots,
            keyInformation,
        };
    }
    parsePageIndex(rawPageIndex) {
        const parsed = Number(rawPageIndex);
        if (!Number.isInteger(parsed) || parsed < 0) {
            (0, book_ingestion_logger_1.bookIngestionLog)('request.parse_failed', {
                reason: 'invalid_page_index_param',
                rawPageIndex,
            });
            throw new common_1.BadRequestException('pageIndex must be a non-negative integer');
        }
        return parsed;
    }
    requireString(value, fieldName) {
        if (!isNonEmptyString(value)) {
            throw new common_1.BadRequestException(`${fieldName} must be a non-empty string`);
        }
        return value.trim();
    }
    requireOptionalString(value, fieldName) {
        if (!isNonEmptyString(value)) {
            throw new common_1.BadRequestException(`${fieldName} must be a non-empty string when provided`);
        }
        return value.trim();
    }
};
exports.BookIngestionService = BookIngestionService;
exports.BookIngestionService = BookIngestionService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(book_ingestion_repository_1.BookIngestionRepository)),
    __param(1, (0, common_1.Optional)()),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService))),
    __param(2, (0, common_1.Optional)()),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository))),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService,
        knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository])
], BookIngestionService);
//# sourceMappingURL=book-ingestion.service.js.map