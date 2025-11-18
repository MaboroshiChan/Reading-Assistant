import { createHash } from 'crypto';
import type {
  Anchor,
  AnchorSpan,
} from '../../reading-app/src/services/envelopes';

export interface SentenceFragment {
  text: string;
  start: number;
  end: number;
}

export interface TokenFragment {
  token: string;
  start: number;
  end: number;
}

export const hashString = (value: string): string => {
  return createHash('sha1').update(value).digest('hex');
};

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => `${JSON.stringify(key)}:${stableSerialize(v)}`);
  return `{${entries.join(',')}}`;
};

export const buildStableCacheKey = (prefix: string, version: string, value: unknown): string => {
  return `${prefix}:${version}:${hashString(stableSerialize(value))}`;
};

export const sortAnchors = (anchors: Anchor[]): Anchor[] => {
  return anchors
    .slice()
    .sort((a, b) => {
      const aStart = a.span?.start ?? 0;
      const bStart = b.span?.start ?? 0;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = a.span?.end ?? 0;
      const bEnd = b.span?.end ?? 0;
      return aEnd - bEnd;
    });
};

export const summarize = (text: string, maxLength = 160): string => {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).replace(/\s+\S*$/, '').trim()}...`;
};

export const splitIntoSentences = (text: string): SentenceFragment[] => {
  const fragments: SentenceFragment[] = [];
  const regex = /[^.!?。！？]+(?:[.!?。！？]+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const cleaned = raw.trim();
    if (!cleaned) continue;
    const offset = raw.indexOf(cleaned);
    const start = match.index + offset;
    const end = start + cleaned.length;
    fragments.push({ text: cleaned, start, end });
  }
  if (fragments.length === 0 && text.trim()) {
    const cleaned = text.trim();
    fragments.push({ text: cleaned, start: 0, end: cleaned.length });
  }
  return fragments;
};

export const tokenize = (text: string): TokenFragment[] => {
  const fragments: TokenFragment[] = [];
  text.replace(/\S+/g, (token, offset) => {
    fragments.push({
      token,
      start: offset as number,
      end: (offset as number) + token.length,
    });
    return token;
  });
  return fragments;
};

export const makeAnchor = (params: {
  paragraphId?: string;
  sentenceId?: string;
  span: AnchorSpan;
  text: string;
}): Anchor => {
  const { paragraphId, sentenceId, span, text } = params;
  const { start, end } = span;
  return {
    paragraph_id: paragraphId,
    sentence_id: sentenceId,
    span: { start, end },
    anchor_hash: hashString(
      `${paragraphId ?? ''}:${sentenceId ?? ''}:${start}:${end}:${text}`
    ),
  };
};

export const clampSpan = (span: AnchorSpan, min = 0): AnchorSpan => {
  return {
    start: Math.max(min, span.start),
    end: Math.max(Math.max(min, span.start), span.end),
  };
};
