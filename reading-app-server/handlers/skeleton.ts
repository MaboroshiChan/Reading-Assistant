import type {
  AnalyzeSkeletonData,
  RequestEnvelopeSkeleton,
  ResponseEnvelopeSkeleton,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { hashString } from './shared';
import { buildMockSkeletonData } from './mock/skeletonMock';

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
    return buildMockSkeletonData(req);
  }

  // TODO: integrate with real LLM-backed skeleton endpoint.
  return buildMockSkeletonData(req);
};

export const handleSkeleton = async (
  req: RequestEnvelopeSkeleton,
): Promise<ResponseEnvelopeSkeleton> => {
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSkeleton>(cacheKey);
  if (cached) {
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const data = await buildSkeletonData(req);

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
  return response;
};
