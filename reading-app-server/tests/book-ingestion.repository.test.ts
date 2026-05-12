import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';

describe('BookIngestionRepository', () => {
  const createRepository = (): BookIngestionRepository => {
    process.env.BOOK_INGESTION_DATA_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), 'book-ingestion-store-'));
    return new BookIngestionRepository();
  };

  afterEach(async () => {
    delete process.env.BOOK_INGESTION_DATA_DIR;
  });

  test('creates canonical book/chapter/page state and materializes sorted page text', () => {
    const repository = createRepository();

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
    const repository = createRepository();

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
    const repository = createRepository();

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

  test('reloads persisted canonical state across repository instances', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'book-ingestion-store-'));
    process.env.BOOK_INGESTION_DATA_DIR = dataDir;

    const firstRepository = new BookIngestionRepository();
    firstRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Persisted Chapter',
      pageIndex: 2,
      sourceHash: 'hash-page-2-v1',
      pageParagraphs: {
        '0': 'persisted paragraph one',
        '1': 'persisted paragraph two',
      },
      bookMetadata: {
        title: 'Persistent Book',
      },
    });

    const secondRepository = new BookIngestionRepository();
    const restoredBook = secondRepository.getBook('book-1');
    const restoredChapter = secondRepository.getChapter('book-1', 'chapter-1');
    const restoredPage = secondRepository.getPage('book-1', 'chapter-1', 2);

    expect(restoredBook?.bookMetadata).toEqual({ title: 'Persistent Book' });
    expect(restoredBook?.snapshotVersion).toBe(1);
    expect(restoredChapter?.chapterTitle).toBe('Persisted Chapter');
    expect(restoredChapter?.chapterTextMaterialized).toBe(
      'persisted paragraph one\n\npersisted paragraph two',
    );
    expect(restoredPage?.pageTextMaterialized).toBe(
      'persisted paragraph one\n\npersisted paragraph two',
    );
  });

  test('persists split book and chapter files without relying on a monolithic store payload', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'book-ingestion-split-'));
    process.env.BOOK_INGESTION_DATA_DIR = dataDir;

    const writer = new BookIngestionRepository();
    writer.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Persisted Chapter',
      pageIndex: 2,
      sourceHash: 'hash-page-2-v1',
      pageParagraphs: {
        '0': 'persisted paragraph one',
        '1': 'persisted paragraph two',
      },
      bookMetadata: {
        title: 'Persistent Book',
      },
    });

    const booksDir = path.join(dataDir, 'books');
    const bookDirectories = await fs.readdir(booksDir);
    expect(bookDirectories).toHaveLength(1);

    const manifestPath = path.join(booksDir, bookDirectories[0], 'book.json');
    const chaptersDir = path.join(booksDir, bookDirectories[0], 'chapters');
    const chapterFiles = await fs.readdir(chaptersDir);

    expect(chapterFiles).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(manifestPath, 'utf8'))).toMatchObject({
      bookId: 'book-1',
      snapshotVersion: 1,
      chapterIds: ['chapter-1'],
    });

    const reader = new BookIngestionRepository();
    expect(reader.getBook('book-1')?.bookMetadata).toEqual({ title: 'Persistent Book' });
    expect(reader.getBook('book-1')?.snapshotVersion).toBe(1);
    expect(reader.getChapter('book-1', 'chapter-1')?.chapterTitle).toBe('Persisted Chapter');
    expect(reader.getChapter('book-1', 'chapter-1')?.chapterTextMaterialized).toBe(
      'persisted paragraph one\n\npersisted paragraph two',
    );
    expect(reader.getPage('book-1', 'chapter-1', 2)?.pageTextMaterialized).toBe(
      'persisted paragraph one\n\npersisted paragraph two',
    );
  });

  test('migrates legacy store.json into split files on startup', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'book-ingestion-legacy-'));
    process.env.BOOK_INGESTION_DATA_DIR = dataDir;

    const legacyPayload = {
      books: {
        'book-1': {
          bookId: 'book-1',
          bookMetadata: { title: 'Legacy Book' },
          snapshotVersion: 3,
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:03.000Z',
          chapters: {
            'chapter-1': {
              bookId: 'book-1',
              chapterId: 'chapter-1',
              chapterIndex: 1,
              chapterTitle: 'Legacy Chapter',
              chapterTextMaterialized: 'legacy paragraph',
              chapterContentHash: 'legacy-hash',
              createdAt: '2026-05-12T00:00:00.000Z',
              updatedAt: '2026-05-12T00:00:03.000Z',
              pages: {
                '0': {
                  pageIndex: 0,
                  sourceHash: 'page-hash',
                  pageParagraphs: { '0': 'legacy paragraph' },
                  pageTextMaterialized: 'legacy paragraph',
                  paragraphHashes: { '0': 'paragraph-hash' },
                  createdAt: '2026-05-12T00:00:00.000Z',
                  updatedAt: '2026-05-12T00:00:03.000Z',
                },
              },
            },
          },
        },
      },
    };

    await fs.writeFile(
      path.join(dataDir, 'store.json'),
      JSON.stringify(legacyPayload, null, 2),
      'utf8',
    );

    const repository = new BookIngestionRepository();

    expect(repository.getBook('book-1')?.snapshotVersion).toBe(3);
    expect(repository.getChapter('book-1', 'chapter-1')?.chapterTitle).toBe('Legacy Chapter');

    const booksDir = path.join(dataDir, 'books');
    expect((await fs.readdir(booksDir)).length).toBe(1);
  });
});
