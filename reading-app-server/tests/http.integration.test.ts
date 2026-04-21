import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.TEST_BASE_URL ?? process.env.LIVE_SERVER_URL;

const makeParagraphEnvelope = () => ({
  api_version: 'v1' as const,
  request_id: `req_${randomUUID()}`,
  type: 'analyze.paragraph.v1' as const,
  payload: {
    doc_id: 'doc-test',
    paragraph_id: 'p-1',
    paragraph_text: 'Nest keeps the public contract stable while the backend host changes.',
  },
  context: {
    doc: {
      doc_id: 'doc-test',
      content_hash: 'hash-doc-test',
    },
  },
});

const makeSentenceEnvelope = () => ({
  api_version: 'v1' as const,
  request_id: `req_${randomUUID()}`,
  type: 'analyze.sentence.v1' as const,
  payload: {
    doc_id: 'doc-test',
    sentence_id: 's-1',
    sentence_text: 'Refactoring the server should not break the frontend contract.',
  },
  context: {
    doc: {
      doc_id: 'doc-test',
      content_hash: 'hash-doc-test',
    },
  },
});

if (!baseUrl) {
  describe.skip('reading-app-server http integration', () => {
    test.skip('requires TEST_BASE_URL or LIVE_SERVER_URL', () => {});
  });
} else {
  describe('reading-app-server http integration', () => {
    test('GET /ping returns the health payload', async () => {
      const response = await fetch(`${baseUrl}/ping`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'ok',
      });
    });

    test('POST /msg returns buffered envelopes and serves cached results on repeat', async () => {
      const envelope = makeSentenceEnvelope();

      const firstResponse = await fetch(`${baseUrl}/msg`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelope),
      });
      const firstJson = await firstResponse.json();

      expect(firstResponse.status).toBe(200);
      expect(firstJson.status).toBe('ok');
      expect(firstJson.served_from).toBe('fresh');
      expect(firstJson.data?.semantic_roles?.length ?? 0).toBeGreaterThan(0);

      const cachedResponse = await fetch(`${baseUrl}/msg`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelope),
      });
      const cachedJson = await cachedResponse.json();

      expect(cachedResponse.status).toBe(200);
      expect(cachedJson.status).toBe('ok');
      expect(cachedJson.served_from).toBe('cache');
    });

    test('POST /stream returns raw JSON chunks that assemble into analysis data', async () => {
      const response = await fetch(`${baseUrl}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(makeParagraphEnvelope()),
      });

      expect(response.status).toBe(200);
      const text = await response.text();
      const parsed = JSON.parse(text);

      expect(parsed.summary).toBeTruthy();
      expect(parsed.roles?.length ?? 0).toBeGreaterThan(0);
    });

    test('POST /msg preserves the existing invalid JSON error envelope', async () => {
      const response = await fetch(`${baseUrl}/msg`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"broken":',
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json).toMatchObject({
        request_id: 'unknown',
        status: 'error',
        error: {
          code: 'E.BAD_REQUEST',
          http: 400,
        },
      });
    });
  });
}
