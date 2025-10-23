import { afterEach, describe, expect, test, vi } from 'vitest';
import { NetworkClient } from '../../../src/services/networkClient';
import type { RequestEnvelopeSkeleton, ResponseEnvelopeSkeleton } from '../../../src/services/envelopes';

describe('NetworkClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('POSTs envelope to configured endpoint', async () => {
    const responseBody: ResponseEnvelopeSkeleton = {
      request_id: 'req-123',
      status: 'ok',
    };

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new NetworkClient({
      baseUrl: 'http://localhost:8787/', // trailing slash trimmed internally
    });

    const request: RequestEnvelopeSkeleton = {
      type: 'analyze.skeleton.v1',
      api_version: 'v1',
      request_id: 'req-123',
      locale: 'en-US',
      cache_hint: 'prefer',
      payload: {
        doc_id: 'doc-1',
        content_hash: 'hash-1',
        sections: [],
      },
      context: {
        doc: {
          doc_id: 'doc-1',
          content_hash: 'hash-1',
        },
      },
    };

    const result = await client.send<ResponseEnvelopeSkeleton>(request);

    expect(result).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error('fetch was not called');
    }
    const url = call[0];
    const init = (call[1] ?? {}) as RequestInit;
    expect(url).toBe('http://localhost:8787/msg');
    expect(init).toMatchObject({ method: 'POST' });
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-request-id': 'req-123',
    });

    expect(init.body).toBeDefined();
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toMatchObject({
      type: 'analyze.skeleton.v1',
      request_id: 'req-123',
      locale: 'en-US',
    });
  });

  test('ping hits /ping endpoint and parses response', async () => {
    const payload = { status: 'ok', serverTime: '2024-01-01T00:00:00.000Z' };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new NetworkClient({
      baseUrl: 'http://localhost:8787/',
    });

    const result = await client.ping();

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('fetch was not called');
    expect(call[0]).toBe('http://localhost:8787/ping');
    expect(call[1]).toMatchObject({ method: 'GET' });
  });
});
