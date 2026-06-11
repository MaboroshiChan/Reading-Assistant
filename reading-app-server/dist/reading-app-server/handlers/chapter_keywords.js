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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChapterKeywords = void 0;
const config_1 = require("../services/config");
const cache = __importStar(require("../services/cache"));
const llmService_1 = require("../services/llmService");
const shared_1 = require("./shared");
const logger_1 = require("./logger");
const chapter_keywords_llm_1 = require("../src/modules/chapter-keywords-workflow/chapter-keywords-llm");
const CACHE_PREFIX = 'chapter-keywords';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = chapter_keywords_llm_1.CHAPTER_KEYWORDS_PROMPT_VERSION;
const buildCacheKey = (req) => {
    return (0, shared_1.buildStableCacheKey)(CACHE_PREFIX, CACHE_VERSION, {
        payload: req.payload,
        context: req.context ?? {},
        prompt_version: PROMPT_VERSION,
        model: config_1.config.model,
    });
};
const buildChapterKeywordsData = async (req, signal) => {
    (0, logger_1.handlerLog)('chapter_keywords', 'building LLM prompt', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
    });
    const llmInput = (0, chapter_keywords_llm_1.toLLMInputFromEnvelope)(req);
    (0, logger_1.handlerLog)('chapter_keywords', 'LLM prompt prepared', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
        systemPromptLength: 0,
        userPromptLength: 0,
    });
    return (0, chapter_keywords_llm_1.buildChapterKeywordsCall)(llmInput, signal);
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
        const text = (0, chapter_keywords_llm_1.toCachedResponseText)(cached);
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
            const data = (0, chapter_keywords_llm_1.sanitizeChapterKeywords)(raw, req.payload.sentences);
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