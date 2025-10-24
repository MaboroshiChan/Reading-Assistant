import type {
  AnalyzeSentenceData,
  RequestEnvelopeSentence,
  ResponseEnvelopeSentence,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { hashString } from './shared';
import { buildMockSentenceData } from './mock/sentenceMock';
import { handlerLog } from './logger';

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
    handlerLog('sentence', 'building mock payload', {
      requestId: req.request_id,
      sentenceId: req.payload.sentence_id,
    });
    return buildMockSentenceData(req);
  }

  handlerLog('sentence', 'building LLM payload', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
  });
  // TODO: integrate with real LLM-backed sentence handler.
  return buildMockSentenceData(req);
};

export const handleSentence = async (
  req: RequestEnvelopeSentence,
): Promise<ResponseEnvelopeSentence> => {
  handlerLog('sentence', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
  });
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSentence>(cacheKey);
  if (cached) {
    handlerLog('sentence', 'cache hit', { requestId: req.request_id });
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const data = await buildSentenceData(req);
  handlerLog('sentence', 'data prepared', {
    requestId: req.request_id,
    source: config.useMockLLM ? 'mock' : 'llm',
  });
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
  handlerLog('sentence', 'response cached', {
    requestId: req.request_id,
    latencyMs: Date.now() - started,
  });
  return response;
};
