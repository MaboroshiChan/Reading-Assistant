import { GoneException } from '@nestjs/common';
import { describe, expect, test, vi } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { ChapterKeywordsWorkflowRepository } from '../src/modules/chapter-keywords-workflow/chapter-keywords-workflow.repository';
import { ChapterKeywordsWorkflowService } from '../src/modules/chapter-keywords-workflow/chapter-keywords-workflow.service';
import type { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';

const makeService = (enqueue = vi.fn()): ChapterKeywordsWorkflowService =>
  new ChapterKeywordsWorkflowService(
    new BookIngestionRepository(),
    new ChapterKeywordsWorkflowRepository(),
    { enqueue } as unknown as WorkflowQueueService,
  );

describe('ChapterKeywordsWorkflowService', () => {
  test('does not recover or enqueue disabled workflow runs on bootstrap', () => {
    const enqueue = vi.fn();
    const service = makeService(enqueue);

    service.onApplicationBootstrap();

    expect(enqueue).not.toHaveBeenCalled();
  });

  test('returns gone for all disabled workflow service entrypoints', () => {
    const service = makeService();
    const calls = [
      () => service.submitChapterKeywordsWorkflow({
        bookId: 'book',
        chapterId: 'chapter',
        chapterIndex: 0,
        workflowVersion: 'v1',
      }),
      () => service.getWorkflowStatus('run-id'),
      () => service.getWorkflowResult('run-id'),
      () => service.restartWorkflow('run-id', { mode: 'resume' }),
      () => service.getLatestChapterKeywords('book', 'chapter'),
    ];

    for (const call of calls) {
      expect(call).toThrowError(GoneException);
      try {
        call();
      } catch (error) {
        expect((error as GoneException).getResponse()).toMatchObject({
          status: 'error',
          error: {
            code: 'E.FEATURE_DISABLED',
            http: 410,
            message: 'Chapter key sentence and key word generation moved to iOS local Foundation Models.',
          },
        });
      }
    }
  });
});
