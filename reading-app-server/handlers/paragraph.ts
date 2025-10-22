import type {
  AnalyzeParagraphData,
  ParagraphClaim,
  ParagraphRole,
  ParagraphRhetoric,
  RequestEnvelopeParagraph,
  ResponseEnvelopeParagraph,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import {
  hashString,
  makeAnchor,
  splitIntoSentences,
  summarize,
} from './shared';

const CACHE_PREFIX = 'paragraph';

const buildCacheKey = (req: RequestEnvelopeParagraph): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const optionsKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${optionsKey}`;
};

const buildParagraphData = (
  req: RequestEnvelopeParagraph,
): AnalyzeParagraphData => {
  const text = req.payload.paragraph_text.trim();
  const fragments = splitIntoSentences(text);

  const paragraphAnchor = makeAnchor({
    paragraphId: req.payload.paragraph_id,
    span: { start: 0, end: text.length },
    text,
  });

  const roles: ParagraphRole[] = fragments.map((fragment, index) => ({
    role: index === 0 ? 'topic' : 'support',
    anchors: [
      makeAnchor({
        paragraphId: req.payload.paragraph_id,
        span: { start: fragment.start, end: fragment.end },
        text: fragment.text,
      }),
    ],
    confidence: index === 0 ? 0.7 : 0.5,
  }));

  const rhetoric: ParagraphRhetoric[] = [
    {
      label: text.includes('?') ? 'question' : 'statement',
      evidence_anchors: [paragraphAnchor],
      confidence: 0.5,
    },
  ];

  const claims: ParagraphClaim[] = [
    {
      text: fragments[0]?.text ?? text,
      polarity: 'pos',
      support: 'strong',
      anchors: fragments.slice(0, 1).map((fragment) =>
        makeAnchor({
          paragraphId: req.payload.paragraph_id,
          span: { start: fragment.start, end: fragment.end },
          text: fragment.text,
        }),
      ),
    },
  ];

  return {
    summary: summarize(text),
    roles,
    rhetoric,
    claims,
    anchors: [paragraphAnchor],
    confidence: 0.6,
  };
};

export const handleParagraph = async (
  req: RequestEnvelopeParagraph,
): Promise<ResponseEnvelopeParagraph> => {
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeParagraph>(cacheKey);
  if (cached) {
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const data = buildParagraphData(req);
  const response: ResponseEnvelopeParagraph = {
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
