import type {
  AnalyzeSkeletonData,
  RequestEnvelopeSkeleton,
  ResponseEnvelopeSkeleton,
  SkeletonParagraph,
  SkeletonSentence,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import {
  hashString,
  splitIntoSentences,
  summarize,
} from './shared';

const CACHE_PREFIX = 'skeleton';

const buildCacheKey = (req: RequestEnvelopeSkeleton): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

const buildSkeletonData = (
  req: RequestEnvelopeSkeleton,
): AnalyzeSkeletonData => {
  const paragraphs: SkeletonParagraph[] = [];
  const sentences: SkeletonSentence[] = [];

  req.payload.sections.forEach((section, sectionIndex) => {
    const text = (section.text ?? '').trim();
    if (!text) return;

    const paragraphId = section.id || `section-${sectionIndex + 1}`;
    const fragments = splitIntoSentences(text);
    const sentenceIds: string[] = [];

    fragments.forEach((fragment, idx) => {
      const sentenceId = `${paragraphId}-s${idx + 1}`;
      sentenceIds.push(sentenceId);
      sentences.push({
        sentence_id: sentenceId,
        paragraph_id: paragraphId,
        text: fragment.text,
        text_hash: hashString(fragment.text),
        char_start: fragment.start,
        char_end: fragment.end,
      });
    });

    paragraphs.push({
      paragraph_id: paragraphId,
      text_hash: hashString(text),
      sentence_ids: sentenceIds,
      brief_summary: summarize(fragments[0]?.text ?? text, 200),
    });
  });

  return {
    paragraphs,
    sentences,
  };
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
  const data = buildSkeletonData(req);

  const response: ResponseEnvelopeSkeleton = {
    request_id: req.request_id,
    status: 'ok',
    served_from: 'fresh',
    data,
    usage: {
      latency_ms: Date.now() - started,
    },
  };

  cache.set(cacheKey, response, config.cacheTtlMs);
  return response;
};
