import { describe, expect, test, vi } from 'vitest';
import MessageService from '../../services/messageService';
import type { RequestEnvelopeSkeleton, ResponseEnvelopeSkeleton } from '../../services/envelopes';
import type { NetworkClient } from '../../services/networkClient';

describe('MessageService', () => {
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
    } as unknown as NetworkClient;

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
});
