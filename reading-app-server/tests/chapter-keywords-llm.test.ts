import { afterEach, describe, expect, test, vi } from 'vitest';
import * as llmService from '../services/llmService';
import { buildChapterKeywordsCall } from '../src/modules/chapter-keywords-workflow/chapter-keywords-llm';

describe('chapter keywords llm routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('uses the lite workflow model for chapter keywords generation', async () => {
    const jsonSpy = vi.fn(async () => ({
      data: (async function* () {
        yield JSON.stringify({ key_sentences: [], sentence_keywords: [] });
      })(),
      usage: Promise.resolve({}),
    }));
    const createLLMClientSpy = vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: jsonSpy,
    } as never);

    await buildChapterKeywordsCall({
      docId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chunkId: 'chunk-1',
      chunkIndex: 0,
      totalChunks: 1,
      chunkText: 'A useful sentence.',
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
      contentHash: 'hash-1',
    });

    expect(createLLMClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-flash-lite-latest',
      prefixCache: expect.objectContaining({
        cacheKey: expect.stringContaining('chapter_keywords.chunk_prefix:chapter_keywords.v1'),
        systemPromptMode: 'request',
      }),
    }));
  });
});
