"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResponse = exports.validateEnvelope = void 0;
const isRecord = (value) => typeof value === 'object' && value !== null;
const isString = (value) => typeof value === 'string';
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNonNegativeInteger = (value) => isNumber(value) && Number.isInteger(value) && value >= 0;
const isSkeletonPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    if (!isString(payload.doc_id))
        return false;
    if (!isString(payload.content_hash))
        return false;
    if (!Array.isArray(payload.sections))
        return false;
    return payload.sections.every((section) => isRecord(section) &&
        isString(section.id) &&
        isString(section.text));
};
const isParagraphPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return (isString(payload.doc_id) &&
        isString(payload.paragraph_id) &&
        isString(payload.paragraph_text));
};
const isSentenceRef = (value) => {
    if (!isRecord(value))
        return false;
    return (isNonNegativeInteger(value.page_index) &&
        isNonNegativeInteger(value.paragraph_index) &&
        isNonNegativeInteger(value.paragraph_id) &&
        isNonNegativeInteger(value.sentence_id));
};
const isChapterKeywordsPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    if (!isString(payload.doc_id) ||
        !isString(payload.chapter_id) ||
        !isNonNegativeInteger(payload.chapter_index) ||
        !isString(payload.chunk_id) ||
        !isNonNegativeInteger(payload.chunk_index) ||
        !isNonNegativeInteger(payload.total_chunks) ||
        payload.total_chunks <= 0 ||
        !isString(payload.chunk_text) ||
        !Array.isArray(payload.sentences) ||
        payload.sentences.length === 0) {
        return false;
    }
    return payload.sentences.every((sentence) => isRecord(sentence) &&
        isSentenceRef(sentence.ref) &&
        isString(sentence.text));
};
const isSentencePayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return (isString(payload.doc_id) &&
        isString(payload.sentence_id) &&
        isString(payload.sentence_text));
};
const isSentenceStructurePayload = (payload) => {
    if (!isRecord(payload))
        return false;
    if (!isString(payload.doc_id) || !isString(payload.sentence_id))
        return false;
    if (!isRecord(payload.span))
        return false;
    const { start, end } = payload.span;
    return isNumber(start) && isNumber(end) && start >= 0 && end >= start;
};
const isQuizPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return (isString(payload.doc_id) &&
        isString(payload.article_text));
};
const isKnowledgeExtractionPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return (isString(payload.doc_id) &&
        isString(payload.chapter_id) &&
        isString(payload.chapter_text));
};
const makeError = (requestId, code, http, message) => ({
    request_id: requestId,
    status: 'error',
    error: {
        code,
        http,
        message,
    },
});
const validateEnvelope = (input) => {
    if (!isRecord(input)) {
        return {
            ok: false,
            error: makeError('unknown', 'E.BAD_REQUEST', 400, 'Request body must be a JSON object'),
        };
    }
    const { type, request_id: requestId, payload } = input;
    if (!isString(type)) {
        return {
            ok: false,
            error: makeError('unknown', 'E.BAD_REQUEST', 400, 'Missing or invalid "type"'),
        };
    }
    if (!isString(requestId)) {
        return {
            ok: false,
            error: makeError('unknown', 'E.BAD_REQUEST', 400, 'Missing or invalid "request_id"'),
        };
    }
    if (!payload) {
        return {
            ok: false,
            error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Missing "payload"'),
        };
    }
    switch (type) {
        case 'analyze.skeleton.v1':
            if (!isSkeletonPayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid skeleton payload'),
                };
            }
            return {
                ok: true,
                envelope: input,
            };
        case 'analyze.paragraph.v1':
            if (!isParagraphPayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid paragraph payload'),
                };
            }
            return {
                ok: true,
                envelope: input,
            };
        case 'analyze.chapter-keywords.v1':
            if (!isChapterKeywordsPayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid chapter keywords payload'),
                };
            }
            return {
                ok: true,
                envelope: input,
            };
        case 'analyze.sentence.v1':
            if (!isSentencePayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid sentence payload'),
                };
            }
            return {
                ok: true,
                envelope: input,
            };
        case 'analyze.sentence-structure.v1':
            if (!isSentenceStructurePayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid sentence structure payload'),
                };
            }
            return {
                ok: true,
                envelope: input,
            };
        case 'analyze.quiz.v1':
            if (!isQuizPayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid quiz payload'),
                };
            }
            return {
                ok: true,
                envelope: input,
            };
        case 'analyze.knowledge-extraction.v1':
            if (!isKnowledgeExtractionPayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid knowledge extraction payload'),
                };
            }
            return {
                ok: true,
                envelope: input,
            };
        default:
            return {
                ok: false,
                error: makeError(requestId, 'E.BAD_REQUEST', 400, `Unsupported message type "${type}"`),
            };
    }
};
exports.validateEnvelope = validateEnvelope;
exports.errorResponse = makeError;
//# sourceMappingURL=validation.js.map