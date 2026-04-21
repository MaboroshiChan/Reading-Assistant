import type {
  AnalyzeSkeletonData,
  RequestEnvelopeSkeleton,
  ResponseEnvelopeSkeleton,
} from '../../packages/contracts/src';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { hashString } from './shared';
import { buildMockSkeletonData } from './mock/skeletonMock';
import { handlerLog } from './logger';
import type { CallReturn } from '../services/llmService';

const CACHE_PREFIX = 'skeleton';

/**
 * Builds a cache key for skeleton analysis requests.
 *
 * @param req - The request envelope.
 * @returns A stable cache key string.
 */
const buildCacheKey = (req: RequestEnvelopeSkeleton): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

/**
 * Orchestrates skeleton data collection. Currently defaults to mock data.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the call results.
 */
const buildSkeletonData = async (
  req: RequestEnvelopeSkeleton,
): Promise<CallReturn<string>> => {
  if (config.useMockLLM) {
    handlerLog('skeleton', 'building mock payload', {
      requestId: req.request_id,
      docId: req.payload.doc_id,
    });
    const mockData = await buildMockSkeletonData(req);
    const text = JSON.stringify(mockData);
    return {
      data: (async function* () { yield text; })(),
      usage: Promise.resolve({
        modelId: `mock:${config.model}`,
        inputTokens: 0,
        outputTokens: 0,
      }),
    };
  }

  handlerLog('skeleton', 'building LLM payload', {
    requestId: req.request_id,
    docId: req.payload.doc_id,
  });
  // TODO: integrate with real LLM-backed skeleton endpoint.
  const mockData = await buildMockSkeletonData(req);
  const text = JSON.stringify(mockData);
  return {
    data: (async function* () { yield text; })(),
    usage: Promise.resolve({
      modelId: `mock:${config.model}`,
      inputTokens: 0,
      outputTokens: 0,
    }),
  };
};

/**
 * The main handler for skeleton analysis requests.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the streaming response.
 */
export const handleSkeleton = async (
  req: RequestEnvelopeSkeleton,
): Promise<CallReturn<string>> => {
  handlerLog('skeleton', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
  });
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSkeleton>(cacheKey);
  if (cached) {
    handlerLog('skeleton', 'cache hit', { requestId: req.request_id });
    const text = JSON.stringify({ ...cached, served_from: 'cache' });
    const usage = await Promise.resolve(cached.usage);
    return {
      data: (async function* () { yield text; })(),
      usage: Promise.resolve({
        modelId: usage?.model_id,
        inputTokens: usage?.tokens_in,
        outputTokens: usage?.tokens_out,
      }),
    };
  }

  const started = Date.now();
  const { data: stream, usage: usagePromise } = await buildSkeletonData(req);

  const tappedStream = (async function* () {
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      yield chunk;
    }

    try {
      const usage = await usagePromise;
      const data = JSON.parse(text) as AnalyzeSkeletonData;

      handlerLog('skeleton', 'data prepared', {
        requestId: req.request_id,
        source: config.useMockLLM ? 'mock' : 'llm',
      });

      const response: ResponseEnvelopeSkeleton = {
        request_id: req.request_id,
        status: 'ok',
        served_from: 'fresh',
        data,
        usage: {
          latency_ms: Date.now() - started,
          model_id: usage?.modelId,
          tokens_in: usage?.inputTokens,
          tokens_out: usage?.outputTokens,
        },
      };

      cache.set(cacheKey, response, config.cacheTtlMs);
      handlerLog('skeleton', 'response cached', {
        requestId: req.request_id,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      console.warn('[skeleton] failed to cache response', error);
    }
  })();

  return { data: tappedStream, usage: usagePromise };
};
