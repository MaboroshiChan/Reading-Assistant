import type {
  AnalyzeChapterKeywordsData,
  RequestEnvelopeChapterKeywords,
  ResponseEnvelopeChapterKeywords,
} from '../../packages/contracts/src';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { extractJsonFromText, type CallReturn } from '../services/llmService';
import { buildStableCacheKey, withBufferedStream } from './shared';
import { handlerLog } from './logger';
import {
  CHAPTER_KEYWORDS_PROMPT_VERSION,
  buildChapterKeywordsCall,
  sanitizeChapterKeywords,
  toCachedResponseText,
  toLLMInputFromEnvelope,
} from '../src/modules/chapter-keywords-workflow/chapter-keywords-llm';

const CACHE_PREFIX = 'chapter-keywords';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = CHAPTER_KEYWORDS_PROMPT_VERSION;

const buildCacheKey = (req: RequestEnvelopeChapterKeywords): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.model,
  });
};

const buildChapterKeywordsData = async (
  req: RequestEnvelopeChapterKeywords,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('chapter_keywords', 'building LLM prompt', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
  });

  const llmInput = toLLMInputFromEnvelope(req);

  handlerLog('chapter_keywords', 'LLM prompt prepared', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
    systemPromptLength: 0,
    userPromptLength: 0,
  });

  return buildChapterKeywordsCall(llmInput, signal);
};

export const handleChapterKeywords = async (
  req: RequestEnvelopeChapterKeywords,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('chapter_keywords', 'request received', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
  });

  const cacheKey = buildCacheKey(req);
  const allowCache = req.cache_hint !== 'bypass';
  const cached = allowCache ? cache.get<ResponseEnvelopeChapterKeywords>(cacheKey) : undefined;
  if (cached) {
    handlerLog('chapter_keywords', 'cache hit', {
      requestId: req.request_id,
      cacheKey,
      promptVersion: PROMPT_VERSION,
    });
    const text = toCachedResponseText(cached);
    const usage = await Promise.resolve(cached.usage);
    return {
      data: (async function* () {
        yield text;
      })(),
      usage: Promise.resolve({
        modelId: usage?.model_id,
        inputTokens: usage?.tokens_in,
        outputTokens: usage?.tokens_out,
      }),
    };
  }

  const started = Date.now();
  const { data: stream, usage: usagePromise } = await buildChapterKeywordsData(req, signal);

  const sanitizedStream = (async function* () {
    try {
      let text = '';
      for await (const chunk of withBufferedStream(stream, async () => undefined)) {
        text += chunk;
      }

      const usage = await usagePromise;
      const raw = extractJsonFromText(text);
      const data = sanitizeChapterKeywords(raw, req.payload.sentences);
      const latencyMs = Date.now() - started;
      const response: ResponseEnvelopeChapterKeywords = {
        request_id: req.request_id,
        status: 'ok',
        served_from: 'fresh',
        data,
        usage: {
          latency_ms: latencyMs,
          model_id: usage?.modelId,
          tokens_in: usage?.inputTokens,
          tokens_out: usage?.outputTokens,
        },
      };
      if (allowCache) {
        cache.set(cacheKey, response, config.cacheTtlMs);
      }

      handlerLog('chapter_keywords', 'request completed', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
        latencyMs,
        keySentenceCount: data.key_sentences.length,
      });

      yield JSON.stringify(data);
    } catch (error) {
      handlerLog('chapter_keywords', 'request failed', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  })();

  return { data: sanitizedStream, usage: usagePromise };
};
