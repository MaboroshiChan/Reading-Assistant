import { afterEach, describe, expect, test, vi } from 'vitest';
import MessageService from '../../../src/services/messageService';
import type { RequestEnvelopeSkeleton, ResponseEnvelopeSkeleton } from '../../../src/services/envelopes';
import NetworkClient from '../../../src/services/networkClient';
import type { NetworkClient as NetworkClientType } from '../../../src/services/networkClient';

describe('MessageService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('applies service defaults before delegating to NetworkClient', async () => {
    const response: ResponseEnvelopeSkeleton = {
      request_id: 'req-123',
      status: 'ok',
    };

    const send = vi.fn().mockResolvedValue(response);
    const fakeClient = {
      send,
      cancel: vi.fn(),
      setAuthTokenSupplier: vi.fn(),
      ping: vi.fn(),
    } as unknown as NetworkClientType;

    const service = new MessageService(fakeClient, {
      apiVersion: 'v1',
      locale: 'en-US',
      promptVersion: '2024-03-01',
      modelTier: 'high',
      defaultPriority: 'low',
      defaultCacheHint: 'only',
    });

    const envelope = {
      type: 'analyze.skeleton.v1',
      api_version: 'v1',
      request_id: 'req-123',
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
    } as RequestEnvelopeSkeleton;

    const result = await service.send<ResponseEnvelopeSkeleton>(envelope);

    expect(result).toEqual(response);
    expect(send).toHaveBeenCalledTimes(1);

    const [sentEnvelope, options] = send.mock.calls[0]!;
    expect(sentEnvelope).toBe(envelope);
    expect(options).toBeUndefined();

    expect(envelope.locale).toBe('en-US');
    expect(envelope.priority).toBe('low');
    expect(envelope.cache_hint).toBe('only');

    const context = envelope.context!;
    expect(context.prompt_version).toBe('2024-03-01');
    expect(context.quality_policy?.model_tier).toBe('high');
  });
  test('ping performs heartbeat against /ping endpoint', async () => {
    const payload = { status: 'ok', serverTime: '2024-01-01T00:00:00.000Z' };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new NetworkClient({
      baseUrl: 'http://localhost:8787/',
    });
    const service = new MessageService(client);

    const result = await service.ping();

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(url).toBe('http://localhost:8787/ping');
    expect(init).toMatchObject({ method: 'GET' });
  });
});
