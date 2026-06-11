import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookContextService } from '../src/modules/book-ingestion/book-context.service';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { PreReadingWorkflowRepository } from '../src/modules/pre-reading-workflow/pre-reading-workflow.repository';
import { PreReadingWorkflowService } from '../src/modules/pre-reading-workflow/pre-reading-workflow.service';
import type { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';
import * as llmService from '../services/llmService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PreReadingWorkflowService', () => {
  test('publishes a pre-reading result before downstream workflows are required', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pre-reading-workflow-'));
    const bookRepository = new BookIngestionRepository(dataDir);
    const repository = new PreReadingWorkflowRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const service = new PreReadingWorkflowService(
      bookRepository,
      new BookContextService(bookRepository, knowledgeRepository),
      repository,
      { enqueue: vi.fn() } as unknown as WorkflowQueueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 0,
      chapterTitle: 'Arrival',
      pageIndex: 0,
      sourceHash: 'page-1',
      pageParagraphs: { '0': 'Mara arrives at the station and notices that everyone is waiting.' },
    });

    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async () => ({
        data: (async function* () {
          yield JSON.stringify({
            teaser: 'A routine arrival begins to feel less ordinary.',
            pre_reading_questions: [
              'What details make the station feel unusual?',
              'Whose behavior should you watch most closely?',
              'How does Mara interpret the waiting crowd?',
            ],
            questions: [],
          });
        })(),
        usage: Promise.resolve({}),
      })),
    } as never);

    const submit = service.submitPreReadingWorkflow({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 0,
      workflowVersion: 'v1',
    }, { enqueue: false });

    expect(service.getWorkflowStatus(submit.workflowRunId).resultAvailable).toBe(false);

    await service.executeRun(submit.workflowRunId);

    const status = service.getWorkflowStatus(submit.workflowRunId);
    const result = service.getWorkflowResult(submit.workflowRunId);
    expect(status.status).toBe('completed');
    expect(status.resultAvailable).toBe(true);
    expect(result.result.pre_reading_questions).toHaveLength(3);
    expect(service.getLatestChapterPreReading('book-1', 'chapter-1').result)
      .toEqual(result.result);
  });
});
