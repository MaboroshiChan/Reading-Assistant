"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMockParagraphData = void 0;
const shared_1 = require("../shared");
const logger_1 = require("../logger");
const paragraph_1 = require("../paragraph");
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
        summary: requested.has('summary') ? base.summary : undefined,
        roles: requested.has('roles') ? base.roles : undefined,
        rhetoric: requested.has('rhetoric') ? base.rhetoric : undefined,
        claims: requested.has('claims') ? base.claims : undefined,
        tags: requested.has('tags') ? base.tags : undefined,
        anchors: base.anchors,
        confidence: base.confidence,
    };
};
/**
 * Generates mock paragraph analysis data.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to mock AnalyzeParagraphData.
 */
const buildMockParagraphData = async (req) => {
    const tasks = (0, paragraph_1.buildParagraphTasks)(req);
    const prompt = await (0, paragraph_1.buildParagraphPrompt)(req);
    (0, logger_1.handlerLog)('paragraph', 'LLM prompt prepared', {
        requestId: req.request_id,
        paragraphId: req.payload.paragraph_id,
        promptVersion: paragraph_1.PARAGRAPH_PROMPT_VERSION,
        tasks,
        promptLength: prompt.length,
        prompt,
        mock: true,
    });
    const text = req.payload.paragraph_text.trim();
    const fragments = (0, shared_1.splitIntoSentences)(text);
    const paragraphAnchor = (0, shared_1.makeAnchor)({
        paragraphId: req.payload.paragraph_id,
        span: { start: 0, end: text.length },
        text,
    });
    const roles = fragments.map((fragment, index) => ({
        role: index === 0 ? 'topic' : 'support',
        anchors: [
            (0, shared_1.makeAnchor)({
                paragraphId: req.payload.paragraph_id,
                span: { start: fragment.start, end: fragment.end },
                text: fragment.text,
            }),
        ],
        confidence: index === 0 ? 0.7 : 0.5,
    }));
    const rhetoric = [
        {
            label: text.includes('?') ? 'question' : 'statement',
            evidence_anchors: [paragraphAnchor],
            confidence: 0.5,
        },
    ];
    const claims = [
        {
            text: fragments[0]?.text ?? text,
            polarity: 'pos',
            support: 'strong',
            anchors: fragments.slice(0, 1).map((fragment) => (0, shared_1.makeAnchor)({
                paragraphId: req.payload.paragraph_id,
                span: { start: fragment.start, end: fragment.end },
                text: fragment.text,
            })),
        },
    ];
    const base = {
        summary: (0, shared_1.summarize)(text),
        roles,
        rhetoric,
        claims,
        anchors: [paragraphAnchor],
        tags: [
            { name: 'Introduction', type: 'logic', description: 'Sets up the context' },
            { name: 'Core Concept', type: 'concept', description: 'The main idea of the paragraph' }
        ],
        confidence: 0.6,
    };
    return filterByTasks(base, tasks);
};
exports.buildMockParagraphData = buildMockParagraphData;
//# sourceMappingURL=paragraphMock.js.map