import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConflictException } from '@nestjs/common';
import { describe, expect, test, vi } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { ChapterKeywordsWorkflowRepository } from '../src/modules/chapter-keywords-workflow/chapter-keywords-workflow.repository';
import { ChapterOpenAnalysisRepository } from '../src/modules/chapter-open-analysis/chapter-open-analysis.repository';
import { ChapterOpenAnalysisService } from '../src/modules/chapter-open-analysis/chapter-open-analysis.service';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { QuizWorkflowRepository } from '../src/modules/quiz-workflow/quiz-workflow.repository';
import { PreReadingWorkflowRepository } from '../src/modules/pre-reading-workflow/pre-reading-workflow.repository';
import type { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chapter-open-analysis-'));
  return new BookIngestionRepository(dataDir);
};

const createService = (
  bookRepository: BookIngestionRepository,
  enqueue = vi.fn(),
  chapterKeywordsRepository = new ChapterKeywordsWorkflowRepository(),
  knowledgeExtractionRepository = new KnowledgeExtractionWorkflowRepository(),
  quizRepository = new QuizWorkflowRepository(),
  preReadingRepository = new PreReadingWorkflowRepository(),
): ChapterOpenAnalysisService => {
  return new ChapterOpenAnalysisService(
    bookRepository,
    new ChapterOpenAnalysisRepository(),
    {} as never,
    chapterKeywordsRepository,
    {} as never,
    knowledgeExtractionRepository,
    quizRepository,
    { enqueue } as WorkflowQueueService,
    {} as never,
    preReadingRepository,
  );
};

describe('ChapterOpenAnalysisService', () => {
  test('finishes pre-reading before submitting insight workflows', async () => {
    const bookRepository = await createBookRepository();
    bookRepository.upsertPageFragment({
      bookId: 'book-order',
      chapterId: 'chapter-order',
      chapterIndex: 0,
      chapterTitle: 'Order',
      pageIndex: 0,
      sourceHash: 'order-page',
      pageParagraphs: { '0': 'The chapter text.' },
    });

    const order: string[] = [];
    const enqueue = vi.fn();
    const service = new ChapterOpenAnalysisService(
      bookRepository,
      new ChapterOpenAnalysisRepository(),
      {
        submitChapterKeywordsWorkflow: vi.fn(() => {
          order.push('chapterKeywords');
          return { workflowRunId: 'keywords-run' };
        }),
      } as never,
      new ChapterKeywordsWorkflowRepository(),
      {
        submitKnowledgeExtractionWorkflow: vi.fn(() => {
          order.push('knowledgeExtraction');
          return { workflowRunId: 'knowledge-run' };
        }),
      } as never,
      new KnowledgeExtractionWorkflowRepository(),
      new QuizWorkflowRepository(),
      { enqueue } as unknown as WorkflowQueueService,
      {
        submitPreReadingWorkflow: vi.fn(() => {
          order.push('preReadingSubmitted');
          return { workflowRunId: 'pre-reading-run' };
        }),
        executeRun: vi.fn(async () => {
          order.push('preReadingCompleted');
        }),
      } as never,
      new PreReadingWorkflowRepository(),
    );

    service.submitChapterOpenAnalysis({
      bookId: 'book-order',
      chapterId: 'chapter-order',
      chapterIndex: 0,
      pipelineVersion: 'v1',
    });
    const queuedTask = enqueue.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
    expect(queuedTask).toBeDefined();
    await queuedTask?.();

    expect(order).toEqual([
      'preReadingSubmitted',
      'preReadingCompleted',
      'chapterKeywords',
      'knowledgeExtraction',
    ]);
  });

  test('accepts a stale book snapshot when the chapter content hash still matches canonical state', async () => {
    const bookRepository = await createBookRepository();

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'chapter-1-page-0',
      pageParagraphs: { '0': 'Original text for chapter one.' },
    });

    const originalBook = bookRepository.getBook('book-1');
    const originalChapter = bookRepository.getChapter('book-1', 'chapter-1');
    if (!originalBook || !originalChapter) {
      throw new Error('expected canonical chapter state');
    }

    const staleSnapshotVersion = originalBook.snapshotVersion;
    const stableChapterHash = originalChapter.chapterContentHash;

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pageIndex: 0,
      sourceHash: 'chapter-2-page-0',
      pageParagraphs: { '0': 'A different chapter updates the book snapshot.' },
    });

    const latestBook = bookRepository.getBook('book-1');
    if (!latestBook) {
      throw new Error('expected canonical book state');
    }
    expect(latestBook.snapshotVersion).toBeGreaterThan(staleSnapshotVersion);

    const enqueue = vi.fn();
    const service = createService(bookRepository, enqueue);

    const response = service.submitChapterOpenAnalysis({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pipelineVersion: 'v1',
      expectedSnapshotVersion: staleSnapshotVersion,
      expectedChapterContentHash: stableChapterHash,
    });

    expect(response.status).toBe('running');
    expect(response.snapshotVersion).toBe(latestBook.snapshotVersion);
    expect(response.chapterContentHash).toBe(stableChapterHash);
    expect(response.tasks.preReading.status).toBe('queued');
    expect(response.tasks.chapterKeywords.status).toBe('blocked');
    expect(response.tasks.knowledgeExtraction.status).toBe('blocked');
    expect(response.tasks.quiz.status).toBe('blocked');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test('rejects a stale book snapshot when the chapter content hash also changed', async () => {
    const bookRepository = await createBookRepository();

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'chapter-1-page-0',
      pageParagraphs: { '0': 'Original text for chapter one.' },
    });

    const originalBook = bookRepository.getBook('book-1');
    const originalChapter = bookRepository.getChapter('book-1', 'chapter-1');
    if (!originalBook || !originalChapter) {
      throw new Error('expected canonical chapter state');
    }

    const staleSnapshotVersion = originalBook.snapshotVersion;
    const staleChapterHash = originalChapter.chapterContentHash;

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'chapter-1-page-0-updated',
      pageParagraphs: { '0': 'Updated text for chapter one.' },
    });

    const service = createService(bookRepository);

    expect(() => service.submitChapterOpenAnalysis({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pipelineVersion: 'v1',
      expectedSnapshotVersion: staleSnapshotVersion,
      expectedChapterContentHash: staleChapterHash,
    })).toThrowError(ConflictException);
  });

  test('rejects a stale book snapshot when the client did not provide a chapter content hash', async () => {
    const bookRepository = await createBookRepository();

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'chapter-1-page-0',
      pageParagraphs: { '0': 'Original text for chapter one.' },
    });

    const originalBook = bookRepository.getBook('book-1');
    if (!originalBook) {
      throw new Error('expected canonical book state');
    }

    const staleSnapshotVersion = originalBook.snapshotVersion;

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pageIndex: 0,
      sourceHash: 'chapter-2-page-0',
      pageParagraphs: { '0': 'A different chapter updates the book snapshot.' },
    });

    const service = createService(bookRepository);

    expect(() => service.submitChapterOpenAnalysis({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      pipelineVersion: 'v1',
      expectedSnapshotVersion: staleSnapshotVersion,
    })).toThrowError(ConflictException);
  });

  test('recovers aggregate status and progress from knowledge extraction when the open-analysis run was lost', async () => {
    const bookRepository = await createBookRepository();

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'chapter-1-page-0',
      pageParagraphs: { '0': 'Original text for chapter one.' },
    });

    const book = bookRepository.getBook('book-1');
    const chapter = bookRepository.getChapter('book-1', 'chapter-1');
    if (!book || !chapter) {
      throw new Error('expected canonical chapter state');
    }

    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const { run } = knowledgeRepository.createOrReuseRun({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge:book-1:chapter-1',
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter.chapterContentHash,
    });
    knowledgeRepository.markRunning(run.id);
    knowledgeRepository.updateRunProgress(run.id, {
      percent: 68,
      stage: 'extract_chunk_knowledge',
      message: '正在抽取关键人物与关系',
    });

    const service = createService(
      bookRepository,
      vi.fn(),
      new ChapterKeywordsWorkflowRepository(),
      knowledgeRepository,
      new QuizWorkflowRepository(),
    );

    const status = service.getChapterOpenAnalysisStatus('book-1', 'chapter-1');

    expect(status.status).toBe('running');
    expect(status.tasks.knowledgeExtraction.status).toBe('running');
    expect(status.progress).toEqual({
      percent: 68,
      stage: 'extract_chunk_knowledge',
      message: '正在抽取关键人物与关系',
    });
  });
});
