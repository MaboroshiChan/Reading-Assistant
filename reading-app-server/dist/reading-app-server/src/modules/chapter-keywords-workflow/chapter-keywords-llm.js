"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAPTER_KEYWORDS_PROMPT_VERSION = exports.toCachedResponseText = exports.toLLMInputFromEnvelope = exports.analyzeChapterKeywordsChunk = exports.buildChapterKeywordsCall = exports.buildChapterKeywordsPrompt = exports.sanitizeChapterKeywords = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const llmService_1 = require("../../../services/llmService");
const runtime_config_1 = require("../../config/runtime-config");
const chapter_prefix_cache_1 = require("../../utils/chapter-prefix-cache");
const prompt_path_1 = require("../../utils/prompt-path");
const PROMPT_VERSION = 'chapter_keywords.v1';
exports.CHAPTER_KEYWORDS_PROMPT_VERSION = PROMPT_VERSION;
const PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('chapter_keywords.txt');
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const refKey = (ref) => [
    ref.page_index,
    ref.paragraph_index,
    ref.paragraph_id,
    ref.sentence_id,
].join(':');
const paragraphKey = (ref) => [
    ref.page_index,
    ref.paragraph_index,
    ref.paragraph_id,
].join(':');
const compareSentenceRefs = (left, right) => {
    if (left.page_index !== right.page_index) {
        return left.page_index - right.page_index;
    }
    if (left.paragraph_index !== right.paragraph_index) {
        return left.paragraph_index - right.paragraph_index;
    }
    if (left.paragraph_id !== right.paragraph_id) {
        return left.paragraph_id - right.paragraph_id;
    }
    return left.sentence_id - right.sentence_id;
};
const readSentenceRef = (value) => {
    if (!isRecord(value))
        return undefined;
    const { page_index: pageIndex, paragraph_index: paragraphIndex, paragraph_id: paragraphId, sentence_id: sentenceId, } = value;
    if (!isNumber(pageIndex)
        || !isNumber(paragraphIndex)
        || !isNumber(paragraphId)
        || !isNumber(sentenceId)) {
        return undefined;
    }
    return {
        page_index: pageIndex,
        paragraph_index: paragraphIndex,
        paragraph_id: paragraphId,
        sentence_id: sentenceId,
    };
};
const clamp01 = (value) => {
    if (!isNumber(value))
        return 0;
    return Math.max(0, Math.min(1, value));
};
let cachedSystemPrompt = null;
const loadSystemPrompt = async () => {
    if (cachedSystemPrompt)
        return cachedSystemPrompt;
    cachedSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedSystemPrompt;
};
const sanitizeChapterKeywords = (raw, sourceSentences) => {
    const sourceByRef = new Map(sourceSentences.map((sentence) => [refKey(sentence.ref), sentence]));
    const record = isRecord(raw) ? raw : {};
    const rawKeySentences = Array.isArray(record.key_sentences) ? record.key_sentences : [];
    const seen = new Set();
    const keySentences = [];
    for (const item of rawKeySentences) {
        if (!isRecord(item))
            continue;
        const sentenceRef = readSentenceRef(item.sentence_ref);
        if (!sentenceRef)
            continue;
        const key = refKey(sentenceRef);
        if (seen.has(key))
            continue;
        const source = sourceByRef.get(key);
        if (!source || item.sentence_text !== source.text)
            continue;
        seen.add(key);
        keySentences.push({
            sentence_ref: source.ref,
            sentence_text: source.text,
            importance: clamp01(item.importance),
            reason: typeof item.reason === 'string' ? item.reason : '',
        });
    }
    const bestByParagraph = new Map();
    for (const item of keySentences) {
        const key = paragraphKey(item.sentence_ref);
        const existing = bestByParagraph.get(key);
        if (!existing
            || item.importance > existing.importance
            || (item.importance === existing.importance
                && compareSentenceRefs(item.sentence_ref, existing.sentence_ref) < 0)) {
            bestByParagraph.set(key, item);
        }
    }
    return {
        key_sentences: Array.from(bestByParagraph.values()).sort((left, right) => compareSentenceRefs(left.sentence_ref, right.sentence_ref)),
        sentence_keywords: [],
    };
};
exports.sanitizeChapterKeywords = sanitizeChapterKeywords;
const buildChapterKeywordsPrompt = (input) => {
    const promptPayload = {
        doc_id: input.docId,
        chapter_id: input.chapterId,
        chapter_index: input.chapterIndex,
        chunk_id: input.chunkId,
        chunk_index: input.chunkIndex,
        total_chunks: input.totalChunks,
        sentences: input.sentences,
    };
    return [
        `Document ID: ${input.docId}`,
        `Chapter ID: ${input.chapterId}`,
        `Chapter Index: ${input.chapterIndex}`,
        `Chunk ID: ${input.chunkId}`,
        `Chunk Index: ${input.chunkIndex}`,
        `Total Chunks: ${input.totalChunks}`,
        `Prompt Version: ${PROMPT_VERSION}`,
        '',
        'Sentence payload JSON:',
        '```json',
        JSON.stringify(promptPayload, null, 2),
        '```',
        '',
        'Respond with JSON only. Do not wrap the JSON in markdown fences.',
    ].join('\n');
};
exports.buildChapterKeywordsPrompt = buildChapterKeywordsPrompt;
const buildChapterKeywordsCall = async (input, signal) => {
    const [systemPrompt, userPrompt] = await Promise.all([
        loadSystemPrompt(),
        Promise.resolve((0, exports.buildChapterKeywordsPrompt)(input)),
    ]);
    const llmClient = (0, llmService_1.createLLMClient)({
        systemPrompt,
        model: runtime_config_1.config.chapterKeywordsWorkflowModel,
        prefixCache: (0, chapter_prefix_cache_1.buildChunkPrefixCache)({
            task: 'chapter_keywords',
            version: PROMPT_VERSION,
            docId: input.docId,
            chapterId: input.chapterId,
            chunkId: input.chunkId,
            chunkText: input.chunkText,
            contentHash: input.contentHash,
        }),
        logContext: {
            workflowKind: 'chapter_keywords',
            docId: input.docId,
            chapterId: input.chapterId,
            chapterIndex: input.chapterIndex,
            chunkId: input.chunkId,
            chunkIndex: input.chunkIndex,
            totalChunks: input.totalChunks,
        },
    });
    return llmClient.json(userPrompt, { signal });
};
exports.buildChapterKeywordsCall = buildChapterKeywordsCall;
const analyzeChapterKeywordsChunk = async (input, signal) => {
    const { data } = await (0, exports.buildChapterKeywordsCall)(input, signal);
    let text = '';
    for await (const chunk of data) {
        text += chunk;
    }
    return (0, exports.sanitizeChapterKeywords)((0, llmService_1.extractJsonFromText)(text), input.sentences);
};
exports.analyzeChapterKeywordsChunk = analyzeChapterKeywordsChunk;
const toLLMInputFromEnvelope = (req) => ({
    docId: req.payload.doc_id,
    chapterId: req.payload.chapter_id,
    chapterIndex: req.payload.chapter_index,
    chunkId: req.payload.chunk_id,
    chunkIndex: req.payload.chunk_index,
    totalChunks: req.payload.total_chunks,
    chunkText: req.payload.chunk_text,
    sentences: req.payload.sentences,
    contentHash: req.context?.doc.content_hash,
});
exports.toLLMInputFromEnvelope = toLLMInputFromEnvelope;
const toCachedResponseText = (cached) => JSON.stringify({ ...cached, served_from: 'cache' });
exports.toCachedResponseText = toCachedResponseText;
//# sourceMappingURL=chapter-keywords-llm.js.map