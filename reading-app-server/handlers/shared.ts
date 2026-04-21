import { createHash } from 'crypto';
import type {
  Anchor,
  AnchorSpan,
} from '../../packages/contracts/src';

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

/**
 * Generates a SHA-1 hash of the given string.
 *
 * @param value - The string to hash.
 * @returns The hex-encoded SHA-1 hash.
 */
export const hashString = (value: string): string => {
  return createHash('sha1').update(value).digest('hex');
};

/**
 * Recursively serializes an unknown value into a stable JSON-like string.
 * Objects are sorted by key to ensure consistent output for identical content.
 *
 * @param value - The value to serialize.
 * @returns A stable string representation.
 */
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

/**
 * Builds a stable cache key for a given value based on its content.
 *
 * @param prefix - A prefix for the cache key (e.g., feature name).
 * @param version - A version string to invalidate cache when logic changes.
 * @param value - The payload to hash for the key.
 * @returns A stable cache key string.
 */
export const buildStableCacheKey = (prefix: string, version: string, value: unknown): string => {
  return `${prefix}:${version}:${hashString(stableSerialize(value))}`;
};

/**
 * Sorts an array of anchors by their start and end positions.
 *
 * @param anchors - The array of anchors to sort.
 * @returns A new sorted array of anchors.
 */
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

/**
 * Summarizes text by truncating it to a maximum length while attempting to keep full words.
 *
 * @param text - The text to summarize.
 * @param maxLength - The maximum character count.
 * @returns The summarized string.
 */
export const summarize = (text: string, maxLength = 160): string => {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).replace(/\s+\S*$/, '').trim()}...`;
};

/**
 * Splits a text into sentence fragments based on punctuation.
 *
 * @param text - The text to split.
 * @returns An array of sentence fragments with text and offsets.
 */
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

/**
 * Naively tokenizes text by whitespace.
 *
 * @param text - The text to tokenize.
 * @returns An array of token fragments with text and offsets.
 */
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

/**
 * Creates an Anchor object from provided metadata and span.
 *
 * @param params - Configuration object including paragraphId, sentenceId, span, and text.
 * @returns A structured Anchor object with a content-based hash.
 */
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

/**
 * Ensures a span's indices are valid (start >= min, end >= start).
 *
 * @param span - The span to clamp.
 * @param min - The minimum allowed value (default 0).
 * @returns A sanitized AnchorSpan.
 */
export const clampSpan = (span: AnchorSpan, min = 0): AnchorSpan => {
  return {
    start: Math.max(min, span.start),
    end: Math.max(Math.max(min, span.start), span.end),
  };
};
