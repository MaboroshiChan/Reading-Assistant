import { afterEach, describe, expect, test, vi } from 'vitest';
import { extractJsonFromText } from '../services/llmService';
import * as llmService from '../services/llmService';
import {
  dispatchEnvelope,
  handleRawMessage,
  handleRawStream,
} from '../src/message/message.service';
import { handleMsg } from '../http/router';
import { createAbortError } from '../src/utils/abort';

describe('message service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  test('passes AbortSignal through to llm-backed handlers and preserves abort semantics', async () => {
    const signal = AbortSignal.abort(createAbortError('test abort'));
    const jsonSpy = vi.fn(async (_userPrompt: string, opts?: { signal?: AbortSignal }) => {
      expect(opts?.signal).toBe(signal);
      throw createAbortError('test abort');
    });
    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: jsonSpy,
    } as never);

    const raw = JSON.stringify({
      api_version: 'v1',
      request_id: 'req_quiz_abort_1',
      type: 'analyze.quiz.v1',
      payload: {
        doc_id: 'doc-abort-1',
        article_text: 'Abort propagation test.',
      },
      cache_hint: 'bypass',
    });

    await expect(handleRawMessage(raw, signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(jsonSpy).toHaveBeenCalledOnce();
  });

  test('does not cache a streamed handler result when consumption stops early', async () => {
    const articleText = `partial-stream-${Date.now()}`;
    const json = JSON.stringify({
      questions: [
        {
          id: 'q1',
          question: 'Question?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswerIndex: 0,
          explanation: 'Explanation.',
          skill: 'Facts',
        },
      ],
    });
    const jsonSpy = vi.fn(async () => ({
      data: (async function* () {
        yield json.slice(0, Math.ceil(json.length / 2));
        yield json.slice(Math.ceil(json.length / 2));
      })(),
      usage: Promise.resolve({
        modelId: 'mock-model',
        inputTokens: 1,
        outputTokens: 1,
      }),
    }));
    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: jsonSpy,
    } as never);

    const raw = JSON.stringify({
      api_version: 'v1',
      request_id: 'req_quiz_partial_1',
      type: 'analyze.quiz.v1',
      payload: {
        doc_id: 'doc-partial-1',
        article_text: articleText,
      },
      cache_hint: 'bypass',
    });

    const first = await handleRawMessage(raw);
    expect(first.status).toBe('ok');
    for await (const _chunk of first.stream ?? []) {
      break;
    }

    const second = await handleRawMessage(raw);
    let secondText = '';
    for await (const chunk of second.stream ?? []) {
      secondText += chunk;
    }

    const third = await handleRawMessage(raw);
    let thirdText = '';
    for await (const chunk of third.stream ?? []) {
      thirdText += chunk;
    }

    expect(extractJsonFromText(secondText)).toMatchObject({
      questions: [expect.objectContaining({ id: 'q1' })],
    });
    expect(extractJsonFromText(thirdText)).toMatchObject({
      request_id: 'req_quiz_partial_1',
      served_from: 'cache',
    });
    expect(jsonSpy).toHaveBeenCalledTimes(2);
  });
});
