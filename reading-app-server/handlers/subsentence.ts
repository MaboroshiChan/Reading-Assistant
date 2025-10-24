import type {
  AnalyzeSubSentenceData,
  RequestEnvelopeSubsentence,
  ResponseEnvelopeSubSentence,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { hashString } from './shared';
import { buildMockSubSentenceData } from './mock/subsentenceMock';
import { handlerLog } from './logger';

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
    handlerLog('subsentence', 'building mock payload', {
      requestId: req.request_id,
      sentenceId: req.payload.sentence_id,
    });
    return buildMockSubSentenceData(req);
  }

  handlerLog('subsentence', 'building LLM payload', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
  });
  // TODO: integrate with real LLM-backed subsentence handler.
  return buildMockSubSentenceData(req);
};

export const handleSubSentence = async (
  req: RequestEnvelopeSubsentence,
): Promise<ResponseEnvelopeSubSentence> => {
  handlerLog('subsentence', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
  });
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSubSentence>(cacheKey);
  if (cached) {
    handlerLog('subsentence', 'cache hit', { requestId: req.request_id });
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const data = await buildSubSentenceData(req);
  handlerLog('subsentence', 'data prepared', {
    requestId: req.request_id,
    source: config.useMockLLM ? 'mock' : 'llm',
  });
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
  handlerLog('subsentence', 'response cached', {
    requestId: req.request_id,
    latencyMs: Date.now() - started,
  });
  return response;
};
