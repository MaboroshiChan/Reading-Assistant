"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clampSpan = exports.makeAnchor = exports.tokenize = exports.splitIntoSentences = exports.summarize = exports.sortAnchors = exports.withBufferedStream = exports.buildStableCacheKey = exports.hashString = void 0;
const crypto_1 = require("crypto");
/**
 * Generates a SHA-1 hash of the given string.
 *
 * @param value - The string to hash.
 * @returns The hex-encoded SHA-1 hash.
 */
const hashString = (value) => {
    return (0, crypto_1.createHash)('sha1').update(value).digest('hex');
};
exports.hashString = hashString;
/**
 * Recursively serializes an unknown value into a stable JSON-like string.
 * Objects are sorted by key to ensure consistent output for identical content.
 *
 * @param value - The value to serialize.
 * @returns A stable string representation.
 */
const stableSerialize = (value) => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
    }
    const entries = Object.entries(value)
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
const buildStableCacheKey = (prefix, version, value) => {
    return `${prefix}:${version}:${(0, exports.hashString)(stableSerialize(value))}`;
};
exports.buildStableCacheKey = buildStableCacheKey;
const withBufferedStream = (stream, finalize) => (async function* () {
    let text = '';
    let completed = false;
    try {
        for await (const chunk of stream) {
            text += chunk;
            yield chunk;
        }
        completed = true;
    }
    finally {
        await finalize({ text, completed });
    }
})();
exports.withBufferedStream = withBufferedStream;
/**
 * Sorts an array of anchors by their start and end positions.
 *
 * @param anchors - The array of anchors to sort.
 * @returns A new sorted array of anchors.
 */
const sortAnchors = (anchors) => {
    return anchors
        .slice()
        .sort((a, b) => {
        const aStart = a.span?.start ?? 0;
        const bStart = b.span?.start ?? 0;
        if (aStart !== bStart)
            return aStart - bStart;
        const aEnd = a.span?.end ?? 0;
        const bEnd = b.span?.end ?? 0;
        return aEnd - bEnd;
    });
};
exports.sortAnchors = sortAnchors;
/**
 * Summarizes text by truncating it to a maximum length while attempting to keep full words.
 *
 * @param text - The text to summarize.
 * @param maxLength - The maximum character count.
 * @returns The summarized string.
 */
const summarize = (text, maxLength = 160) => {
    const trimmed = text.trim();
    if (trimmed.length <= maxLength)
        return trimmed;
    return `${trimmed.slice(0, maxLength).replace(/\s+\S*$/, '').trim()}...`;
};
exports.summarize = summarize;
/**
 * Splits a text into sentence fragments based on punctuation.
 *
 * @param text - The text to split.
 * @returns An array of sentence fragments with text and offsets.
 */
const splitIntoSentences = (text) => {
    const fragments = [];
    const regex = /[^.!?。！？]+(?:[.!?。！？]+|$)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const raw = match[0];
        const cleaned = raw.trim();
        if (!cleaned)
            continue;
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
exports.splitIntoSentences = splitIntoSentences;
/**
 * Naively tokenizes text by whitespace.
 *
 * @param text - The text to tokenize.
 * @returns An array of token fragments with text and offsets.
 */
const tokenize = (text) => {
    const fragments = [];
    text.replace(/\S+/g, (token, offset) => {
        fragments.push({
            token,
            start: offset,
            end: offset + token.length,
        });
        return token;
    });
    return fragments;
};
exports.tokenize = tokenize;
/**
 * Creates an Anchor object from provided metadata and span.
 *
 * @param params - Configuration object including paragraphId, sentenceId, span, and text.
 * @returns A structured Anchor object with a content-based hash.
 */
const makeAnchor = (params) => {
    const { paragraphId, sentenceId, span, text } = params;
    const { start, end } = span;
    return {
        paragraph_id: paragraphId,
        sentence_id: sentenceId,
        span: { start, end },
        anchor_hash: (0, exports.hashString)(`${paragraphId ?? ''}:${sentenceId ?? ''}:${start}:${end}:${text}`),
    };
};
exports.makeAnchor = makeAnchor;
/**
 * Ensures a span's indices are valid (start >= min, end >= start).
 *
 * @param span - The span to clamp.
 * @param min - The minimum allowed value (default 0).
 * @returns A sanitized AnchorSpan.
 */
const clampSpan = (span, min = 0) => {
    return {
        start: Math.max(min, span.start),
        end: Math.max(Math.max(min, span.start), span.end),
    };
};
exports.clampSpan = clampSpan;
//# sourceMappingURL=shared.js.map