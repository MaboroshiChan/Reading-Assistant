import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  CanonicalBookRecord,
  CanonicalChapterRecord,
  CanonicalPageRecord,
  UpsertPageFragmentInput,
  UpsertPageFragmentResult,
} from './book-ingestion.types';

interface SortedParagraphEntry {
  key: string;
  value: string;
}

const hashText = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

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

  upsertPageFragment(input: UpsertPageFragmentInput): UpsertPageFragmentResult {
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
      updatedAt: timestamp,
      chapters: new Map<string, CanonicalChapterRecord>(),
    };
    this.books.set(bookId, created);
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
      updatedAt: timestamp,
    };
    book.chapters.set(input.chapterId, created);
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
  }
}
