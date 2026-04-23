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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleQuiz = void 0;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const config_1 = require("../services/config");
const cache = __importStar(require("../services/cache"));
const llmService_1 = require("../services/llmService");
const shared_1 = require("./shared");
const logger_1 = require("./logger");
const CACHE_PREFIX = 'quiz';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = 'quiz.v1.0';
const PROMPT_PATH = node_path_1.default.join(__dirname, '..', 'prompts', 'v1', 'quiz.txt');
/**
 * Builds a cache key for quiz generation requests.
 */
const buildCacheKey = (req) => {
    return (0, shared_1.buildStableCacheKey)(CACHE_PREFIX, CACHE_VERSION, {
        payload: req.payload,
        context: req.context ?? {},
        prompt_version: PROMPT_VERSION,
        model: config_1.config.model,
    });
};
let cachedQuizSystemPrompt = null;
/**
 * Loads the quiz generation prompt from the filesystem, with caching.
 */
const loadQuizSystemPrompt = async () => {
    if (cachedQuizSystemPrompt)
        return cachedQuizSystemPrompt;
    cachedQuizSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedQuizSystemPrompt;
};
/**
 * Builds the full LLM prompt for quiz generation.
 */
const buildUserPrompt = (req) => {
    const sections = [
        `Document ID: ${req.payload.doc_id}`,
        `Prompt Version: ${PROMPT_VERSION}`,
        '',
        'Article text:',
        '```text',
        req.payload.article_text,
        '```',
        '',
        'Respond with JSON only. Do not wrap the JSON in markdown fences.',
    ];
    return sections.join('\n');
};
/**
 * Checks if a value is a plain object.
 */
const isRecord = (value) => typeof value === 'object' && value !== null;
/**
 * Casts unknown to string or undefined.
 */
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
/**
 * Casts unknown to a finite number or undefined.
 */
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
/**
 * Coerces the raw LLM JSON response into a typed QuizQuestion array.
 */
const coerceQuizResponse = (value) => {
    if (!isRecord(value) || !Array.isArray(value.questions))
        return [];
    return value.questions.map((q) => {
        if (!isRecord(q))
            return null;
        // Validate options
        const options = Array.isArray(q.options)
            ? q.options.map(asString).filter((s) => typeof s === 'string')
            : [];
        if (options.length !== 4)
            return null; // We need exactly 4 options
        // Validate correct answer index
        const correctAnswerIndex = asNumber(q.correctAnswerIndex);
        if (correctAnswerIndex === undefined || correctAnswerIndex < 0 || correctAnswerIndex > 3)
            return null;
        const id = asString(q.id) ?? `q_${Math.random().toString(36).substring(2, 9)}`;
        const question = asString(q.question);
        const explanation = asString(q.explanation);
        let skill = asString(q.skill);
        // Default fallback if skill is missing or invalid
        if (skill !== 'Facts' && skill !== 'Inference' && skill !== 'Tone' && skill !== 'Argument') {
            skill = 'Facts';
        }
        if (!question || !explanation)
            return null;
        return {
            id,
            type: 'multiple_choice',
            question,
            options,
            correctAnswerIndex,
            explanation,
            skill,
        };
    }).filter((q) => q !== null);
};
/**
 * Orchestrates quiz data collection from LLM.
 */
const buildQuizData = async (req) => {
    (0, logger_1.handlerLog)('quiz', 'building LLM prompt', {
        requestId: req.request_id,
        promptVersion: PROMPT_VERSION,
    });
    const [systemPrompt, userPrompt] = await Promise.all([
        loadQuizSystemPrompt(),
        Promise.resolve(buildUserPrompt(req)),
    ]);
    const llmClient = (0, llmService_1.createLLMClient)({ systemPrompt });
    (0, logger_1.handlerLog)('quiz', 'LLM prompt prepared', {
        requestId: req.request_id,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
    });
    return llmClient.json(userPrompt);
};
/**
 * The main handler for quiz generation requests.
 */
const handleQuiz = async (req) => {
    (0, logger_1.handlerLog)('quiz', 'request received', {
        requestId: req.request_id,
        promptVersion: PROMPT_VERSION,
    });
    const cacheKey = buildCacheKey(req);
    const cached = cache.get(cacheKey);
    if (cached) {
        (0, logger_1.handlerLog)('quiz', 'cache hit', {
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
    const { data: stream, usage: usagePromise } = await buildQuizData(req);
    const tappedStream = (async function* () {
        let text = '';
        for await (const chunk of stream) {
            text += chunk;
            yield chunk;
        }
        // Background processing
        try {
            const usage = await usagePromise;
            const object = (0, llmService_1.extractJsonFromText)(text);
            const questions = coerceQuizResponse(object);
            const data = { questions };
            const response = {
                request_id: req.request_id,
                status: 'ok',
                served_from: 'fresh',
                data,
                usage: {
                    latency_ms: Date.now() - started,
                    model_id: usage?.modelId,
                    tokens_in: usage?.inputTokens,
                    tokens_out: usage?.outputTokens,
                },
            };
            cache.set(cacheKey, response, config_1.config.cacheTtlMs);
        }
        catch (error) {
            console.warn('[quiz] failed to cache response', error);
        }
    })();
    return { data: tappedStream, usage: usagePromise };
};
exports.handleQuiz = handleQuiz;
//# sourceMappingURL=quiz.js.map