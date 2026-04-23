import { describe, expect, test } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';

describe('BookIngestionRepository', () => {
  test('creates canonical book/chapter/page state and materializes sorted page text', () => {
    const repository = new BookIngestionRepository();

    const result = repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 4,
      sourceHash: 'hash-page-4-v1',
      pageParagraphs: {
        '10': 'tenth paragraph',
        '2': 'second paragraph',
        appendix: 'appendix paragraph',
      },
      bookMetadata: {
        title: 'Example Book',
      },
    });

    expect(result.deduped).toBe(false);
    expect(result.book.snapshotVersion).toBe(1);
    expect(result.page.pageTextMaterialized).toBe(
      'second paragraph\n\ntenth paragraph\n\nappendix paragraph',
    );
    expect(result.chapter.chapterTextMaterialized).toBe(
      'second paragraph\n\ntenth paragraph\n\nappendix paragraph',
    );
    expect(result.chapter.chapterTitle).toBe('Chapter One');
    expect(result.book.bookMetadata).toEqual({ title: 'Example Book' });

    const persistedPage = repository.getPage('book-1', 'chapter-1', 4);
    expect(persistedPage?.paragraphHashes).toMatchObject({
      '2': expect.any(String),
      '10': expect.any(String),
      appendix: expect.any(String),
    });
  });

  test('dedupes repeated uploads with the same source hash without incrementing snapshotVersion', () => {
    const repository = new BookIngestionRepository();

    const first = repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 1,
      sourceHash: 'hash-v1',
      pageParagraphs: {
        '0': 'paragraph',
      },
    });

    const duplicate = repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 1,
      sourceHash: 'hash-v1',
      pageParagraphs: {
        '0': 'paragraph changed but ignored for same hash',
      },
    });

    expect(first.book.snapshotVersion).toBe(1);
    expect(duplicate.deduped).toBe(true);
    expect(duplicate.book.snapshotVersion).toBe(1);
    expect(duplicate.page.pageTextMaterialized).toBe('paragraph');
  });

  test('re-materializes chapter text when a later page is inserted or an existing page changes hash', () => {
    const repository = new BookIngestionRepository();

    repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Original Title',
      pageIndex: 3,
      sourceHash: 'hash-page-3-v1',
      pageParagraphs: {
        '0': 'later page',
      },
    });

    repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 1,
      sourceHash: 'hash-page-1-v1',
      pageParagraphs: {
        '0': 'earlier page',
      },
    });

    const changed = repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 1,
      sourceHash: 'hash-page-1-v2',
      pageParagraphs: {
        '0': 'earlier page updated',
      },
    });

    expect(changed.book.snapshotVersion).toBe(3);
    expect(changed.chapter.chapterTitle).toBe('Original Title');
    expect(changed.chapter.chapterTextMaterialized).toBe(
      'earlier page updated\n\nlater page',
    );
    expect(changed.chapter.chapterContentHash).not.toBe('');
  });
});
