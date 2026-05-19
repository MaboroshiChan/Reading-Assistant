"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChapterKeywords = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const config_1 = require("../services/config");
const cache = __importStar(require("../services/cache"));
const llmService_1 = require("../services/llmService");
const chapter_prefix_cache_1 = require("../src/utils/chapter-prefix-cache");
const prompt_path_1 = require("../src/utils/prompt-path");
const shared_1 = require("./shared");
const logger_1 = require("./logger");
const CACHE_PREFIX = 'chapter-keywords';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = 'chapter_keywords.v1';
const PROMPT_PATH = (0, prompt_path_1.resolvePromptPath)('chapter_keywords.txt');
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const refKey = (ref) => [
    ref.page_index,
    ref.paragraph_index,
    ref.paragraph_id,
    ref.sentence_id,
].join(':');
const readSentenceRef = (value) => {
    if (!isRecord(value))
        return undefined;
    const { page_index: pageIndex, paragraph_index: paragraphIndex, paragraph_id: paragraphId, sentence_id: sentenceId, } = value;
    if (!isNumber(pageIndex) ||
        !isNumber(paragraphIndex) ||
        !isNumber(paragraphId) ||
        !isNumber(sentenceId)) {
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
const sanitizeChapterKeywords = (raw, req) => {
    const sourceByRef = new Map(req.payload.sentences.map((sentence) => [refKey(sentence.ref), sentence]));
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
    return {
        key_sentences: keySentences,
        sentence_keywords: [],
    };
};
const buildCacheKey = (req) => {
    return (0, shared_1.buildStableCacheKey)(CACHE_PREFIX, CACHE_VERSION, {
        payload: req.payload,
        context: req.context ?? {},
        prompt_version: PROMPT_VERSION,
        model: config_1.config.model,
    });
};
let cachedSystemPrompt = null;
const loadSystemPrompt = async () => {
    if (cachedSystemPrompt)
        return cachedSystemPrompt;
    cachedSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedSystemPrompt;
};
const buildUserPrompt = (req) => {
    const promptPayload = {
        doc_id: req.payload.doc_id,
        chapter_id: req.payload.chapter_id,
        chapter_index: req.payload.chapter_index,
        chunk_id: req.payload.chunk_id,
        chunk_index: req.payload.chunk_index,
        total_chunks: req.payload.total_chunks,
        sentences: req.payload.sentences,
    };
    const sections = [
        `Document ID: ${req.payload.doc_id}`,
        `Chapter ID: ${req.payload.chapter_id}`,
        `Chapter Index: ${req.payload.chapter_index}`,
        `Chunk ID: ${req.payload.chunk_id}`,
        `Chunk Index: ${req.payload.chunk_index}`,
        `Total Chunks: ${req.payload.total_chunks}`,
        `Prompt Version: ${PROMPT_VERSION}`,
        '',
        'Sentence payload JSON:',
        '```json',
        JSON.stringify(promptPayload, null, 2),
        '```',
        '',
        'Respond with JSON only. Do not wrap the JSON in markdown fences.',
    ];
    return sections.join('\n');
};
const buildChapterKeywordsData = async (req, signal) => {
    (0, logger_1.handlerLog)('chapter_keywords', 'building LLM prompt', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
    });
    const [systemPrompt, userPrompt] = await Promise.all([
        loadSystemPrompt(),
        Promise.resolve(buildUserPrompt(req)),
    ]);
    const llmClient = (0, llmService_1.createLLMClient)({
        systemPrompt,
        prefixCache: (0, chapter_prefix_cache_1.buildChunkPrefixCache)({
            task: 'chapter_keywords',
            version: PROMPT_VERSION,
            docId: req.payload.doc_id,
            chapterId: req.payload.chapter_id,
            chunkId: req.payload.chunk_id,
            chunkText: req.payload.chunk_text,
            contentHash: req.context?.doc.content_hash,
        }),
    });
    (0, logger_1.handlerLog)('chapter_keywords', 'LLM prompt prepared', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
    });
    return llmClient.json(userPrompt, { signal });
};
const handleChapterKeywords = async (req, signal) => {
    (0, logger_1.handlerLog)('chapter_keywords', 'request received', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
    });
    const cacheKey = buildCacheKey(req);
    const allowCache = req.cache_hint !== 'bypass';
    const cached = allowCache ? cache.get(cacheKey) : undefined;
    if (cached) {
        (0, logger_1.handlerLog)('chapter_keywords', 'cache hit', {
            requestId: req.request_id,
            cacheKey,
            promptVersion: PROMPT_VERSION,
        });
        const text = JSON.stringify({ ...cached, served_from: 'cache' });
        const usage = await Promise.resolve(cached.usage);
        return {
            data: (async function* () {
                yield text;
            })(),
            usage: Promise.resolve({
                modelId: usage?.model_id,
                inputTokens: usage?.tokens_in,
                outputTokens: usage?.tokens_out,
            }),
        };
    }
    const started = Date.now();
    const { data: stream, usage: usagePromise } = await buildChapterKeywordsData(req, signal);
    const sanitizedStream = (async function* () {
        try {
            let text = '';
            for await (const chunk of (0, shared_1.withBufferedStream)(stream, async () => undefined)) {
                text += chunk;
            }
            const usage = await usagePromise;
            const raw = (0, llmService_1.extractJsonFromText)(text);
            const data = sanitizeChapterKeywords(raw, req);
            const latencyMs = Date.now() - started;
            const response = {
                request_id: req.request_id,
                status: 'ok',
                served_from: 'fresh',
                data,
                usage: {
                    latency_ms: latencyMs,
                    model_id: usage?.modelId,
                    tokens_in: usage?.inputTokens,
                    tokens_out: usage?.outputTokens,
                },
            };
            if (allowCache) {
                cache.set(cacheKey, response, config_1.config.cacheTtlMs);
            }
            (0, logger_1.handlerLog)('chapter_keywords', 'request completed', {
                requestId: req.request_id,
                chapterId: req.payload.chapter_id,
                chunkId: req.payload.chunk_id,
                promptVersion: PROMPT_VERSION,
                latencyMs,
                keySentenceCount: data.key_sentences.length,
            });
            yield JSON.stringify(data);
        }
        catch (error) {
            (0, logger_1.handlerLog)('chapter_keywords', 'request failed', {
                requestId: req.request_id,
                chapterId: req.payload.chapter_id,
                chunkId: req.payload.chunk_id,
                promptVersion: PROMPT_VERSION,
                latencyMs: Date.now() - started,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    })();
    return { data: sanitizedStream, usage: usagePromise };
};
exports.handleChapterKeywords = handleChapterKeywords;
//# sourceMappingURL=chapter_keywords.js.map