import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CanonicalBookRecord,
  CanonicalChapterRecord,
  CanonicalPageRecord,
  UpsertPageFragmentInput,
  UpsertPageFragmentResult,
} from './book-ingestion.types';
import { bookIngestionLog } from './book-ingestion.logger';

interface SortedParagraphEntry {
  key: string;
  value: string;
}

interface SerializedCanonicalChapterRecord extends Omit<CanonicalChapterRecord, 'pages'> {
  pages: Record<string, CanonicalPageRecord>;
}

interface SerializedCanonicalBookRecord extends Omit<CanonicalBookRecord, 'chapters'> {
  chapters: Record<string, SerializedCanonicalChapterRecord>;
}

interface SerializedBookManifest extends Omit<SerializedCanonicalBookRecord, 'chapters'> {
  chapterIds: string[];
}

interface SerializedBookIngestionStore {
  books: Record<string, SerializedCanonicalBookRecord>;
}

const hashText = (input: string): string =>
  createHash('sha256').update(input).digest('hex');
const hashSegment = (input: string): string =>
  createHash('sha256').update(input).digest('hex').slice(0, 32);

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', '..', 'data', 'book-ingestion');
const LEGACY_STORE_FILE = 'store.json';
const BOOKS_DIR = 'books';
const MANIFEST_FILE = 'book.json';
const CHAPTERS_DIR = 'chapters';
export const BOOK_INGESTION_DATA_DIR = 'BOOK_INGESTION_DATA_DIR';

const sortParagraphEntries = (
  pageParagraphs: Record<string, string>,
): SortedParagraphEntry[] => {
  return Object.entries(pageParagraphs)
    .sort(([left], [right]) => {
      const leftNum = Number(left);
      const rightNum = Number(right);
      const leftNumeric = Number.isInteger(leftNum) && String(leftNum) === left.trim();
      const rightNumeric = Number.isInteger(rightNum) && String(rightNum) === right.trim();

      if (leftNumeric && rightNumeric) return leftNum - rightNum;
      if (leftNumeric) return -1;
      if (rightNumeric) return 1;
      return left.localeCompare(right);
    })
    .map(([key, value]) => ({ key, value }));
};

@Injectable()
export class BookIngestionRepository {
  private readonly books = new Map<string, CanonicalBookRecord>();
  private readonly dataDir: string;
  private readonly legacyStorePath: string;
  private readonly booksDirPath: string;

  constructor(
    @Inject(BOOK_INGESTION_DATA_DIR)
    dataDirOverride?: string,
  ) {
    this.dataDir = dataDirOverride ?? process.env.BOOK_INGESTION_DATA_DIR ?? DEFAULT_DATA_DIR;
    this.legacyStorePath = path.join(this.dataDir, LEGACY_STORE_FILE);
    this.booksDirPath = path.join(this.dataDir, BOOKS_DIR);
    this.loadPersistedStore();
  }

  upsertPageFragment(input: UpsertPageFragmentInput): UpsertPageFragmentResult {
    const currentTimestamp = new Date().toISOString();
    const book = this.getOrCreateBook(input.bookId, currentTimestamp);
    const chapter = this.getOrCreateChapter(book, input, currentTimestamp);
    const existingPage = chapter.pages.get(input.pageIndex);

    if (existingPage && existingPage.sourceHash === input.sourceHash) {
      bookIngestionLog('page.deduped', {
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
    const paragraphHashes = Object.fromEntries(
      sortedParagraphs.map((entry) => [entry.key, hashText(entry.value)]),
    );

    const pageRecord: CanonicalPageRecord = {
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
    this.persistBook(book);
    bookIngestionLog('page.persisted', {
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

  getChapter(bookId: string, chapterId: string): CanonicalChapterRecord | null {
    return this.books.get(bookId)?.chapters.get(chapterId) ?? null;
  }

  getPage(bookId: string, chapterId: string, pageIndex: number): CanonicalPageRecord | null {
    return this.getChapter(bookId, chapterId)?.pages.get(pageIndex) ?? null;
  }

  getBook(bookId: string): CanonicalBookRecord | null {
    return this.books.get(bookId) ?? null;
  }

  private getOrCreateBook(bookId: string, timestamp: string): CanonicalBookRecord {
    const existing = this.books.get(bookId);
    if (existing) return existing;

    const created: CanonicalBookRecord = {
      bookId,
      snapshotVersion: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      chapters: new Map<string, CanonicalChapterRecord>(),
    };
    this.books.set(bookId, created);
    bookIngestionLog('book.created', { bookId, timestamp });
    return created;
  }

  private getOrCreateChapter(
    book: CanonicalBookRecord,
    input: UpsertPageFragmentInput,
    timestamp: string,
  ): CanonicalChapterRecord {
    const existing = book.chapters.get(input.chapterId);
    if (existing) return existing;

    const created: CanonicalChapterRecord = {
      bookId: input.bookId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      chapterTitle: input.chapterTitle,
      pages: new Map<number, CanonicalPageRecord>(),
      chapterTextMaterialized: '',
      chapterContentHash: hashText(''),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    book.chapters.set(input.chapterId, created);
    bookIngestionLog('chapter.created', {
      bookId: input.bookId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      chapterTitle: input.chapterTitle,
      timestamp,
    });
    return created;
  }

  private materializeChapter(chapter: CanonicalChapterRecord, timestamp: string): void {
    const chapterTextMaterialized = Array.from(chapter.pages.entries())
      .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
      .map(([, page]) => page.pageTextMaterialized)
      .join('\n\n');

    chapter.chapterTextMaterialized = chapterTextMaterialized;
    chapter.chapterContentHash = hashText(chapterTextMaterialized);
    chapter.updatedAt = timestamp;
    bookIngestionLog('chapter.materialized', {
      bookId: chapter.bookId,
      chapterId: chapter.chapterId,
      chapterIndex: chapter.chapterIndex,
      pageCount: chapter.pages.size,
      chapterTextLength: chapter.chapterTextMaterialized.length,
      chapterContentHash: chapter.chapterContentHash,
      timestamp,
    });
  }

  private loadPersistedStore(): void {
    try {
      if (fs.existsSync(this.booksDirPath)) {
        this.loadSplitStore();
        if (this.books.size > 0) return;
      }

      this.loadLegacyStore();
      if (this.books.size > 0) {
        this.persistAllBooks();
      }
    } catch (error) {
      console.warn('[book-ingestion] failed to load persisted store', error);
    }
  }

  private loadSplitStore(): void {
    const directoryEntries = fs.readdirSync(this.booksDirPath, { withFileTypes: true });
    for (const entry of directoryEntries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(this.booksDirPath, entry.name, MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) continue;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SerializedBookManifest;
      const chapters = new Map<string, CanonicalChapterRecord>();
      for (const chapterId of manifest.chapterIds ?? []) {
        const chapterPath = this.getChapterPath(manifest.bookId, chapterId);
        if (!fs.existsSync(chapterPath)) continue;

        const chapter = JSON.parse(
          fs.readFileSync(chapterPath, 'utf8'),
        ) as SerializedCanonicalChapterRecord;
        chapters.set(chapterId, this.deserializeChapter(chapter));
      }

      this.books.set(manifest.bookId, {
        bookId: manifest.bookId,
        bookMetadata: manifest.bookMetadata,
        snapshotVersion: manifest.snapshotVersion,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        chapters,
      });
    }
  }

  private loadLegacyStore(): void {
    if (!fs.existsSync(this.legacyStorePath)) {
      return;
    }

    const raw = fs.readFileSync(this.legacyStorePath, 'utf8');
    if (!raw.trim()) {
      return;
    }

    const parsed = JSON.parse(raw) as SerializedBookIngestionStore;
    for (const [bookId, book] of Object.entries(parsed.books ?? {})) {
      this.books.set(bookId, this.deserializeBook(book));
    }
  }

  private persistAllBooks(): void {
    for (const book of this.books.values()) {
      this.persistBook(book);
    }
  }

  private persistBook(book: CanonicalBookRecord): void {
    try {
      this.ensureBookDirectories(book.bookId);

      for (const chapter of book.chapters.values()) {
        this.writeJsonAtomic(
          this.getChapterPath(book.bookId, chapter.chapterId),
          this.serializeChapter(chapter),
        );
      }

      this.writeJsonAtomic(this.getManifestPath(book.bookId), this.serializeBookManifest(book));
    } catch (error) {
      console.warn('[book-ingestion] failed to persist store', error);
    }
  }

  private ensureBookDirectories(bookId: string): void {
    fs.mkdirSync(this.getChaptersDir(bookId), { recursive: true });
  }

  private writeJsonAtomic(targetPath: string, payload: unknown): void {
    const tempPath = `${targetPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tempPath, targetPath);
  }

  private serializeBookManifest(book: CanonicalBookRecord): SerializedBookManifest {
    return {
      bookId: book.bookId,
      bookMetadata: book.bookMetadata,
      snapshotVersion: book.snapshotVersion,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      chapterIds: Array.from(book.chapters.keys()),
    };
  }

  private serializeChapter(chapter: CanonicalChapterRecord): SerializedCanonicalChapterRecord {
    return {
      ...chapter,
      pages: Object.fromEntries(
        Array.from(chapter.pages.entries()).map(([pageIndex, page]) => [String(pageIndex), page]),
      ),
    };
  }

  private deserializeBook(book: SerializedCanonicalBookRecord): CanonicalBookRecord {
    const fallbackTimestamp = book.updatedAt ?? new Date().toISOString();
    return {
      ...book,
      createdAt: book.createdAt ?? fallbackTimestamp,
      chapters: new Map(
        Object.entries(book.chapters ?? {}).map(([chapterId, chapter]) => [
          chapterId,
          this.deserializeChapter({
            ...chapter,
            chapterId,
            bookId: chapter.bookId ?? book.bookId,
          }),
        ]),
      ),
    };
  }

  private deserializeChapter(chapter: SerializedCanonicalChapterRecord): CanonicalChapterRecord {
    const fallbackTimestamp = chapter.updatedAt ?? new Date().toISOString();
    return {
      ...chapter,
      createdAt: chapter.createdAt ?? fallbackTimestamp,
      pages: new Map(
        Object.entries(chapter.pages ?? {}).map(([pageIndex, page]) => [Number(pageIndex), page]),
      ),
    };
  }

  private getBookDir(bookId: string): string {
    return path.join(this.booksDirPath, this.makeSegment(bookId));
  }

  private getManifestPath(bookId: string): string {
    return path.join(this.getBookDir(bookId), MANIFEST_FILE);
  }

  private getChaptersDir(bookId: string): string {
    return path.join(this.getBookDir(bookId), CHAPTERS_DIR);
  }

  private getChapterPath(bookId: string, chapterId: string): string {
    return path.join(this.getChaptersDir(bookId), `${this.makeSegment(chapterId)}.json`);
  }

  private makeSegment(value: string): string {
    return hashSegment(value);
  }
}
