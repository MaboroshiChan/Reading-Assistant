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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookIngestionRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const book_ingestion_logger_1 = require("./book-ingestion.logger");
const hashText = (input) => (0, node_crypto_1.createHash)('sha256').update(input).digest('hex');
const DEFAULT_DATA_DIR = node_path_1.default.join(__dirname, '..', '..', '..', 'data', 'book-ingestion');
const DEFAULT_STORE_FILE = 'store.json';
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
let BookIngestionRepository = class BookIngestionRepository {
    books = new Map();
    storePath;
    constructor(dataDirOverride) {
        const dataDir = dataDirOverride ?? process.env.BOOK_INGESTION_DATA_DIR ?? DEFAULT_DATA_DIR;
        this.storePath = node_path_1.default.join(dataDir, DEFAULT_STORE_FILE);
        this.loadPersistedStore();
    }
    upsertPageFragment(input) {
        const currentTimestamp = new Date().toISOString();
        const book = this.getOrCreateBook(input.bookId, currentTimestamp);
        const chapter = this.getOrCreateChapter(book, input, currentTimestamp);
        const existingPage = chapter.pages.get(input.pageIndex);
        if (existingPage && existingPage.sourceHash === input.sourceHash) {
            (0, book_ingestion_logger_1.bookIngestionLog)('page.deduped', {
                bookId: input.bookId,
                chapterId: input.chapterId,
                chapterIndex: input.chapterIndex,
                pageIndex: input.pageIndex,
                sourceHash: input.sourceHash,
                snapshotVersion: book.snapshotVersion,
            });
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
        this.persistStore();
        (0, book_ingestion_logger_1.bookIngestionLog)('page.persisted', {
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: chapter.chapterIndex,
            pageIndex: input.pageIndex,
            sourceHash: input.sourceHash,
            paragraphCount: sortedParagraphs.length,
            paragraphKeys: sortedParagraphs.map((entry) => entry.key),
            pageTextLength: pageTextMaterialized.length,
            snapshotVersion: book.snapshotVersion,
            chapterContentHash: chapter.chapterContentHash,
        });
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
            createdAt: timestamp,
            updatedAt: timestamp,
            chapters: new Map(),
        };
        this.books.set(bookId, created);
        (0, book_ingestion_logger_1.bookIngestionLog)('book.created', { bookId, timestamp });
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
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        book.chapters.set(input.chapterId, created);
        (0, book_ingestion_logger_1.bookIngestionLog)('chapter.created', {
            bookId: input.bookId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chapterTitle: input.chapterTitle,
            timestamp,
        });
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
        (0, book_ingestion_logger_1.bookIngestionLog)('chapter.materialized', {
            bookId: chapter.bookId,
            chapterId: chapter.chapterId,
            chapterIndex: chapter.chapterIndex,
            pageCount: chapter.pages.size,
            chapterTextLength: chapter.chapterTextMaterialized.length,
            chapterContentHash: chapter.chapterContentHash,
            timestamp,
        });
    }
    loadPersistedStore() {
        try {
            if (!node_fs_1.default.existsSync(this.storePath)) {
                return;
            }
            const raw = node_fs_1.default.readFileSync(this.storePath, 'utf8');
            if (!raw.trim()) {
                return;
            }
            const parsed = JSON.parse(raw);
            for (const [bookId, book] of Object.entries(parsed.books ?? {})) {
                this.books.set(bookId, this.deserializeBook(book));
            }
        }
        catch (error) {
            console.warn('[book-ingestion] failed to load persisted store', error);
        }
    }
    persistStore() {
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.storePath), { recursive: true });
            const payload = {
                books: Object.fromEntries(Array.from(this.books.entries()).map(([bookId, book]) => [bookId, this.serializeBook(book)])),
            };
            const tempPath = `${this.storePath}.tmp`;
            node_fs_1.default.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
            node_fs_1.default.renameSync(tempPath, this.storePath);
        }
        catch (error) {
            console.warn('[book-ingestion] failed to persist store', error);
        }
    }
    serializeBook(book) {
        return {
            ...book,
            chapters: Object.fromEntries(Array.from(book.chapters.entries()).map(([chapterId, chapter]) => [
                chapterId,
                {
                    ...chapter,
                    pages: Object.fromEntries(Array.from(chapter.pages.entries()).map(([pageIndex, page]) => [String(pageIndex), page])),
                },
            ])),
        };
    }
    deserializeBook(book) {
        const fallbackTimestamp = book.updatedAt ?? new Date().toISOString();
        return {
            ...book,
            createdAt: book.createdAt ?? fallbackTimestamp,
            chapters: new Map(Object.entries(book.chapters ?? {}).map(([chapterId, chapter]) => [
                chapterId,
                {
                    ...chapter,
                    createdAt: chapter.createdAt ?? chapter.updatedAt ?? fallbackTimestamp,
                    pages: new Map(Object.entries(chapter.pages ?? {}).map(([pageIndex, page]) => [Number(pageIndex), page])),
                },
            ])),
        };
    }
};
exports.BookIngestionRepository = BookIngestionRepository;
exports.BookIngestionRepository = BookIngestionRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [String])
], BookIngestionRepository);
//# sourceMappingURL=book-ingestion.repository.js.map