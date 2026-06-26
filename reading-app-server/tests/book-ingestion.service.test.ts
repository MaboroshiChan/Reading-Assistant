import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, test, vi } from 'vitest';
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
    delete process.env.BOOK_INGESTION_LOG_STDOUT;
    vi.restoreAllMocks();
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

  test('parses a valid batch upsert request body and trims shared string fields', () => {
    const service = new BookIngestionService(createRepository());

    const parsed = service.parseBatchUpsertRequest(
      JSON.stringify({
        bookId: ' book-1 ',
        chapterId: ' chapter-1 ',
        chapterIndex: 2,
        chapterTitle: ' Chapter Title ',
        pages: [
          {
            pageIndex: 5,
            sourceHash: ' hash-1 ',
            pageParagraphs: {
              '0': 'paragraph one',
            },
          },
          {
            pageIndex: 6,
            sourceHash: ' hash-2 ',
            pageParagraphs: {
              '0': 'paragraph two',
            },
          },
        ],
        bookMetadata: {
          language: 'en',
        },
        chapterIngestionCompleted: true,
        bookIngestionCompleted: true,
      }),
      {
        bookId: 'book-1',
        chapterId: 'chapter-1',
      },
    );

    expect(parsed).toEqual({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 2,
      chapterTitle: 'Chapter Title',
      pages: [
        {
          pageIndex: 5,
          sourceHash: 'hash-1',
          pageParagraphs: {
            '0': 'paragraph one',
          },
        },
        {
          pageIndex: 6,
          sourceHash: 'hash-2',
          pageParagraphs: {
            '0': 'paragraph two',
          },
        },
      ],
      bookMetadata: {
        language: 'en',
      },
      chapterIngestionCompleted: true,
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

    expect(() => service.parseBatchUpsertRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pages: [],
    }), {
      bookId: 'book-1',
      chapterId: 'chapter-1',
    })).toThrowError(/pages must be a non-empty array/);

    expect(() => service.parseBatchUpsertRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pages: [
        {
          pageIndex: -1,
          sourceHash: 'hash-1',
          pageParagraphs: { '0': 'paragraph' },
        },
      ],
    }), {
      bookId: 'book-1',
      chapterId: 'chapter-1',
    })).toThrowError(/pages\.0\.pageIndex must be a non-negative integer/);
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

  test('upserts a chapter batch and auto-submits knowledge extraction once when the book completes', async () => {
    const repository = createRepository();
    const submissions: string[] = [];
    const workflowService = {
      submitKnowledgeExtractionWorkflow(request: { chapterId: string }) {
        submissions.push(request.chapterId);
        return {
          workflowRunId: `run-${request.chapterId}`,
          deduped: false,
          status: 'queued',
        };
      },
    } as unknown as KnowledgeExtractionWorkflowService;
    const service = new BookIngestionService(repository, workflowService);

    const response = service.upsertChapterBatch({
      bookId: 'book-1',
      chapterId: 'chapter-10',
      chapterIndex: 10,
      chapterTitle: 'Chapter Eleven',
      pages: [
        {
          pageIndex: 1,
          sourceHash: 'hash-page-1',
          pageParagraphs: { '0': 'second page' },
        },
        {
          pageIndex: 0,
          sourceHash: 'hash-page-0',
          pageParagraphs: { '0': 'first page' },
        },
      ],
      bookIngestionCompleted: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response).toMatchObject({
      bookId: 'book-1',
      chapterId: 'chapter-10',
      chapterIndex: 10,
      deduped: false,
      snapshotVersion: 2,
      pageCountInChapter: 2,
      chapterTextAvailable: true,
    });
    expect(service.getChapter('book-1', 'chapter-10')).toMatchObject({
      pageCount: 2,
      chapterTextAvailable: true,
    });
    expect(service.getPage('book-1', 'chapter-10', 0).pageTextMaterialized).toBe('first page');
    expect(service.getPage('book-1', 'chapter-10', 1).pageTextMaterialized).toBe('second page');
    expect(submissions).toEqual(['chapter-10']);
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

  test('skips auto-submitting chapters whose latest knowledge result matches current content', async () => {
    const repository = createRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const submissions: string[] = [];
    const workflowService = {
      submitKnowledgeExtractionWorkflow(request: { chapterId: string }) {
        submissions.push(request.chapterId);
        return {
          workflowRunId: `run-${request.chapterId}`,
          deduped: false,
          status: 'queued',
        };
      },
    } as unknown as KnowledgeExtractionWorkflowService;
    const service = new BookIngestionService(repository, workflowService, knowledgeRepository);

    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'chapter one' },
    });

    const book = repository.getBook('book-1');
    const chapter = repository.getChapter('book-1', 'chapter-1');
    expect(book).not.toBeNull();
    expect(chapter).not.toBeNull();

    const { run } = knowledgeRepository.createOrReuseRun({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'current-chapter-1',
      expectedSnapshotVersion: book!.snapshotVersion,
      expectedChapterContentHash: chapter!.chapterContentHash,
    });
    knowledgeRepository.completeRun({
      workflowRunId: run.id,
      snapshotVersion: book!.snapshotVersion,
      chapterContentHash: chapter!.chapterContentHash,
      result: {
        title: 'Chapter One',
        summary: 'Already extracted',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      pageIndex: 0,
      sourceHash: 'hash-page-1',
      pageParagraphs: { '0': 'chapter two' },
      bookIngestionCompleted: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submissions).toEqual(['chapter-2']);
  });

  test('skips reentrant auto-submit sweeps for the same book', async () => {
    const repository = createRepository();
    const submissions: string[] = [];
    let service!: BookIngestionService;
    let triggeredReentrantUpsert = false;
    const workflowService = {
      submitKnowledgeExtractionWorkflow(request: { bookId: string; chapterId: string }) {
        submissions.push(request.chapterId);
        if (!triggeredReentrantUpsert) {
          triggeredReentrantUpsert = true;
          service.upsertPageFragment({
            bookId: request.bookId,
            chapterId: 'chapter-2',
            chapterIndex: 2,
            pageIndex: 0,
            sourceHash: 'hash-page-1',
            pageParagraphs: { '0': 'chapter two' },
            bookIngestionCompleted: true,
          });
        }
        return {
          workflowRunId: `run-${request.chapterId}`,
          deduped: false,
          status: 'queued',
        };
      },
    } as unknown as KnowledgeExtractionWorkflowService;
    service = new BookIngestionService(repository, workflowService);

    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'chapter one' },
      bookIngestionCompleted: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.getChapter('book-1', 'chapter-2')).not.toBeNull();
    expect(submissions).toEqual(['chapter-1']);
  });

  test('continues auto-submitting later chapters when one chapter submission fails', async () => {
    const repository = createRepository();
    const attemptedChapterIds: string[] = [];
    const successfulChapterIds: string[] = [];
    const failedChapterIds: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    process.env.BOOK_INGESTION_LOG_STDOUT = '1';

    const workflowService = {
      submitKnowledgeExtractionWorkflow(request: {
        bookId: string;
        chapterId: string;
        expectedSnapshotVersion?: number;
      }) {
        attemptedChapterIds.push(request.chapterId);
        if (request.chapterId === 'chapter-2') {
          failedChapterIds.push(request.chapterId);
          throw new Error('synthetic chapter failure');
        }

        successfulChapterIds.push(request.chapterId);
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
    service.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-3',
      chapterIndex: 3,
      pageIndex: 0,
      sourceHash: 'hash-page-2',
      pageParagraphs: { '0': 'chapter three' },
      bookIngestionCompleted: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(attemptedChapterIds).toEqual(['chapter-1', 'chapter-2', 'chapter-3']);
    expect(successfulChapterIds).toEqual(['chapter-1', 'chapter-3']);
    expect(failedChapterIds).toEqual(['chapter-2']);
    expect(successfulChapterIds).toHaveLength(2);
    expect(failedChapterIds).toHaveLength(1);

    const logLines = stdoutSpy.mock.calls.map(([line]) => String(line));
    expect(logLines.some((line) => line.includes('"event":"knowledge_extraction_workflow.auto_submit_started"'))).toBe(true);
    expect(logLines.some((line) => line.includes('"event":"knowledge_extraction_workflow.auto_submitted"') && line.includes('"chapterId":"chapter-1"'))).toBe(true);
    expect(logLines.some((line) => line.includes('"event":"knowledge_extraction_workflow.auto_submit_chapter_failed"') && line.includes('"chapterId":"chapter-2"'))).toBe(true);
    expect(logLines.some((line) => line.includes('"event":"knowledge_extraction_workflow.auto_submitted"') && line.includes('"chapterId":"chapter-3"'))).toBe(true);
    expect(logLines.some((line) => line.includes('"event":"knowledge_extraction_workflow.auto_submit_finished"') && line.includes('"submittedCount":2') && line.includes('"failedCount":1'))).toBe(true);
  });
});
