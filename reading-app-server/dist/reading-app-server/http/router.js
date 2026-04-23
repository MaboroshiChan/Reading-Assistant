"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStream = exports.handleMsg = void 0;
const paragraph_1 = require("../handlers/paragraph");
const sentence_1 = require("../handlers/sentence");
const skeleton_1 = require("../handlers/skeleton");
const sentence_structure_1 = require("../handlers/sentence_structure");
const quiz_1 = require("../handlers/quiz");
const knowledge_extraction_1 = require("../handlers/knowledge_extraction");
const validate_1 = require("./validate");
const UNKNOWN_REQUEST_ID = 'unknown';
/**
 * Parses the raw request body into a JSON object.
 *
 * @param raw - The raw body string.
 * @returns Object with either the parsed value or a ResponseEnvelope error.
 */
const parseBody = (raw) => {
    if (!raw || raw.trim() === '') {
        return {
            ok: false,
            error: (0, validate_1.errorResponse)(UNKNOWN_REQUEST_ID, 'E.BAD_REQUEST', 400, 'Request body cannot be empty'),
        };
    }
    try {
        return { ok: true, value: JSON.parse(raw) };
    }
    catch (err) {
        return {
            ok: false,
            error: (0, validate_1.errorResponse)(UNKNOWN_REQUEST_ID, 'E.BAD_REQUEST', 400, `Invalid JSON: ${err.message}`),
        };
    }
};
/**
 * Dispatches an envelope to the appropriate feature handler based on its type.
 *
 * @param envelope - The validated request envelope.
 * @returns A promise resolving to the response envelope (often streaming).
 */
const dispatch = async (envelope) => {
    let result;
    if (envelope.type === 'analyze.skeleton.v1') {
        result = await (0, skeleton_1.handleSkeleton)(envelope);
    }
    else if (envelope.type === 'analyze.paragraph.v1') {
        result = await (0, paragraph_1.handleParagraph)(envelope);
    }
    else if (envelope.type === 'analyze.sentence.v1') {
        result = await (0, sentence_1.handleSentence)(envelope);
    }
    else if (envelope.type === 'analyze.sentence-structure.v1') {
        console.log('handle sentence structure');
        result = await (0, sentence_structure_1.handleSentenceStructure)(envelope);
    }
    else if (envelope.type === 'analyze.quiz.v1') {
        console.log('handle quiz');
        result = await (0, quiz_1.handleQuiz)(envelope);
    }
    else if (envelope.type === 'analyze.knowledge-extraction.v1') {
        console.log('handle knowledge extraction');
        result = await (0, knowledge_extraction_1.handleKnowledgeExtraction)(envelope);
    }
    else {
        const _exhaustive = envelope;
        return (0, validate_1.errorResponse)(UNKNOWN_REQUEST_ID, 'E.BAD_REQUEST', 400, 'Unsupported message type');
    }
    return {
        request_id: envelope.request_id,
        status: 'ok',
        stream: result.data,
        usage: result.usage.then((u) => ({
            tokens_in: u.inputTokens,
            tokens_out: u.outputTokens,
            model_id: u.modelId,
        })),
    };
};
/**
 * High-level handler for non-streaming messages (though the result may still be a stream).
 *
 * @param raw - The raw request body.
 * @returns A promise resolving to the response envelope.
 */
const handleMsg = async (raw) => {
    const parsed = parseBody(raw);
    if (!parsed.ok)
        return parsed.error;
    const validation = (0, validate_1.validateEnvelope)(parsed.value);
    if (!validation.ok)
        return validation.error;
    try {
        return await dispatch(validation.envelope);
    }
    catch (error) {
        console.error('Handler error', error);
        return (0, validate_1.errorResponse)(validation.envelope.request_id, 'E.SERVER', 500, error instanceof Error ? error.message : 'Unexpected server error');
    }
};
exports.handleMsg = handleMsg;
/**
 * High-level handler for streaming messages.
 *
 * @param raw - The raw request body.
 * @returns A promise resolving to the response envelope.
 */
const handleStream = async (raw) => {
    const parsed = parseBody(raw);
    if (!parsed.ok)
        return parsed.error;
    const validation = (0, validate_1.validateEnvelope)(parsed.value);
    if (!validation.ok)
        return validation.error;
    try {
        return await dispatch(validation.envelope);
    }
    catch (error) {
        return (0, validate_1.errorResponse)(validation.envelope.request_id, 'E.SERVER', 500, error instanceof Error ? error.message : 'Unexpected server error');
    }
};
exports.handleStream = handleStream;
//# sourceMappingURL=router.js.map