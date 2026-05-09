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
exports.BookContextService = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_repository_1 = require("./book-ingestion.repository");
const knowledge_extraction_workflow_repository_1 = require("../knowledge-extraction-workflow/knowledge-extraction-workflow.repository");
const asOptionalTrimmedString = (value) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
let BookContextService = class BookContextService {
    repository;
    knowledgeExtractionWorkflowRepository;
    constructor(repository, knowledgeExtractionWorkflowRepository) {
        this.repository = repository;
        this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
    }
    buildBookContextBundle(bookId, currentChapterId) {
        const book = this.repository.getBook(bookId);
        const currentChapter = this.repository.getChapter(bookId, currentChapterId);
        if (!book || !currentChapter)
            return null;
        const sortedChapters = Array.from(book.chapters.values()).sort((left, right) => {
            const delta = left.chapterIndex - right.chapterIndex;
            if (delta !== 0)
                return delta;
            return left.chapterId.localeCompare(right.chapterId);
        });
        const metadata = book.bookMetadata ?? {};
        const chapters = sortedChapters.map((chapter) => ({
            chapterId: chapter.chapterId,
            chapterIndex: chapter.chapterIndex,
            title: chapter.chapterTitle,
        }));
        const priorChapterSummaries = sortedChapters
            .filter((chapter) => this.isBeforeCurrentChapter(chapter.chapterIndex, chapter.chapterId, currentChapter))
            .map((chapter) => {
            const summary = this.knowledgeExtractionWorkflowRepository
                ?.getLatestResult(bookId, chapter.chapterId)
                ?.result.summary
                ?.trim();
            if (!summary)
                return null;
            return {
                chapterId: chapter.chapterId,
                chapterIndex: chapter.chapterIndex,
                title: chapter.chapterTitle,
                summary,
            };
        })
            .filter((entry) => entry !== null);
        return {
            bookId,
            snapshotVersion: book.snapshotVersion,
            title: asOptionalTrimmedString(metadata.title),
            author: asOptionalTrimmedString(metadata.author),
            language: asOptionalTrimmedString(metadata.language),
            chapters,
            priorChapterSummaries,
            currentChapterPages: this.toChapterPageRefs(bookId, currentChapterId),
        };
    }
    buildChapterContextBundle(bookId, chapterId) {
        const chapter = this.repository.getChapter(bookId, chapterId);
        if (!chapter)
            return null;
        const chapterSummary = this.knowledgeExtractionWorkflowRepository
            ?.getLatestResult(bookId, chapterId)
            ?.result.summary
            ?.trim();
        return {
            chapterId,
            chapterIndex: chapter.chapterIndex,
            chapterTitle: chapter.chapterTitle,
            chapterSummary: chapterSummary || undefined,
            pages: this.toChapterPageRefs(bookId, chapterId),
        };
    }
    buildPageWindowContext(bookId, chapterId, pageIndex) {
        const chapter = this.repository.getChapter(bookId, chapterId);
        const currentPage = this.repository.getPage(bookId, chapterId, pageIndex);
        if (!chapter || !currentPage)
            return null;
        const previousPage = this.repository.getPage(bookId, chapterId, pageIndex - 1);
        const nextPage = this.repository.getPage(bookId, chapterId, pageIndex + 1);
        return {
            radius: 1,
            previous: previousPage ? this.toPageWindowEntry(pageIndex - 1, previousPage.sourceHash, previousPage.pageTextMaterialized) : undefined,
            current: this.toPageWindowEntry(pageIndex, currentPage.sourceHash, currentPage.pageTextMaterialized),
            next: nextPage ? this.toPageWindowEntry(pageIndex + 1, nextPage.sourceHash, nextPage.pageTextMaterialized) : undefined,
        };
    }
    toChapterPageRefs(bookId, chapterId) {
        const chapter = this.repository.getChapter(bookId, chapterId);
        if (!chapter)
            return [];
        return Array.from(chapter.pages.values())
            .sort((left, right) => left.pageIndex - right.pageIndex)
            .map((page) => ({
            pageIndex: page.pageIndex,
            pageNumber: page.pageIndex + 1,
            sourceHash: page.sourceHash,
        }));
    }
    toPageWindowEntry(pageIndex, sourceHash, text) {
        return {
            pageIndex,
            pageNumber: pageIndex + 1,
            sourceHash,
            text,
        };
    }
    isBeforeCurrentChapter(chapterIndex, chapterId, currentChapter) {
        if (chapterIndex !== currentChapter.chapterIndex) {
            return chapterIndex < currentChapter.chapterIndex;
        }
        return chapterId.localeCompare(currentChapter.chapterId) < 0;
    }
};
exports.BookContextService = BookContextService;
exports.BookContextService = BookContextService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(book_ingestion_repository_1.BookIngestionRepository)),
    __param(1, (0, common_1.Optional)()),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository))),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository])
], BookContextService);
//# sourceMappingURL=book-context.service.js.map