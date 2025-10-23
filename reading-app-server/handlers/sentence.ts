import type {
  AnalyzeSentenceData,
  RequestEnvelopeSentence,
  ResponseEnvelopeSentence,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { hashString } from './shared';
import { buildMockSentenceData } from './mock/sentenceMock';

const CACHE_PREFIX = 'sentence';

const buildCacheKey = (req: RequestEnvelopeSentence): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

const buildSentenceData = async (
  req: RequestEnvelopeSentence,
): Promise<AnalyzeSentenceData> => {
  if (config.useMockLLM) {
    return buildMockSentenceData(req);
  }

  // TODO: integrate with real LLM-backed sentence handler.
  return buildMockSentenceData(req);
};

export const handleSentence = async (
  req: RequestEnvelopeSentence,
): Promise<ResponseEnvelopeSentence> => {
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSentence>(cacheKey);
  if (cached) {
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const data = await buildSentenceData(req);
  const response: ResponseEnvelopeSentence = {
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
