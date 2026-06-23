import { afterEach, describe, expect, test, vi } from 'vitest';

const { generateContentStreamMock } = vi.hoisted(() => ({
  generateContentStreamMock: vi.fn(),
}));

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = {
      generateContentStream: generateContentStreamMock,
    };

    constructor(_options: { apiKey: string }) {}
  }

  return { GoogleGenAI };
});

import { createLLMClient, extractJsonFromText } from '../services/llmService';

describe('llmService timeout normalization', () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    generateContentStreamMock.mockReset();
    if (originalApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalApiKey;
    }
  });

  test('converts streamed AbortError timeouts into explicit timeout errors', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentStreamMock.mockResolvedValueOnce({
      async *[Symbol.asyncIterator]() {
        throw new DOMException('This operation was aborted', 'AbortError');
      },
    });

    const client = createLLMClient({
      systemPrompt: 'System prompt',
      model: 'gemini-2.5-flash-lite',
      timeoutMs: 1234,
    });

    const response = await client.json('User prompt');
    await expect((async () => {
      for await (const _chunk of response.data) {
        // no-op
      }
    })()).rejects.toThrow('LLM request timed out after 1234ms');
    await expect(response.usage).rejects.toThrow('LLM request timed out after 1234ms');
  });

  test('extractJsonFromText prefers graph-shaped embedded JSON over empty objects', () => {
    const text = [
      'Some invalid prelude',
      '{}',
      'More text',
      '{"nodes":[{"id":"p1","type":"person","label":"Alice"}],"edges":[],"evidence":[]}',
      'Trailing commentary',
    ].join('\n');

    expect(extractJsonFromText(text)).toEqual({
      nodes: [{ id: 'p1', type: 'person', label: 'Alice' }],
      edges: [],
      evidence: [],
    });
  });
});
