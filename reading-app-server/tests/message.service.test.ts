import { describe, expect, test } from 'vitest';
import { extractJsonFromText } from '../services/llmService';
import {
  dispatchEnvelope,
  handleRawMessage,
  handleRawStream,
} from '../src/message/message.service';
import { handleMsg } from '../http/router';

describe('message service', () => {
  test('returns a bad request envelope for invalid JSON', async () => {
    const result = await handleRawMessage('{not json');

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('E.BAD_REQUEST');
    expect(result.error?.http).toBe(400);
  });

  test('dispatches skeleton requests from the Nest message service', async () => {
    const result = await dispatchEnvelope({
      api_version: 'v1',
      request_id: 'req_skeleton_1',
      type: 'analyze.skeleton.v1',
      payload: {
        doc_id: 'doc-1',
        content_hash: 'hash-1',
        sections: [{ id: 's1', text: 'First sentence. Second sentence.' }],
      },
      cache_hint: 'bypass',
    });

    expect(result.status).toBe('ok');
    expect(result.stream).toBeDefined();

    let text = '';
    for await (const chunk of result.stream ?? []) {
      text += chunk;
    }

    const parsed = extractJsonFromText(text) as {
      paragraphs?: unknown[];
      sentences?: unknown[];
    };
    expect(parsed.paragraphs).toHaveLength(1);
    expect(parsed.sentences).toHaveLength(2);
  });

  test('keeps the router compatibility wrapper aligned with the Nest service', async () => {
    const raw = JSON.stringify({
      api_version: 'v1',
      request_id: 'req_skeleton_2',
      type: 'analyze.skeleton.v1',
      payload: {
        doc_id: 'doc-2',
        content_hash: 'hash-2',
        sections: [{ id: 's1', text: 'Only one sentence.' }],
      },
      cache_hint: 'bypass',
    });

    const [serviceResult, routerResult, streamResult] = await Promise.all([
      handleRawMessage(raw),
      handleMsg(raw),
      handleRawStream(raw),
    ]);

    expect(serviceResult.status).toBe('ok');
    expect(routerResult.status).toBe('ok');
    expect(streamResult.status).toBe('ok');
    expect(serviceResult.request_id).toBe(routerResult.request_id);
    expect(streamResult.request_id).toBe(serviceResult.request_id);
  });
});
