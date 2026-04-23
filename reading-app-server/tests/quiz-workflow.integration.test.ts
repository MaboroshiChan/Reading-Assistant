import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/main';

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('quiz workflow integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let baseUrl: string;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  test('submits a quiz workflow, completes it, and exposes status and result APIs', async () => {
    const upsertPage = await fetch(`${baseUrl}/v1/books/book-quiz/chapters/ch-quiz/pages/0`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-quiz',
        chapterId: 'ch-quiz',
        chapterIndex: 1,
        chapterTitle: 'Quiz Chapter',
        pageIndex: 0,
        sourceHash: 'page-0-v1',
        pageParagraphs: {
          '0': 'The chapter argues that careful observation matters more than quick assumptions.',
          '1': 'It illustrates the point through a sequence of examples and clarifications.',
        },
      }),
    });

    expect(upsertPage.status).toBe(201);
    const upsertJson = await upsertPage.json();

    const submitResponse = await fetch(`${baseUrl}/v1/workflows/quiz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-quiz',
        chapterId: 'ch-quiz',
        chapterIndex: 1,
        workflowVersion: 'v1',
        idempotencyKey: 'quiz-v1-book-quiz-ch-quiz',
        expectedSnapshotVersion: upsertJson.snapshotVersion,
        expectedChapterContentHash: upsertJson.chapterContentHash,
      }),
    });

    expect(submitResponse.status).toBe(201);
    const submitJson = await submitResponse.json();
    expect(submitJson).toMatchObject({
      kind: 'quiz_generation',
      bookId: 'book-quiz',
      chapterId: 'ch-quiz',
      chapterIndex: 1,
      workflowVersion: 'v1',
      producer: 'server',
      qualityTier: 'server_final',
      deduped: false,
    });

    const workflowRunId = submitJson.workflowRunId as string;
    expect(typeof workflowRunId).toBe('string');
    expect(workflowRunId.length).toBeGreaterThan(10);

    let statusJson: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await fetch(`${baseUrl}/v1/workflows/quiz/${workflowRunId}`);
      expect(statusResponse.status).toBe(200);
      statusJson = await statusResponse.json();
      if (statusJson.status === 'completed') break;
      await sleep(10);
    }

    expect(statusJson).toMatchObject({
      workflowRunId,
      kind: 'quiz_generation',
      status: 'completed',
      resultAvailable: true,
      chapterContentHash: upsertJson.chapterContentHash,
      snapshotVersion: upsertJson.snapshotVersion,
    });

    const dedupedSubmitResponse = await fetch(`${baseUrl}/v1/workflows/quiz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-quiz',
        chapterId: 'ch-quiz',
        chapterIndex: 1,
        workflowVersion: 'v1',
        idempotencyKey: 'quiz-v1-book-quiz-ch-quiz',
      }),
    });

    expect(dedupedSubmitResponse.status).toBe(201);
    const dedupedJson = await dedupedSubmitResponse.json();
    expect(dedupedJson).toMatchObject({
      workflowRunId,
      deduped: true,
    });

    const resultResponse = await fetch(`${baseUrl}/v1/workflows/quiz/${workflowRunId}/result`);
    expect(resultResponse.status).toBe(200);
    const resultJson = await resultResponse.json();
    expect(resultJson).toMatchObject({
      workflowRunId,
      kind: 'quiz_generation',
      bookId: 'book-quiz',
      chapterId: 'ch-quiz',
      chapterIndex: 1,
      workflowVersion: 'v1',
      producer: 'server',
      qualityTier: 'server_final',
      chapterContentHash: upsertJson.chapterContentHash,
      snapshotVersion: upsertJson.snapshotVersion,
    });
    expect(Array.isArray(resultJson.result.questions)).toBe(true);
    expect(resultJson.result.questions.length).toBeGreaterThan(0);
    expect(resultJson.result.questions[0]).toMatchObject({
      type: 'multiple_choice',
      skill: 'Facts',
    });

    const latestResponse = await fetch(`${baseUrl}/v1/books/book-quiz/chapters/ch-quiz/quiz`);
    expect(latestResponse.status).toBe(200);
    const latestJson = await latestResponse.json();
    expect(latestJson).toMatchObject({
      workflowRunId,
      bookId: 'book-quiz',
      chapterId: 'ch-quiz',
      chapterIndex: 1,
      chapterContentHash: upsertJson.chapterContentHash,
      snapshotVersion: upsertJson.snapshotVersion,
    });
  });
});
