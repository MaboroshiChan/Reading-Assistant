"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMockSentenceData = void 0;
const shared_1 = require("../shared");
const logger_1 = require("../logger");
const sentence_1 = require("../sentence");
const modalMap = {
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
/**
 * Filters the mock results to only include requested task data.
 *
 * @param base - The full mock response.
 * @param tasks - List of requested tasks.
 * @returns The filtered response.
 */
const filterByTasks = (base, tasks) => {
    if (!tasks || tasks.length === 0)
        return base;
    const requested = new Set(tasks);
    return {
        semantic_roles: requested.has('semantic_roles') ? base.semantic_roles : undefined,
        key_words: requested.has('key_words') ? base.key_words : undefined,
        discourse_function: requested.has('discourse_function') ? base.discourse_function : undefined,
        dependency_light: requested.has('dependency_light') ? base.dependency_light : undefined,
        modal_markers: requested.has('modal_markers') ? base.modal_markers : undefined,
        anchors: base.anchors,
        confidence: base.confidence,
    };
};
/**
 * Generates mock sentence analysis data.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to mock AnalyzeSentenceData.
 */
const buildMockSentenceData = async (req) => {
    const tasks = (0, sentence_1.buildSentenceTasks)(req);
    const prompt = await (0, sentence_1.buildSentencePrompt)(req);
    (0, logger_1.handlerLog)('sentence', 'LLM prompt prepared', {
        requestId: req.request_id,
        sentenceId: req.payload.sentence_id,
        promptVersion: sentence_1.SENTENCE_PROMPT_VERSION,
        tasks,
        promptLength: prompt.length,
        prompt,
        mock: true,
    });
    const text = req.payload.sentence_text.trim();
    const tokens = (0, shared_1.tokenize)(text);
    const sentenceAnchor = (0, shared_1.makeAnchor)({
        sentenceId: req.payload.sentence_id,
        span: { start: 0, end: text.length },
        text,
    });
    const semantic_roles = [];
    if (tokens[0]) {
        semantic_roles.push({
            role: 'subject',
            span: { start: tokens[0].start, end: tokens[0].end },
            anchors: [
                (0, shared_1.makeAnchor)({
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
                (0, shared_1.makeAnchor)({
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
                (0, shared_1.makeAnchor)({
                    sentenceId: req.payload.sentence_id,
                    span: { start: last.start, end: last.end },
                    text: last.token,
                }),
            ],
            confidence: 0.5,
        });
    }
    const arcs = tokens.slice(1).map((token, index) => ({
        head: 0,
        dep: index + 1,
        label: index === 0 ? 'root' : 'modifier',
    }));
    const modal_markers = tokens
        .map((token) => {
        const mapped = modalMap[token.token.toLowerCase()];
        if (!mapped)
            return null;
        return {
            type: mapped,
            span: { start: token.start, end: token.end },
            cue: token.token,
        };
    })
        .filter((marker) => marker !== null);
    const discourse_function = (() => {
        const lowered = text.toLowerCase();
        if (lowered.includes('because'))
            return 'support';
        if (lowered.includes('however') || lowered.includes('but'))
            return 'contrast';
        if (text.endsWith('?'))
            return 'question';
        return 'statement';
    })();
    const base = {
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
    return filterByTasks(base, tasks);
};
exports.buildMockSentenceData = buildMockSentenceData;
//# sourceMappingURL=sentenceMock.js.map