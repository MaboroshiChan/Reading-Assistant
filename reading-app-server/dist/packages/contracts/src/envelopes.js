"use strict";
/*
 * Shared request/response contracts for the reading-app server message endpoints.
 * These types intentionally stay close to the existing Swift envelope contract.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOk = exports.isError = exports.isPartial = exports.isAnalyzeType = void 0;
const isAnalyzeType = (t) => t === 'analyze.skeleton.v1' ||
    t === 'analyze.paragraph.v1' ||
    t === 'analyze.sentence.v1' ||
    t === 'analyze.sentence-structure.v1' ||
    t === 'analyze.quiz.v1' ||
    t === 'analyze.knowledge-extraction.v1';
exports.isAnalyzeType = isAnalyzeType;
const isPartial = (r) => r.status === 'partial';
exports.isPartial = isPartial;
const isError = (r) => r.status === 'error';
exports.isError = isError;
const isOk = (r) => r.status === 'ok';
exports.isOk = isOk;
//# sourceMappingURL=envelopes.js.map