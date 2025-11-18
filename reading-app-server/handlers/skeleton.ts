import type {
  AnalyzeSkeletonData,
  RequestEnvelopeSkeleton,
  ResponseEnvelopeSkeleton,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { hashString } from './shared';
import { buildMockSkeletonData } from './mock/skeletonMock';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'skeleton';

const buildCacheKey = (req: RequestEnvelopeSkeleton): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

const buildSkeletonData = async (
  req: RequestEnvelopeSkeleton,
): Promise<AnalyzeSkeletonData> => {
  if (config.useMockLLM) {
    handlerLog('skeleton', 'building mock payload', {
      requestId: req.request_id,
      docId: req.payload.doc_id,
    });
    return buildMockSkeletonData(req);
  }

  handlerLog('skeleton', 'building LLM payload', {
    requestId: req.request_id,
    docId: req.payload.doc_id,
  });
  // TODO: integrate with real LLM-backed skeleton endpoint.
  return buildMockSkeletonData(req);
};

export const handleSkeleton = async (
  req: RequestEnvelopeSkeleton,
): Promise<ResponseEnvelopeSkeleton> => {
  handlerLog('skeleton', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
  });
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSkeleton>(cacheKey);
  if (cached) {
    handlerLog('skeleton', 'cache hit', { requestId: req.request_id });
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const data = await buildSkeletonData(req);
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
      model_id: config.useMockLLM ? `mock:${config.model}` : undefined,
      tokens_in: config.useMockLLM ? 0 : undefined,
      tokens_out: config.useMockLLM ? 0 : undefined,
    },
  };

  cache.set(cacheKey, response, config.cacheTtlMs);
  handlerLog('skeleton', 'response cached', {
    requestId: req.request_id,
    latencyMs: Date.now() - started,
  });
  return response;
};
