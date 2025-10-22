import type {
  AnalyzeSubSentenceData,
  ContrastResolution,
  CueInteraction,
  MicroRole,
  RequestEnvelopeSubsentence,
  ResponseEnvelopeSubSentence,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import {
  clampSpan,
  hashString,
  makeAnchor,
} from './shared';

const CACHE_PREFIX = 'subsentence';

const buildCacheKey = (req: RequestEnvelopeSubsentence): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

const detectCueInteraction = (
  snippet: string,
  spanStart: number,
  spanEnd: number,
): CueInteraction => {
  const cues: string[] = [];
  const lowered = snippet.toLowerCase();
  const cueWords = ['because', 'however', 'although', 'therefore', 'but'];
  cueWords.forEach((cue) => {
    if (lowered.includes(cue)) cues.push(cue);
  });

  const relation = cues.includes('but') || cues.includes('however')
    ? 'contrast'
    : cues.includes('because')
      ? 'causal'
      : 'detail';

  return {
    cues,
    relation,
    scope: { start: spanStart, end: spanEnd },
  };
};

const detectContrast = (sentence: string | undefined): ContrastResolution | undefined => {
  if (!sentence) return undefined;
  const lowered = sentence.toLowerCase();
  const idx = lowered.indexOf(' but ');
  if (idx === -1) return undefined;
  return {
    a_span: { start: 0, end: idx },
    b_span: { start: idx + 5, end: sentence.length },
    relation: 'contrast',
  };
};

const buildSubSentenceData = (
  req: RequestEnvelopeSubsentence,
): AnalyzeSubSentenceData => {
  const { span } = req.payload;
  const boundedSpan = clampSpan(span, 0);
  const meta = req.meta as Record<string, unknown> | undefined;
  const sentenceText =
    typeof meta?.sentence_text === 'string' ? (meta.sentence_text as string) : '';
  const explicitFragment =
    typeof meta?.fragment_text === 'string' ? (meta.fragment_text as string) : undefined;
  const text =
    explicitFragment ??
    (sentenceText
      ? sentenceText.slice(boundedSpan.start, boundedSpan.end)
      : `span:${boundedSpan.start}-${boundedSpan.end}`);
  const anchor = makeAnchor({
    sentenceId: req.payload.sentence_id,
    span: boundedSpan,
    text,
  });

  const micro_roles: MicroRole[] = text
    ? [
        {
          label: text.includes(',') ? 'clause' : 'focus',
          anchors: [anchor],
          confidence: 0.6,
        },
      ]
    : [];

  const cue_interaction = detectCueInteraction(
    text,
    boundedSpan.start,
    boundedSpan.end,
  );

  const contrast_resolution = detectContrast(sentenceText);

  return {
    micro_roles,
    cue_interaction,
    contrast_resolution,
    anchors: [anchor],
    confidence: micro_roles.length ? 0.6 : 0.4,
  };
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
  const data = buildSubSentenceData(req);
  const response: ResponseEnvelopeSubSentence = {
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
