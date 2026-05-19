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
import { validateEnvelope } from '../../packages/contracts/src';

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

  test('validates chapter keyword envelopes', async () => {
    const basePayload = {
      doc_id: 'book-1',
      chapter_id: 'chapter-1',
      chapter_index: 0,
      chunk_id: 'chunk-1',
      chunk_index: 0,
      total_chunks: 1,
      chunk_text: 'A useful sentence.',
      sentences: [
        {
          ref: {
            page_index: 0,
            paragraph_index: 0,
            paragraph_id: 1,
            sentence_id: 1,
          },
          text: 'A useful sentence.',
        },
      ],
    };

    const valid = validateEnvelope({
      api_version: 'v1',
      request_id: 'req_chapter_keywords_valid_1',
      type: 'analyze.chapter-keywords.v1',
      payload: basePayload,
      cache_hint: 'bypass',
    });
    expect(valid.ok).toBe(true);

    for (const payload of [
      { ...basePayload, chunk_id: undefined },
      { ...basePayload, sentences: [] },
      {
        ...basePayload,
        sentences: [{ ref: { ...basePayload.sentences[0].ref, sentence_id: -1 }, text: 'A useful sentence.' }],
      },
    ]) {
      const result = validateEnvelope({
        api_version: 'v1',
        request_id: `req_chapter_keywords_invalid_${Math.random()}`,
        type: 'analyze.chapter-keywords.v1',
        payload,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe('error');
        expect(result.error.error?.code).toBe('E.BAD_REQUEST');
        expect(result.error.error?.message).toBe('Invalid chapter keywords payload');
      }
    }
  });

  test('sanitizes and caches chapter keyword LLM responses', async () => {
    const payload = {
      doc_id: 'book-sanitize-1',
      chapter_id: 'chapter-sanitize-1',
      chapter_index: 0,
      chunk_id: `chunk-sanitize-${Date.now()}`,
      chunk_index: 0,
      total_chunks: 1,
      chunk_text: 'First exact sentence. Second exact sentence. Third exact sentence.',
      sentences: [
        {
          ref: { page_index: 0, paragraph_index: 0, paragraph_id: 10, sentence_id: 1 },
          text: 'First exact sentence.',
        },
        {
          ref: { page_index: 0, paragraph_index: 0, paragraph_id: 10, sentence_id: 2 },
          text: 'Second exact sentence.',
        },
        {
          ref: { page_index: 0, paragraph_index: 0, paragraph_id: 10, sentence_id: 3 },
          text: 'Third exact sentence.',
        },
      ],
    };
    const llmJson = JSON.stringify({
      key_sentences: [
        {
          sentence_ref: payload.sentences[0].ref,
          sentence_text: payload.sentences[0].text,
          importance: 1.7,
          reason: 'Core claim',
        },
        {
          sentence_ref: payload.sentences[1].ref,
          sentence_text: 'Second rewritten sentence.',
          importance: 0.5,
          reason: 'Invalid rewrite',
        },
        {
          sentence_ref: { page_index: 9, paragraph_index: 9, paragraph_id: 9, sentence_id: 9 },
          sentence_text: 'Unknown sentence.',
          importance: 0.5,
          reason: 'Unknown ref',
        },
        {
          sentence_ref: payload.sentences[2].ref,
          sentence_text: payload.sentences[2].text,
          importance: -0.25,
          reason: 123,
        },
      ],
      sentence_keywords: [
        {
          sentence_ref: payload.sentences[0].ref,
          sentence_text: payload.sentences[0].text,
          keywords: [{ word: 'First', color: 'red' }],
        },
      ],
    });
    const jsonSpy = vi.fn(async () => ({
      data: (async function* () {
        yield llmJson;
      })(),
      usage: Promise.resolve({
        modelId: 'mock-model',
        inputTokens: 11,
        outputTokens: 22,
      }),
    }));
    const createLLMClientSpy = vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: jsonSpy,
    } as never);

    const raw = JSON.stringify({
      api_version: 'v1',
      request_id: 'req_chapter_keywords_sanitize_1',
      type: 'analyze.chapter-keywords.v1',
      payload,
      cache_hint: 'prefer',
    });

    const first = await handleRawMessage(raw);
    let firstText = '';
    for await (const chunk of first.stream ?? []) {
      firstText += chunk;
    }
    const firstData = extractJsonFromText(firstText);
    expect(firstData).toMatchObject({
      key_sentences: [
        {
          sentence_ref: payload.sentences[0].ref,
          sentence_text: payload.sentences[0].text,
          importance: 1,
          reason: 'Core claim',
        },
        {
          sentence_ref: payload.sentences[2].ref,
          sentence_text: payload.sentences[2].text,
          importance: 0,
          reason: '',
        },
      ],
      sentence_keywords: [],
    });

    const second = await handleRawMessage(raw);
    let secondText = '';
    for await (const chunk of second.stream ?? []) {
      secondText += chunk;
    }

    expect(extractJsonFromText(secondText)).toMatchObject({
      request_id: 'req_chapter_keywords_sanitize_1',
      served_from: 'cache',
      data: firstData,
    });
    expect(createLLMClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      prefixCache: expect.objectContaining({
        cacheKey: expect.stringContaining('chapter_keywords.chunk_prefix:chapter_keywords.v1'),
        prefix: expect.stringContaining('Canonical chunk text:'),
        systemPromptMode: 'request',
      }),
    }));
    expect(jsonSpy.mock.calls[0]?.[0]).toContain('Sentence payload JSON:');
    expect(jsonSpy.mock.calls[0]?.[0]).not.toContain('chunk_text');
    expect(jsonSpy).toHaveBeenCalledTimes(1);
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
