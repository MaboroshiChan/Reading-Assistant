import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/main';

describe('book ingestion integration', () => {
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

  test('uploads a new page, materializes chapter text, and exposes read APIs', async () => {
    const firstUpload = await fetch(`${baseUrl}/v1/books/book-1/chapters/ch-1/pages/2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-1',
        chapterId: 'ch-1',
        chapterIndex: 3,
        chapterTitle: 'Chapter Three',
        pageIndex: 2,
        sourceHash: 'hash-page-2-v1',
        pageParagraphs: {
          '10': 'tenth paragraph',
          '2': 'second paragraph',
          appendix: 'appendix paragraph',
        },
        bookMetadata: {
          title: 'Example Book',
        },
      }),
    });

    expect(firstUpload.status).toBe(201);
    expect(await firstUpload.json()).toMatchObject({
      bookId: 'book-1',
      chapterId: 'ch-1',
      chapterIndex: 3,
      pageIndex: 2,
      sourceHash: 'hash-page-2-v1',
      deduped: false,
      snapshotVersion: 1,
      pageCountInChapter: 1,
      chapterTextAvailable: true,
    });

    const duplicateUpload = await fetch(`${baseUrl}/v1/books/book-1/chapters/ch-1/pages/2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-1',
        chapterId: 'ch-1',
        chapterIndex: 3,
        chapterTitle: 'Chapter Three',
        pageIndex: 2,
        sourceHash: 'hash-page-2-v1',
        pageParagraphs: {
          '10': 'tenth paragraph',
          '2': 'second paragraph',
          appendix: 'appendix paragraph',
        },
      }),
    });

    expect(duplicateUpload.status).toBe(201);
    expect(await duplicateUpload.json()).toMatchObject({
      deduped: true,
      snapshotVersion: 1,
      pageCountInChapter: 1,
    });

    const secondPageUpload = await fetch(`${baseUrl}/v1/books/book-1/chapters/ch-1/pages/4`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-1',
        chapterId: 'ch-1',
        chapterIndex: 3,
        chapterTitle: 'Chapter Three',
        pageIndex: 4,
        sourceHash: 'hash-page-4-v1',
        pageParagraphs: {
          '1': 'later page paragraph',
        },
      }),
    });

    const secondPageJson = await secondPageUpload.json();
    expect(secondPageUpload.status).toBe(201);
    expect(secondPageJson).toMatchObject({
      deduped: false,
      snapshotVersion: 2,
      pageCountInChapter: 2,
      chapterTextAvailable: true,
    });
    expect(typeof secondPageJson.chapterContentHash).toBe('string');
    expect(secondPageJson.chapterContentHash.length).toBeGreaterThan(0);

    const changedPageUpload = await fetch(`${baseUrl}/v1/books/book-1/chapters/ch-1/pages/2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-1',
        chapterId: 'ch-1',
        chapterIndex: 3,
        chapterTitle: 'Chapter Three',
        pageIndex: 2,
        sourceHash: 'hash-page-2-v2',
        pageParagraphs: {
          '2': 'second paragraph updated',
          '3': 'third paragraph added',
        },
      }),
    });

    const changedPageJson = await changedPageUpload.json();
    expect(changedPageUpload.status).toBe(201);
    expect(changedPageJson).toMatchObject({
      deduped: false,
      snapshotVersion: 3,
      pageCountInChapter: 2,
      sourceHash: 'hash-page-2-v2',
    });

    const chapterResponse = await fetch(`${baseUrl}/v1/books/book-1/chapters/ch-1`);
    const chapterJson = await chapterResponse.json();
    expect(chapterResponse.status).toBe(200);
    expect(chapterJson).toMatchObject({
      bookId: 'book-1',
      chapterId: 'ch-1',
      chapterIndex: 3,
      chapterTitle: 'Chapter Three',
      snapshotVersion: 3,
      pageCount: 2,
      chapterContentHash: changedPageJson.chapterContentHash,
      chapterTextAvailable: true,
    });

    const pageResponse = await fetch(`${baseUrl}/v1/books/book-1/chapters/ch-1/pages/2`);
    const pageJson = await pageResponse.json();
    expect(pageResponse.status).toBe(200);
    expect(pageJson).toMatchObject({
      bookId: 'book-1',
      chapterId: 'ch-1',
      chapterIndex: 3,
      pageIndex: 2,
      sourceHash: 'hash-page-2-v2',
      snapshotVersion: 3,
    });
    expect(pageJson.pageTextMaterialized).toBe('second paragraph updated\n\nthird paragraph added');
    expect(pageJson.pageParagraphs).toEqual({
      '2': 'second paragraph updated',
      '3': 'third paragraph added',
    });

    const modelResponse = await fetch(`${baseUrl}/v1/books/book-1/model`);
    const modelJson = await modelResponse.json();
    expect(modelResponse.status).toBe(200);
    expect(modelJson).toMatchObject({
      bookId: 'book-1',
      meta: {
        title: 'Example Book',
        totalChapters: 1,
      },
      chapters: [
        expect.objectContaining({
          chapterId: 'ch-1',
          chapterIndex: 3,
          title: 'Chapter Three',
        }),
      ],
      keyInformation: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
        arcs: [],
        ideaFlows: [],
        links: [],
      },
    });

    const pingResponse = await fetch(`${baseUrl}/ping`);
    expect(pingResponse.status).toBe(200);
    expect(await pingResponse.json()).toMatchObject({ status: 'ok' });
  });

  test('rejects path and body mismatches with 400', async () => {
    const response = await fetch(`${baseUrl}/v1/books/book-a/chapters/ch-a/pages/1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookId: 'book-a',
        chapterId: 'ch-a',
        chapterIndex: 0,
        pageIndex: 2,
        sourceHash: 'hash',
        pageParagraphs: {
          '0': 'paragraph',
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      statusCode: 400,
      message: 'Path pageIndex does not match body pageIndex',
    });
  });
});
