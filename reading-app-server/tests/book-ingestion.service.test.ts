import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, test } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { BookIngestionService } from '../src/modules/book-ingestion/book-ingestion.service';

describe('BookIngestionService', () => {
  test('parses a valid upsert request body and trims string fields', () => {
    const service = new BookIngestionService(new BookIngestionRepository());

    const parsed = service.parseUpsertRequest(
      JSON.stringify({
        bookId: ' book-1 ',
        chapterId: ' chapter-1 ',
        chapterIndex: 2,
        chapterTitle: ' Chapter Title ',
        pageIndex: 5,
        sourceHash: ' hash-1 ',
        pageParagraphs: {
          '0': 'paragraph one',
          a: 'paragraph two',
        },
        bookMetadata: {
          language: 'en',
        },
      }),
      {
        bookId: 'book-1',
        chapterId: 'chapter-1',
        pageIndex: 5,
      },
    );

    expect(parsed).toEqual({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 2,
      chapterTitle: 'Chapter Title',
      pageIndex: 5,
      sourceHash: 'hash-1',
      pageParagraphs: {
        '0': 'paragraph one',
        a: 'paragraph two',
      },
      bookMetadata: {
        language: 'en',
      },
    });
  });

  test('rejects invalid request bodies with 400-compatible exceptions', () => {
    const service = new BookIngestionService(new BookIngestionRepository());

    expect(() => service.parseUpsertRequest(undefined, {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      pageIndex: 0,
    })).toThrowError(BadRequestException);

    expect(() => service.parseUpsertRequest('{', {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      pageIndex: 0,
    })).toThrowError(BadRequestException);

    expect(() => service.parseUpsertRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 2,
      sourceHash: 'hash-1',
      pageParagraphs: {
        '0': 'paragraph',
      },
    }), {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      pageIndex: 1,
    })).toThrowError(/Path pageIndex does not match body pageIndex/);

    expect(() => service.parseUpsertRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 0,
      sourceHash: 'hash-1',
      pageParagraphs: {
        '0': '',
      },
    }), {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      pageIndex: 0,
    })).toThrowError(/pageParagraphs\.0 must be a non-empty string/);
  });

  test('returns chapter and page views from canonical state after upsert', () => {
    const service = new BookIngestionService(new BookIngestionRepository());

    const upsert = service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 7,
      chapterTitle: 'Chapter Seven',
      pageIndex: 3,
      sourceHash: 'hash-3-v1',
      pageParagraphs: {
        '1': 'paragraph one',
        '2': 'paragraph two',
      },
    });

    expect(upsert).toMatchObject({
      deduped: false,
      snapshotVersion: 1,
      pageCountInChapter: 1,
      chapterTextAvailable: true,
    });

    const chapter = service.getChapter('book-1', 'chapter-1');
    expect(chapter).toMatchObject({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 7,
      chapterTitle: 'Chapter Seven',
      snapshotVersion: 1,
      pageCount: 1,
      chapterTextAvailable: true,
    });

    const page = service.getPage('book-1', 'chapter-1', 3);
    expect(page).toMatchObject({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 7,
      chapterTitle: 'Chapter Seven',
      pageIndex: 3,
      sourceHash: 'hash-3-v1',
      snapshotVersion: 1,
    });
    expect(page.pageTextMaterialized).toBe('paragraph one\n\nparagraph two');
  });

  test('throws NotFoundException for missing chapter or page and validates pageIndex parsing', () => {
    const service = new BookIngestionService(new BookIngestionRepository());

    expect(() => service.getChapter('missing-book', 'missing-chapter')).toThrowError(NotFoundException);
    expect(() => service.getPage('missing-book', 'missing-chapter', 1)).toThrowError(NotFoundException);
    expect(() => service.parsePageIndex('-1')).toThrowError(/pageIndex must be a non-negative integer/);
    expect(() => service.parsePageIndex('abc')).toThrowError(/pageIndex must be a non-negative integer/);
    expect(service.parsePageIndex('12')).toBe(12);
  });
});
