import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, test } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { BookIngestionService } from '../src/modules/book-ingestion/book-ingestion.service';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import type { KnowledgeExtractionWorkflowService } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service';

describe('BookIngestionService', () => {
  const createRepository = (): BookIngestionRepository => {
    process.env.BOOK_INGESTION_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'book-ingestion-service-'));
    return new BookIngestionRepository();
  };

  afterEach(() => {
    delete process.env.BOOK_INGESTION_DATA_DIR;
  });

  test('parses a valid upsert request body and trims string fields', () => {
    const service = new BookIngestionService(createRepository());

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
        bookIngestionCompleted: true,
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
      bookIngestionCompleted: true,
    });
  });

  test('rejects invalid request bodies with 400-compatible exceptions', () => {
    const service = new BookIngestionService(createRepository());

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

    expect(() => service.parseUpsertRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 0,
      sourceHash: 'hash-1',
      pageParagraphs: {
        '0': 'paragraph',
      },
      bookIngestionCompleted: 'yes',
    }), {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      pageIndex: 0,
    })).toThrowError(/bookIngestionCompleted must be a boolean/);
  });

  test('returns chapter and page views from canonical state after upsert', () => {
    const service = new BookIngestionService(createRepository());

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
    const service = new BookIngestionService(createRepository());

    expect(() => service.getChapter('missing-book', 'missing-chapter')).toThrowError(NotFoundException);
    expect(() => service.getPage('missing-book', 'missing-chapter', 1)).toThrowError(NotFoundException);
    expect(() => service.parsePageIndex('-1')).toThrowError(/pageIndex must be a non-negative integer/);
    expect(() => service.parsePageIndex('abc')).toThrowError(/pageIndex must be a non-negative integer/);
    expect(service.parsePageIndex('12')).toBe(12);
  });

  test('builds an iOS-aligned book model with chapter snapshots and key information', async () => {
    const bookRepository = createRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const service = new BookIngestionService(bookRepository, undefined, knowledgeRepository);

    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'page zero' },
      bookMetadata: {
        title: 'Example Book',
        author: 'Author Name',
        language: 'en',
      },
    });

    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pageIndex: 0,
      sourceHash: 'hash-page-1',
      pageParagraphs: { '0': 'page one' },
    });

    await knowledgeRepository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        people: [
          {
            local_id: 'p1',
            name: 'Alice',
            evidence: [{ quote: 'Alice appears', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        ideas: [],
        events: [
          {
            local_id: 'e1',
            label: 'Speech',
            evidence: [{ quote: 'The speech begins', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        entities: [],
        themes: [],
        relations: [
          {
            local_id: 'r1',
            from_id: 'p1',
            from_type: 'person',
            to_id: 'e1',
            to_type: 'event',
            relation_type: 'participates_in',
            evidence: [{ quote: 'Alice gives the speech', pageIndex: 0, pageNumber: 1 }],
          },
        ],
      },
    });

    await knowledgeRepository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        people: [],
        ideas: [],
        events: [
          {
            local_id: 'e2',
            label: 'speech',
            evidence: [{ quote: 'The speech returns', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    const model = await service.getBookModel('book-1');

    expect(model.meta).toMatchObject({
      title: 'Example Book',
      author: 'Author Name',
      language: 'en',
      totalChapters: 2,
    });
    expect(model.chapters).toHaveLength(2);
    expect(model.chapters[0]).toMatchObject({
      chapterId: 'chapter-1',
      chapterIndex: 1,
      title: 'Chapter One',
      people: [
        expect.objectContaining({
          name: 'Alice',
        }),
      ],
    });
    expect(model.keyInformation.events).toHaveLength(1);
    expect(model.keyInformation.events[0]).toMatchObject({
      canonicalLabel: 'Speech',
      mentionedIn: [1, 2],
    });
    expect(model.keyInformation.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chapterId: 'chapter-1',
          localType: 'person',
          globalType: 'person',
        }),
      ]),
    );
  });

  test('only auto-submits knowledge extraction after book ingestion is marked complete', async () => {
    const repository = createRepository();
    const submissions: Array<{ bookId: string; chapterId: string; snapshotVersion: number | undefined }> = [];
    const workflowService = {
      submitKnowledgeExtractionWorkflow(request: {
        bookId: string;
        chapterId: string;
        expectedSnapshotVersion?: number;
      }) {
        submissions.push({
          bookId: request.bookId,
          chapterId: request.chapterId,
          snapshotVersion: request.expectedSnapshotVersion,
        });
        return {
          workflowRunId: `run-${request.chapterId}`,
          deduped: false,
          status: 'queued',
        };
      },
    } as unknown as KnowledgeExtractionWorkflowService;
    const service = new BookIngestionService(repository, workflowService);

    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'chapter one' },
    });
    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      pageIndex: 0,
      sourceHash: 'hash-page-1',
      pageParagraphs: { '0': 'chapter two' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submissions).toHaveLength(0);

    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      pageIndex: 1,
      sourceHash: 'hash-page-2',
      pageParagraphs: { '0': 'chapter two final page' },
      bookIngestionCompleted: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submissions).toEqual([
      {
        bookId: 'book-1',
        chapterId: 'chapter-1',
        snapshotVersion: 3,
      },
      {
        bookId: 'book-1',
        chapterId: 'chapter-2',
        snapshotVersion: 3,
      },
    ]);
  });
});
