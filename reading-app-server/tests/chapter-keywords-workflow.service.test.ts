import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { ChapterKeywordsWorkflowRepository } from '../src/modules/chapter-keywords-workflow/chapter-keywords-workflow.repository';
import { ChapterKeywordsWorkflowService } from '../src/modules/chapter-keywords-workflow/chapter-keywords-workflow.service';
import type { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';
import * as chapterKeywordsLlm from '../src/modules/chapter-keywords-workflow/chapter-keywords-llm';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chapter-keywords-'));
  return new BookIngestionRepository(dataDir);
};

describe('ChapterKeywordsWorkflowService', () => {
  test('aggressively reduces fiction key sentence frequency', async () => {
    const bookRepository = await createBookRepository();
    bookRepository.upsertPageFragment({
      bookId: 'fiction-book',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'page-0',
      bookMetadata: { isFiction: true },
      pageParagraphs: {
        '0': 'He opened the gate.',
        '1': 'She crossed the yard.',
        '2': 'The letter changed everything.',
        '3': 'Rain hit the windows.',
        '4': 'They argued in the hallway.',
        '5': 'He finally confessed the truth.',
      },
    });

    const workflowRepository = new ChapterKeywordsWorkflowRepository();
    const service = new ChapterKeywordsWorkflowService(
      bookRepository,
      workflowRepository,
      { enqueue: vi.fn() } as WorkflowQueueService,
    );

    const analyzeSpy = vi.spyOn(chapterKeywordsLlm, 'analyzeChapterKeywordsChunk')
      .mockResolvedValue({
        key_sentences: [
          {
            sentence_ref: { page_index: 0, paragraph_index: 0, paragraph_id: 0, sentence_id: 0 },
            sentence_text: 'He opened the gate.',
            importance: 0.91,
            reason: 'starts the next decisive move',
          },
          {
            sentence_ref: { page_index: 0, paragraph_index: 2, paragraph_id: 2, sentence_id: 0 },
            sentence_text: 'The letter changed everything.',
            importance: 0.97,
            reason: 'major revelation changes the plot',
          },
          {
            sentence_ref: { page_index: 0, paragraph_index: 4, paragraph_id: 4, sentence_id: 0 },
            sentence_text: 'They argued in the hallway.',
            importance: 0.88,
            reason: 'conflict escalates sharply',
          },
          {
            sentence_ref: { page_index: 0, paragraph_index: 5, paragraph_id: 5, sentence_id: 0 },
            sentence_text: 'He finally confessed the truth.',
            importance: 0.96,
            reason: 'irreversible confession',
          },
        ],
        sentence_keywords: [],
      });

    const submission = service.submitChapterKeywordsWorkflow({
      bookId: 'fiction-book',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await (service as any).executeRun(submission.workflowRunId);

    const completed = workflowRepository.getRun(submission.workflowRunId);
    expect(completed?.status).toBe('completed');
    expect(analyzeSpy).toHaveBeenCalledWith(expect.objectContaining({
      promptVariant: 'fiction',
    }));
    expect(completed?.output?.key_sentences).toHaveLength(1);
    expect(completed?.output?.key_sentences[0]?.sentence_text).toBe('The letter changed everything.');
  });

  test('stores chunk checkpoint after failure and resumes from the next chunk', async () => {
    const bookRepository = await createBookRepository();
    bookRepository.upsertPageFragment({
      bookId: 'chunk-resume-book',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chunk Resume',
      pageIndex: 0,
      sourceHash: 'page-0',
      pageParagraphs: {
        '0': 'Paragraph zero.',
        '1': 'Paragraph one.',
        '2': 'Paragraph two.',
        '3': 'Paragraph three.',
        '4': 'Paragraph four.',
        '5': 'Paragraph five.',
        '6': 'Paragraph six.',
        '7': 'Paragraph seven.',
      },
    });

    const workflowRepository = new ChapterKeywordsWorkflowRepository();
    const service = new ChapterKeywordsWorkflowService(
      bookRepository,
      workflowRepository,
      new (class {
        enqueue(task: () => Promise<void>) {
          void task();
        }
      })() as WorkflowQueueService,
    );

    const seenChunkIndexes: number[] = [];
    let secondChunkAttempts = 0;
    vi.spyOn(chapterKeywordsLlm, 'analyzeChapterKeywordsChunk').mockImplementation(async (input) => {
      seenChunkIndexes.push(input.chunkIndex);
      if (input.chunkIndex === 0) {
        return {
          key_sentences: [
            {
              sentence_ref: { page_index: 0, paragraph_index: 0, paragraph_id: 0, sentence_id: 0 },
              sentence_text: 'Paragraph zero.',
              importance: 0.91,
              reason: 'opens the chapter',
            },
          ],
          sentence_keywords: [],
        };
      }

      secondChunkAttempts += 1;
      if (secondChunkAttempts === 1) {
        throw new Error('synthetic chunk failure');
      }

      return {
        key_sentences: [
          {
            sentence_ref: { page_index: 0, paragraph_index: 6, paragraph_id: 6, sentence_id: 0 },
            sentence_text: 'Paragraph six.',
            importance: 0.94,
            reason: 'late chapter pivot',
          },
        ],
        sentence_keywords: [],
      };
    });

    const submission = service.submitChapterKeywordsWorkflow({
      bookId: 'chunk-resume-book',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submission.workflowRunId).status).toBe('failed');
    });

    expect(service.getWorkflowStatus(submission.workflowRunId).checkpoint).toMatchObject({
      totalChunks: 2,
      lastCompletedChunkIndex: 0,
      nextChunkIndex: 1,
    });
    expect(workflowRepository.getRun(submission.workflowRunId)?.partialChunkResults).toHaveLength(1);

    service.restartWorkflow(submission.workflowRunId, { mode: 'resume' });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submission.workflowRunId).status).toBe('completed');
    });

    expect(seenChunkIndexes).toEqual([0, 1, 1]);
  });

  test('restarts chapter keywords from the first chunk when requested', async () => {
    const bookRepository = await createBookRepository();
    bookRepository.upsertPageFragment({
      bookId: 'chunk-restart-book',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chunk Restart',
      pageIndex: 0,
      sourceHash: 'page-0',
      pageParagraphs: {
        '0': 'Paragraph zero.',
        '1': 'Paragraph one.',
        '2': 'Paragraph two.',
        '3': 'Paragraph three.',
        '4': 'Paragraph four.',
        '5': 'Paragraph five.',
        '6': 'Paragraph six.',
        '7': 'Paragraph seven.',
      },
    });

    const workflowRepository = new ChapterKeywordsWorkflowRepository();
    const service = new ChapterKeywordsWorkflowService(
      bookRepository,
      workflowRepository,
      new (class {
        enqueue(task: () => Promise<void>) {
          void task();
        }
      })() as WorkflowQueueService,
    );

    const seenChunkIndexes: number[] = [];
    let secondChunkAttempts = 0;
    vi.spyOn(chapterKeywordsLlm, 'analyzeChapterKeywordsChunk').mockImplementation(async (input) => {
      seenChunkIndexes.push(input.chunkIndex);
      if (input.chunkIndex === 0) {
        return {
          key_sentences: [
            {
              sentence_ref: { page_index: 0, paragraph_index: 0, paragraph_id: 0, sentence_id: 0 },
              sentence_text: 'Paragraph zero.',
              importance: 0.91,
              reason: 'opens the chapter',
            },
          ],
          sentence_keywords: [],
        };
      }

      secondChunkAttempts += 1;
      if (secondChunkAttempts === 1) {
        throw new Error('synthetic chunk failure');
      }

      return {
        key_sentences: [
          {
            sentence_ref: { page_index: 0, paragraph_index: 6, paragraph_id: 6, sentence_id: 0 },
            sentence_text: 'Paragraph six.',
            importance: 0.94,
            reason: 'late chapter pivot',
          },
        ],
        sentence_keywords: [],
      };
    });

    const submission = service.submitChapterKeywordsWorkflow({
      bookId: 'chunk-restart-book',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submission.workflowRunId).status).toBe('failed');
    });

    service.restartWorkflow(submission.workflowRunId, { mode: 'from_start' });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submission.workflowRunId).status).toBe('completed');
    });

    expect(seenChunkIndexes).toEqual([0, 1, 0, 1]);
  });
});
