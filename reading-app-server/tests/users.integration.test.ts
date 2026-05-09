import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/main';

describe('users integration', () => {
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

  test('creates anonymous user and stores reading state through raw JSON requests', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const anonymousResponse = await fetch(`${baseUrl}/v1/users/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: `device-${suffix}`,
        client: 'ios',
      }),
    });
    expect(anonymousResponse.status).toBe(201);
    const anonymousJson = await anonymousResponse.json();
    expect(anonymousJson).toMatchObject({
      deviceId: `device-${suffix}`,
      type: 'anonymous',
    });

    const restoredResponse = await fetch(`${baseUrl}/v1/users/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: `device-${suffix}`,
        client: 'ios',
      }),
    });
    expect(restoredResponse.status).toBe(201);
    expect(await restoredResponse.json()).toMatchObject({
      userId: anonymousJson.userId,
    });

    const documentResponse = await fetch(`${baseUrl}/v1/users/${anonymousJson.userId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: `doc-${suffix}`,
        sourceType: 'article',
        title: 'Integration Article',
        url: 'https://example.test/article',
      }),
    });
    expect(documentResponse.status).toBe(201);
    expect(await documentResponse.json()).toMatchObject({
      documentId: `doc-${suffix}`,
      title: 'Integration Article',
    });

    const progressResponse = await fetch(
      `${baseUrl}/v1/users/${anonymousJson.userId}/documents/doc-${suffix}/progress`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterId: 'ch-1',
          paragraphId: 'p-2',
          scrollPercent: 42,
          completedParagraphIds: ['p-1', 'p-2'],
        }),
      },
    );
    expect(progressResponse.status).toBe(200);
    expect(await progressResponse.json()).toMatchObject({
      documentId: `doc-${suffix}`,
      chapterId: 'ch-1',
      scrollPercent: 42,
      completedParagraphIds: ['p-1', 'p-2'],
    });

    const quizResponse = await fetch(`${baseUrl}/v1/users/${anonymousJson.userId}/quiz-attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: `doc-${suffix}`,
        chapterId: 'ch-1',
        score: 1,
        total: 1,
        answers: [{ questionId: 'q1', selectedOption: 0, correct: true }],
        skillBreakdown: { Facts: 1 },
      }),
    });
    expect(quizResponse.status).toBe(201);
    expect(await quizResponse.json()).toMatchObject({
      documentId: `doc-${suffix}`,
      score: 1,
      skillBreakdown: { Facts: 1 },
    });

    const annotationResponse = await fetch(`${baseUrl}/v1/users/${anonymousJson.userId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        annotationId: `ann-${suffix}`,
        documentId: `doc-${suffix}`,
        targetType: 'sentence',
        targetId: 's1',
        kind: 'bookmark',
      }),
    });
    expect(annotationResponse.status).toBe(201);
    expect(await annotationResponse.json()).toMatchObject({
      annotationId: `ann-${suffix}`,
      kind: 'bookmark',
    });

    const annotationsResponse = await fetch(
      `${baseUrl}/v1/users/${anonymousJson.userId}/annotations?documentId=doc-${suffix}&kind=bookmark`,
    );
    expect(annotationsResponse.status).toBe(200);
    expect(await annotationsResponse.json()).toMatchObject([
      {
        annotationId: `ann-${suffix}`,
        documentId: `doc-${suffix}`,
      },
    ]);
  });
});
