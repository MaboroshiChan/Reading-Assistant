"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookIngestionRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const hashText = (input) => (0, node_crypto_1.createHash)('sha256').update(input).digest('hex');
const sortParagraphEntries = (pageParagraphs) => {
    return Object.entries(pageParagraphs)
        .sort(([left], [right]) => {
        const leftNum = Number(left);
        const rightNum = Number(right);
        const leftNumeric = Number.isInteger(leftNum) && String(leftNum) === left.trim();
        const rightNumeric = Number.isInteger(rightNum) && String(rightNum) === right.trim();
        if (leftNumeric && rightNumeric)
            return leftNum - rightNum;
        if (leftNumeric)
            return -1;
        if (rightNumeric)
            return 1;
        return left.localeCompare(right);
    })
        .map(([key, value]) => ({ key, value }));
};
let BookIngestionRepository = exports.BookIngestionRepository = class BookIngestionRepository {
    books = new Map();
    upsertPageFragment(input) {
        const currentTimestamp = new Date().toISOString();
        const book = this.getOrCreateBook(input.bookId, currentTimestamp);
        const chapter = this.getOrCreateChapter(book, input, currentTimestamp);
        const existingPage = chapter.pages.get(input.pageIndex);
        if (existingPage && existingPage.sourceHash === input.sourceHash) {
            return {
                book,
                chapter,
                page: existingPage,
                deduped: true,
            };
        }
        const sortedParagraphs = sortParagraphEntries(input.pageParagraphs);
        const pageTextMaterialized = sortedParagraphs.map((entry) => entry.value).join('\n\n');
        const paragraphHashes = Object.fromEntries(sortedParagraphs.map((entry) => [entry.key, hashText(entry.value)]));
        const pageRecord = {
            pageIndex: input.pageIndex,
            sourceHash: input.sourceHash,
            pageParagraphs: { ...input.pageParagraphs },
            pageTextMaterialized,
            paragraphHashes,
            createdAt: existingPage?.createdAt ?? currentTimestamp,
            updatedAt: currentTimestamp,
        };
        chapter.pages.set(input.pageIndex, pageRecord);
        chapter.chapterIndex = input.chapterIndex;
        if (input.chapterTitle !== undefined) {
            chapter.chapterTitle = input.chapterTitle;
        }
        chapter.updatedAt = currentTimestamp;
        if (input.bookMetadata) {
            book.bookMetadata = { ...input.bookMetadata };
        }
        book.snapshotVersion += 1;
        book.updatedAt = currentTimestamp;
        this.materializeChapter(chapter, currentTimestamp);
        return {
            book,
            chapter,
            page: pageRecord,
            deduped: false,
        };
    }
    getChapter(bookId, chapterId) {
        return this.books.get(bookId)?.chapters.get(chapterId) ?? null;
    }
    getPage(bookId, chapterId, pageIndex) {
        return this.getChapter(bookId, chapterId)?.pages.get(pageIndex) ?? null;
    }
    getBook(bookId) {
        return this.books.get(bookId) ?? null;
    }
    getOrCreateBook(bookId, timestamp) {
        const existing = this.books.get(bookId);
        if (existing)
            return existing;
        const created = {
            bookId,
            snapshotVersion: 0,
            updatedAt: timestamp,
            chapters: new Map(),
        };
        this.books.set(bookId, created);
        return created;
    }
    getOrCreateChapter(book, input, timestamp) {
        const existing = book.chapters.get(input.chapterId);
        if (existing)
            return existing;
        const created = {
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            pages: new Map(),
            chapterTextMaterialized: '',
            chapterContentHash: hashText(''),
            updatedAt: timestamp,
        };
        book.chapters.set(input.chapterId, created);
        return created;
    }
    materializeChapter(chapter, timestamp) {
        const chapterTextMaterialized = Array.from(chapter.pages.entries())
            .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
            .map(([, page]) => page.pageTextMaterialized)
            .join('\n\n');
        chapter.chapterTextMaterialized = chapterTextMaterialized;
        chapter.chapterContentHash = hashText(chapterTextMaterialized);
        chapter.updatedAt = timestamp;
    }
};
exports.BookIngestionRepository = BookIngestionRepository = __decorate([
    (0, common_1.Injectable)()
], BookIngestionRepository);
//# sourceMappingURL=book-ingestion.repository.js.map