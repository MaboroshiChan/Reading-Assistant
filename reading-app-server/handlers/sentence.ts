import type {
  AnalyzeSentenceData,
  DependencyArc,
  ModalMarker,
  RequestEnvelopeSentence,
  ResponseEnvelopeSentence,
  SentenceRole,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import {
  hashString,
  makeAnchor,
  splitIntoSentences,
  tokenize,
} from './shared';

const CACHE_PREFIX = 'sentence';

const buildCacheKey = (req: RequestEnvelopeSentence): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

const modalMap: Record<string, ModalMarker['type']> = {
  must: 'necessity',
  should: 'necessity',
  shall: 'necessity',
  could: 'possibility',
  might: 'possibility',
  may: 'possibility',
  can: 'possibility',
  will: 'certainty',
  would: 'volition',
};

const toSentenceData = (
  req: RequestEnvelopeSentence,
): AnalyzeSentenceData => {
  const text = req.payload.sentence_text.trim();
  const tokens = tokenize(text);

  const sentenceAnchor = makeAnchor({
    sentenceId: req.payload.sentence_id,
    span: { start: 0, end: text.length },
    text,
  });

  const semantic_roles: SentenceRole[] = [];

  if (tokens[0]) {
    semantic_roles.push({
      role: 'subject',
      span: { start: tokens[0].start, end: tokens[0].end },
      anchors: [
        makeAnchor({
          sentenceId: req.payload.sentence_id,
          span: { start: tokens[0].start, end: tokens[0].end },
          text: tokens[0].token,
        }),
      ],
      confidence: 0.6,
    });
  }

  if (tokens[1]) {
    semantic_roles.push({
      role: 'predicate',
      span: { start: tokens[1].start, end: tokens[1].end },
      anchors: [
        makeAnchor({
          sentenceId: req.payload.sentence_id,
          span: { start: tokens[1].start, end: tokens[1].end },
          text: tokens[1].token,
        }),
      ],
      confidence: 0.55,
    });
  }

  if (tokens.length > 2) {
    const last = tokens[tokens.length - 1];
    semantic_roles.push({
      role: 'object',
      span: { start: last.start, end: last.end },
      anchors: [
        makeAnchor({
          sentenceId: req.payload.sentence_id,
          span: { start: last.start, end: last.end },
          text: last.token,
        }),
      ],
      confidence: 0.5,
    });
  }

  const arcs: DependencyArc[] = tokens.slice(1).map((token, index) => ({
    head: 0,
    dep: index + 1,
    label: index === 0 ? 'root' : 'modifier',
  }));

  const modal_markers: ModalMarker[] = tokens
    .map((token) => {
      const mapped = modalMap[token.token.toLowerCase()];
      if (!mapped) return null;
      return {
        type: mapped,
        span: { start: token.start, end: token.end },
        cue: token.token,
      };
    })
    .filter((marker): marker is ModalMarker => marker !== null);

  const discourse_function = (() => {
    const lowered = text.toLowerCase();
    if (lowered.includes('because')) return 'support';
    if (lowered.includes('however') || lowered.includes('but')) return 'contrast';
    if (text.endsWith('?')) return 'question';
    return 'statement';
  })();

  return {
    semantic_roles,
    discourse_function,
    dependency_light: {
      head_indexed: true,
      arcs,
    },
    modal_markers: modal_markers.length ? modal_markers : undefined,
    anchors: [
      sentenceAnchor,
      ...semantic_roles.flatMap((role) => role.anchors ?? []),
    ],
    confidence: Math.min(0.9, 0.4 + tokens.length * 0.05),
  };
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
  const data = toSentenceData(req);
  const response: ResponseEnvelopeSentence = {
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
