import type {
  AnalyzeSubSentenceData,
  RequestEnvelopeSubsentence,
  ResponseEnvelopeSubSentence,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { hashString } from './shared';
import { buildMockSubSentenceData } from './mock/subsentenceMock';

const CACHE_PREFIX = 'subsentence';

const buildCacheKey = (req: RequestEnvelopeSubsentence): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

const buildSubSentenceData = async (
  req: RequestEnvelopeSubsentence,
): Promise<AnalyzeSubSentenceData> => {
  if (config.useMockLLM) {
    return buildMockSubSentenceData(req);
  }

  // TODO: integrate with real LLM-backed subsentence handler.
  return buildMockSubSentenceData(req);
};

export const handleSubSentence = async (
  req: RequestEnvelopeSubsentence,
): Promise<ResponseEnvelopeSubSentence> => {
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSubSentence>(cacheKey);
  if (cached) {
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const data = await buildSubSentenceData(req);
  const response: ResponseEnvelopeSubSentence = {
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
