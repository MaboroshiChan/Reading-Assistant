"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSkeletonData = void 0;
const shared_1 = require("./shared");
/**
 * Generates deterministic skeleton data (paragraphs and sentences) for a document.
 *
 * @param req - The request envelope.
 * @returns Generated AnalyzeSkeletonData.
 */
const buildSkeletonData = (req) => {
    const paragraphs = [];
    const sentences = [];
    req.payload.sections.forEach((section, sectionIndex) => {
        const text = (section.text ?? '').trim();
        if (!text)
            return;
        const paragraphId = section.id || `section-${sectionIndex + 1}`;
        const fragments = (0, shared_1.splitIntoSentences)(text);
        const sentenceIds = [];
        fragments.forEach((fragment, idx) => {
            const sentenceId = `${paragraphId}-s${idx + 1}`;
            sentenceIds.push(sentenceId);
            sentences.push({
                sentence_id: sentenceId,
                paragraph_id: paragraphId,
                text: fragment.text,
                text_hash: (0, shared_1.hashString)(fragment.text),
                char_start: fragment.start,
                char_end: fragment.end,
            });
        });
        paragraphs.push({
            paragraph_id: paragraphId,
            text_hash: (0, shared_1.hashString)(text),
            sentence_ids: sentenceIds,
            brief_summary: (0, shared_1.summarize)(fragments[0]?.text ?? text, 200),
        });
    });
    const data = {
        paragraphs,
        sentences,
    };
    if (req.payload.options?.max_entities && req.payload.options.max_entities > 0) {
        data.entity_index = Array.from({ length: Math.min(3, req.payload.options.max_entities) }).map((_, idx) => ({
            id: `entity-${idx + 1}`,
            type: 'TERM',
            canonical: `Entity ${idx + 1}`,
            aliases: [],
            spans: [],
        }));
    }
    if (req.payload.options?.do_embeddings) {
        data.embeddings_meta = {
            dim: 768,
            chunking: 'sentence',
            index_id: `index-${(0, shared_1.hashString)(req.payload.doc_id).slice(0, 6)}`,
        };
    }
    return data;
};
exports.buildSkeletonData = buildSkeletonData;
//# sourceMappingURL=skeleton-data.js.map