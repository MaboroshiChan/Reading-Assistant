"use strict";
/*
 * envelopes.ts — Client↔Service Envelope Types (v1)
 * Contract-only TypeScript types for your reading-app network layer.
 * These mirror the “Envelope v1” spec we agreed on: a unified message envelope,
 * standardized context, four analysis message types, frames for partial results,
 * error semantics, caching hints, and observability fields.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOk = exports.isError = exports.isPartial = exports.isAnalyzeType = void 0;
// -----------------------------
// Utility guards (optional)
// -----------------------------
// Quick predicate for narrowing string -> AnalyzeMessageType.
const isAnalyzeType = (t) => t === 'analyze.skeleton.v1' ||
    t === 'analyze.paragraph.v1' ||
    t === 'analyze.sentence.v1' ||
    t === 'analyze.sentence-structure.v1' ||
    t === 'analyze.quiz.v1' ||
    t === 'analyze.knowledge-extraction.v1';
exports.isAnalyzeType = isAnalyzeType;
// Type guards that help SDK callers branch on response status.
const isPartial = (r) => r.status === 'partial';
exports.isPartial = isPartial;
const isError = (r) => r.status === 'error';
exports.isError = isError;
const isOk = (r) => r.status === 'ok';
exports.isOk = isOk;
//# sourceMappingURL=envelopes.js.map