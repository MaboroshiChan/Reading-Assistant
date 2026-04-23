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
const book_ingestion_repository_1 = require("./book-ingestion.repository");
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const coerceNonNegativeInteger = (value, fieldName) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new common_1.BadRequestException(`${fieldName} must be a non-negative integer`);
    }
    return value;
};
let BookIngestionService = exports.BookIngestionService = class BookIngestionService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    parseUpsertRequest(rawBody, params) {
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
        const bookId = this.requireString(parsed.bookId, 'bookId');
        const chapterId = this.requireString(parsed.chapterId, 'chapterId');
        const sourceHash = this.requireString(parsed.sourceHash, 'sourceHash');
        const chapterIndex = coerceNonNegativeInteger(parsed.chapterIndex, 'chapterIndex');
        const pageIndex = coerceNonNegativeInteger(parsed.pageIndex, 'pageIndex');
        if (params.bookId !== bookId) {
            throw new common_1.BadRequestException('Path bookId does not match body bookId');
        }
        if (params.chapterId !== chapterId) {
            throw new common_1.BadRequestException('Path chapterId does not match body chapterId');
        }
        if (params.pageIndex !== pageIndex) {
            throw new common_1.BadRequestException('Path pageIndex does not match body pageIndex');
        }
        if (!isPlainObject(parsed.pageParagraphs) || Object.keys(parsed.pageParagraphs).length === 0) {
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
            chapterTextAvailable: result.chapter.chapterTextMaterialized.trim().length > 0,
        };
    }
    getChapter(bookId, chapterId) {
        const chapter = this.repository.getChapter(bookId, chapterId);
        const book = this.repository.getBook(bookId);
        if (!chapter || !book) {
            throw new common_1.NotFoundException('Chapter not found');
        }
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
            throw new common_1.NotFoundException('Page not found');
        }
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
    parsePageIndex(rawPageIndex) {
        const parsed = Number(rawPageIndex);
        if (!Number.isInteger(parsed) || parsed < 0) {
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
exports.BookIngestionService = BookIngestionService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(book_ingestion_repository_1.BookIngestionRepository)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository])
], BookIngestionService);
//# sourceMappingURL=book-ingestion.service.js.map