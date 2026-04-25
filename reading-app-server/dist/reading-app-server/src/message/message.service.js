"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageService = exports.handleRawStream = exports.handleRawMessage = exports.dispatchEnvelope = void 0;
const common_1 = require("@nestjs/common");
const paragraph_1 = require("../../handlers/paragraph");
const sentence_1 = require("../../handlers/sentence");
const skeleton_1 = require("../../handlers/skeleton");
const sentence_structure_1 = require("../../handlers/sentence_structure");
const quiz_1 = require("../../handlers/quiz");
const knowledge_extraction_1 = require("../../handlers/knowledge_extraction");
const src_1 = require("../../../packages/contracts/src");
const UNKNOWN_REQUEST_ID = 'unknown';
const parseBody = (raw) => {
    if (!raw || raw.trim() === '') {
        return {
            ok: false,
            error: (0, src_1.errorResponse)(UNKNOWN_REQUEST_ID, 'E.BAD_REQUEST', 400, 'Request body cannot be empty'),
        };
    }
    try {
        return { ok: true, value: JSON.parse(raw) };
    }
    catch (error) {
        return {
            ok: false,
            error: (0, src_1.errorResponse)(UNKNOWN_REQUEST_ID, 'E.BAD_REQUEST', 400, `Invalid JSON: ${error.message}`),
        };
    }
};
const dispatchEnvelope = async (envelope) => {
    let result;
    switch (envelope.type) {
        case 'analyze.skeleton.v1':
            result = await (0, skeleton_1.handleSkeleton)(envelope);
            break;
        case 'analyze.paragraph.v1':
            result = await (0, paragraph_1.handleParagraph)(envelope);
            break;
        case 'analyze.sentence.v1':
            result = await (0, sentence_1.handleSentence)(envelope);
            break;
        case 'analyze.sentence-structure.v1':
            result = await (0, sentence_structure_1.handleSentenceStructure)(envelope);
            break;
        case 'analyze.quiz.v1':
            result = await (0, quiz_1.handleQuiz)(envelope);
            break;
        case 'analyze.knowledge-extraction.v1':
            result = await (0, knowledge_extraction_1.handleKnowledgeExtraction)(envelope);
            break;
        default: {
            const exhaustive = envelope;
            void exhaustive;
            return (0, src_1.errorResponse)(UNKNOWN_REQUEST_ID, 'E.BAD_REQUEST', 400, 'Unsupported message type');
        }
    }
    return {
        request_id: envelope.request_id,
        status: 'ok',
        stream: result.data,
        usage: result.usage.then((usage) => ({
            tokens_in: usage.inputTokens,
            tokens_out: usage.outputTokens,
            model_id: usage.modelId,
        })),
    };
};
exports.dispatchEnvelope = dispatchEnvelope;
const handleRawEnvelope = async (raw) => {
    const parsed = parseBody(raw);
    if (!parsed.ok)
        return parsed.error;
    const validation = (0, src_1.validateEnvelope)(parsed.value);
    if (!validation.ok)
        return validation.error;
    try {
        return await (0, exports.dispatchEnvelope)(validation.envelope);
    }
    catch (error) {
        return (0, src_1.errorResponse)(validation.envelope.request_id, 'E.SERVER', 500, error instanceof Error ? error.message : 'Unexpected server error');
    }
};
const handleRawMessage = async (raw) => handleRawEnvelope(raw);
exports.handleRawMessage = handleRawMessage;
const handleRawStream = async (raw) => handleRawEnvelope(raw);
exports.handleRawStream = handleRawStream;
let MessageService = class MessageService {
    handleMsg(raw) {
        return (0, exports.handleRawMessage)(raw);
    }
    handleStream(raw) {
        return (0, exports.handleRawStream)(raw);
    }
};
exports.MessageService = MessageService;
exports.MessageService = MessageService = __decorate([
    (0, common_1.Injectable)()
], MessageService);
//# sourceMappingURL=message.service.js.map