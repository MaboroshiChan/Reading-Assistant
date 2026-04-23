"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResponse = exports.validateEnvelope = void 0;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNonEmptyString = (value) => isString(value) && value.trim().length > 0;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const makeError = (requestId, code, http, message) => ({
    request_id: requestId,
    status: 'error',
    error: {
        code,
        http,
        message,
    },
});
const isSkeletonPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    if (!isNonEmptyString(payload.doc_id))
        return false;
    if (!isNonEmptyString(payload.content_hash))
        return false;
    if (!Array.isArray(payload.sections) || payload.sections.length === 0)
        return false;
    return payload.sections.every((section) => isRecord(section) && isString(section.id) && isString(section.text));
};
const isParagraphPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return (isNonEmptyString(payload.doc_id) &&
        isNonEmptyString(payload.paragraph_id) &&
        isNonEmptyString(payload.paragraph_text));
};
const isSentencePayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return (isNonEmptyString(payload.doc_id) &&
        isNonEmptyString(payload.sentence_id) &&
        isNonEmptyString(payload.sentence_text));
};
const isSentenceStructurePayload = (payload) => {
    if (!isRecord(payload))
        return false;
    if (!isNonEmptyString(payload.doc_id) || !isNonEmptyString(payload.sentence_id))
        return false;
    if (!isRecord(payload.span))
        return false;
    const { start, end } = payload.span;
    return isNumber(start) && isNumber(end) && start >= 0 && end >= start;
};
const isQuizPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return isNonEmptyString(payload.doc_id) && isNonEmptyString(payload.article_text);
};
const isKnowledgeExtractionPayload = (payload) => {
    if (!isRecord(payload))
        return false;
    return (isNonEmptyString(payload.doc_id) &&
        isNonEmptyString(payload.chapter_id) &&
        isNonEmptyString(payload.chapter_text));
};
const validateEnvelope = (input) => {
    if (!isRecord(input)) {
        return {
            ok: false,
            error: makeError('unknown', 'E.BAD_REQUEST', 400, 'Request body must be a JSON object'),
        };
    }
    const type = input.type;
    const requestId = input.request_id;
    const payload = input.payload;
    if (!isNonEmptyString(type)) {
        return {
            ok: false,
            error: makeError('unknown', 'E.BAD_REQUEST', 400, 'Missing or invalid "type"'),
        };
    }
    if (!isNonEmptyString(requestId)) {
        return {
            ok: false,
            error: makeError('unknown', 'E.BAD_REQUEST', 400, 'Missing or invalid "request_id"'),
        };
    }
    if (payload === undefined) {
        return {
            ok: false,
            error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Missing "payload"'),
        };
    }
    switch (type) {
        case 'analyze.skeleton.v1':
            if (!isSkeletonPayload(payload)) {
                return { ok: false, error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid skeleton payload') };
            }
            return { ok: true, envelope: input };
        case 'analyze.paragraph.v1':
            if (!isParagraphPayload(payload)) {
                return { ok: false, error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid paragraph payload') };
            }
            return { ok: true, envelope: input };
        case 'analyze.sentence.v1':
            if (!isSentencePayload(payload)) {
                return { ok: false, error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid sentence payload') };
            }
            return { ok: true, envelope: input };
        case 'analyze.sentence-structure.v1':
            if (!isSentenceStructurePayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid sentence structure payload'),
                };
            }
            return { ok: true, envelope: input };
        case 'analyze.quiz.v1':
            if (!isQuizPayload(payload)) {
                return { ok: false, error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid quiz payload') };
            }
            return { ok: true, envelope: input };
        case 'analyze.knowledge-extraction.v1':
            if (!isKnowledgeExtractionPayload(payload)) {
                return {
                    ok: false,
                    error: makeError(requestId, 'E.BAD_REQUEST', 400, 'Invalid knowledge extraction payload'),
                };
            }
            return { ok: true, envelope: input };
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