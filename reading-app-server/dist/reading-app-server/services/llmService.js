"use strict";
/*
 * llmService.ts — Minimal LLM Adapter (no any)
 *
 * Purpose
 *  - Provide a tiny, framework-agnostic client factory for LLM calls used by handlers.
 *  - Each client is created with a stable system prompt and then executes user prompts.
 *  - Decoupled from client envelopes; handlers decide prompts and DTO types.
 *
 * Notes
 *  - This implementation currently targets the Google Gemini SDK.
 *  - If you use a different provider, only edit `callLLM()` and the text extraction helpers.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLLMClient = createLLMClient;
exports.createGeminiLLMClient = createGeminiLLMClient;
exports.createLLMChatClient = createLLMChatClient;
exports.createGeminiLLMChatClient = createGeminiLLMChatClient;
exports.extractJsonFromText = extractJsonFromText;
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const generative_ai_1 = require("@google/generative-ai");
const abort_1 = require("../src/utils/abort");
// -----------------------------
// Public API
// -----------------------------
/**
 * Creates a reusable LLM client bound to a stable system prompt.
 */
function createLLMClient(factoryOptions) {
    return createGeminiLLMClient(factoryOptions);
}
// -----------------------------
// Gemini implementation
// -----------------------------
function createGeminiLLMClient(factoryOptions) {
    const systemPrompt = factoryOptions.systemPrompt.trim();
    if (!systemPrompt) {
        throw new Error('LLM client factory requires a non-empty system prompt');
    }
    return {
        async complete(userPrompt, opts = {}) {
            const { data, usage } = await callLLM({
                systemPrompt,
                userPrompt,
                responseAs: 'text',
                model: opts.model ?? factoryOptions.model ?? config_1.config.model,
                temperature: opts.temperature ?? factoryOptions.temperature ?? config_1.config.temperature,
                maxOutputTokens: opts.maxOutputTokens ?? factoryOptions.maxOutputTokens,
                timeoutMs: opts.timeoutMs ?? factoryOptions.timeoutMs ?? config_1.config.timeoutMs,
                signal: opts.signal,
                prefixCache: opts.prefixCache ?? factoryOptions.prefixCache,
                logContext: opts.logContext ?? factoryOptions.logContext,
            });
            let text = '';
            for await (const chunk of data) {
                text += chunk;
            }
            return { text, usage: await usage };
        },
        json(userPrompt, opts = {}) {
            return callLLM({
                systemPrompt,
                userPrompt,
                responseAs: 'json',
                model: opts.model ?? factoryOptions.model ?? config_1.config.model,
                temperature: opts.temperature ?? factoryOptions.temperature ?? config_1.config.temperature,
                maxOutputTokens: opts.maxOutputTokens ?? factoryOptions.maxOutputTokens,
                timeoutMs: opts.timeoutMs ?? factoryOptions.timeoutMs ?? config_1.config.timeoutMs,
                signal: opts.signal,
                prefixCache: opts.prefixCache ?? factoryOptions.prefixCache,
                logContext: opts.logContext ?? factoryOptions.logContext,
            });
        },
    };
}
/**
 * Creates a reusable stateful LLM chat client bound to a stable system prompt.
 * It uses the SDK's startChat method to preserve conversation history.
 */
function createLLMChatClient(factoryOptions) {
    return createGeminiLLMChatClient(factoryOptions);
}
function createGeminiLLMChatClient(factoryOptions) {
    const systemPrompt = factoryOptions.systemPrompt.trim();
    if (!systemPrompt) {
        throw new Error('LLM client factory requires a non-empty system prompt');
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY environment variable');
    }
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const defaultModel = factoryOptions.model ?? config_1.config.model;
    // We maintain two separate chat sessions: one for JSON and one for text,
    // since responseMimeType is tied to the model/session in the SDK.
    const jsonModel = genAI.getGenerativeModel({
        model: defaultModel,
        systemInstruction: systemPrompt,
        generationConfig: {
            maxOutputTokens: factoryOptions.maxOutputTokens,
            temperature: factoryOptions.temperature ?? config_1.config.temperature,
            responseMimeType: 'application/json',
        },
    });
    const jsonChat = jsonModel.startChat();
    const textModel = genAI.getGenerativeModel({
        model: defaultModel,
        systemInstruction: systemPrompt,
        generationConfig: {
            maxOutputTokens: factoryOptions.maxOutputTokens,
            temperature: factoryOptions.temperature ?? config_1.config.temperature,
            responseMimeType: 'text/plain',
        },
    });
    const textChat = textModel.startChat();
    return {
        async complete(userPrompt, opts = {}) {
            const modelId = opts.model ?? defaultModel;
            if (config_1.config.debugMode) {
                console.log(`[llm-debug] Chat complete (text) model=${modelId} userPrompt=${userPrompt.substring(0, 50)}...`);
            }
            const result = await textChat.sendMessageStream(userPrompt);
            const usagePromise = result.response.then(res => ({
                inputTokens: res.usageMetadata?.promptTokenCount || 0,
                outputTokens: res.usageMetadata?.candidatesTokenCount || 0,
                modelId,
            }));
            let text = '';
            for await (const chunk of result.stream) {
                text += chunk.text();
            }
            return { text, usage: await usagePromise };
        },
        async json(userPrompt, opts = {}) {
            const modelId = opts.model ?? defaultModel;
            if (config_1.config.debugMode) {
                console.log(`[llm-debug] Chat json model=${modelId} userPrompt=${userPrompt.substring(0, 50)}...`);
            }
            const result = await jsonChat.sendMessageStream(userPrompt);
            const usagePromise = result.response.then(res => ({
                inputTokens: res.usageMetadata?.promptTokenCount || 0,
                outputTokens: res.usageMetadata?.candidatesTokenCount || 0,
                modelId,
            }));
            const dataStream = (async function* () {
                let fullText = '';
                for await (const chunk of result.stream) {
                    const text = chunk.text();
                    fullText += text;
                    yield text;
                }
                if (config_1.config.debugMode) {
                    const u = await usagePromise;
                    console.log(`[${new Date().toISOString()}][info][llm-service] LLM chat response received`
                        + ` model=${modelId}`
                        + ` responseAs=json`
                        + ` inputTokens=${u.inputTokens ?? 0}`
                        + ` outputTokens=${u.outputTokens ?? 0}`);
                }
            })();
            return { data: dataStream, usage: usagePromise };
        },
    };
}
const LOG_DIR = node_path_1.default.join(__dirname, '..', 'log');
const LOG_FILE = node_path_1.default.join(LOG_DIR, 'prompts.log');
const RESPONSE_DIR = node_path_1.default.join(__dirname, '..', '..', 'resource', 'LLM_response');
const cachedContentNames = new Map();
function supportsDeveloperInstruction(model) {
    return !/^gemma-/i.test(model.trim());
}
function buildInlineSystemPrompt(args) {
    return [
        '[System Instructions]',
        args.systemPrompt,
        '',
        '[User Prompt]',
        args.userPrompt,
    ].join('\n');
}
/**
 * Calls the configured LLM implementation.
 *
 * @param args - Arguments for the LLM call.
 * @returns A promise resolving to a CallReturn with streaming data and usage.
 */
async function callLLM(args) {
    await logPromptIfDebug(args);
    (0, abort_1.throwIfAborted)(args.signal);
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('Missing GEMINI_API_KEY environment variable');
        }
        const useDeveloperInstruction = supportsDeveloperInstruction(args.model);
        const cachedContentName = await resolveCachedContentName(args, apiKey, useDeveloperInstruction);
        if (cachedContentName) {
            try {
                return await callLLMWithCachedPrefix(args, apiKey, cachedContentName, useDeveloperInstruction);
            }
            catch (error) {
                if (!isCachedContentError(error)) {
                    throw error;
                }
                invalidateCachedContentName(args.prefixCache?.cacheKey);
                if (config_1.config.debugMode) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`[llm-cache] cached prefix request failed; retrying uncached (${message})`);
                }
            }
        }
        return callLLMDirect(args, apiKey, useDeveloperInstruction);
    }
    catch (error) {
        throw normalizeError(error, args);
    }
}
async function callLLMDirect(args, apiKey, useDeveloperInstruction) {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    logLLMEvent('request.start', args, {
        inlineSystemPrompt: useDeveloperInstruction ? 0 : 1,
        prefixCache: 0,
    });
    const requestPrompt = useDeveloperInstruction ? args.userPrompt : buildInlineSystemPrompt(args);
    const usageTracker = createUsageTracker(args.model);
    const stream = await ai.models.generateContentStream({
        model: args.model,
        contents: requestPrompt,
        config: {
            ...(useDeveloperInstruction ? { systemInstruction: args.systemPrompt } : {}),
            maxOutputTokens: args.maxOutputTokens,
            temperature: args.temperature,
            responseMimeType: args.responseAs === 'json' ? 'application/json' : 'text/plain',
            abortSignal: args.signal,
            httpOptions: {
                timeout: args.timeoutMs,
            },
        },
    });
    const dataStream = (async function* () {
        let fullText = '';
        try {
            for await (const chunk of stream) {
                Object.assign(usageTracker.latestUsage, getUsageFromGenAIChunk(chunk, args.model));
                const text = typeof chunk.text === 'string' ? chunk.text : '';
                fullText += text;
                if (text) {
                    yield text;
                }
            }
            usageTracker.resolve();
            logLLMEvent('response.received', args, {
                inlineSystemPrompt: useDeveloperInstruction ? 0 : 1,
                prefixCache: 0,
                inputTokens: usageTracker.latestUsage.inputTokens ?? 0,
                outputTokens: usageTracker.latestUsage.outputTokens ?? 0,
            });
            void persistLLMResponse(args, fullText);
        }
        catch (error) {
            usageTracker.fail(error);
            throw normalizeError(error, args);
        }
    })();
    return { data: dataStream, usage: usageTracker.usage };
}
async function callLLMWithCachedPrefix(args, apiKey, cachedContentName, useDeveloperInstruction) {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const requestPrompt = useDeveloperInstruction ? args.userPrompt : buildInlineSystemPrompt(args);
    const shouldSendSystemPrompt = useDeveloperInstruction && args.prefixCache?.systemPromptMode === 'request';
    logLLMEvent('request.start', args, {
        inlineSystemPrompt: 0,
        prefixCache: 1,
        cachedSystemPrompt: shouldSendSystemPrompt ? 0 : 1,
    });
    const usageTracker = createUsageTracker(args.model);
    const stream = await ai.models.generateContentStream({
        model: args.model,
        contents: requestPrompt,
        config: {
            cachedContent: cachedContentName,
            ...(shouldSendSystemPrompt ? { systemInstruction: args.systemPrompt } : {}),
            maxOutputTokens: args.maxOutputTokens,
            temperature: args.temperature,
            responseMimeType: args.responseAs === 'json' ? 'application/json' : 'text/plain',
            abortSignal: args.signal,
            httpOptions: {
                timeout: args.timeoutMs,
            },
        },
    });
    const dataStream = (async function* () {
        let fullText = '';
        try {
            for await (const chunk of stream) {
                Object.assign(usageTracker.latestUsage, getUsageFromGenAIChunk(chunk, args.model));
                const text = typeof chunk.text === 'string' ? chunk.text : '';
                fullText += text;
                if (text) {
                    yield text;
                }
            }
            usageTracker.resolve();
            logLLMEvent('response.received', args, {
                inlineSystemPrompt: 0,
                prefixCache: 1,
                cachedSystemPrompt: shouldSendSystemPrompt ? 0 : 1,
                inputTokens: usageTracker.latestUsage.inputTokens ?? 0,
                outputTokens: usageTracker.latestUsage.outputTokens ?? 0,
            });
            void persistLLMResponse(args, fullText);
        }
        catch (error) {
            usageTracker.fail(error);
            throw normalizeError(error, args);
        }
    })();
    return { data: dataStream, usage: usageTracker.usage };
}
function logLLMEvent(event, args, fields) {
    const context = formatLLMLogContext({
        model: args.model,
        responseAs: args.responseAs,
        ...fields,
        ...args.logContext,
    });
    console.log(`[${new Date().toISOString()}][info][llm-service][${event}] ${context}`);
}
function formatLLMLogContext(context) {
    return Object.entries(context)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
}
async function resolveCachedContentName(args, apiKey, useDeveloperInstruction) {
    const prefixCache = args.prefixCache;
    if (!prefixCache || prefixCache.prefix.trim().length === 0) {
        return null;
    }
    const existing = cachedContentNames.get(prefixCache.cacheKey);
    if (existing) {
        return existing;
    }
    const creation = createCachedContentName(args, apiKey, useDeveloperInstruction).catch((error) => {
        if (config_1.config.debugMode) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[llm-cache] failed to create cached prefix for ${prefixCache.cacheKey}: ${message}`);
        }
        return null;
    });
    cachedContentNames.set(prefixCache.cacheKey, creation);
    return creation;
}
async function createCachedContentName(args, apiKey, useDeveloperInstruction) {
    const prefixCache = args.prefixCache;
    if (!prefixCache || prefixCache.prefix.trim().length === 0) {
        return null;
    }
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const ttlSeconds = Math.max(60, prefixCache.ttlSeconds ?? Math.floor(config_1.config.cacheTtlMs / 1000));
    const systemPromptMode = prefixCache.systemPromptMode ?? 'cached';
    const cachedPrefixText = (() => {
        if (systemPromptMode === 'request') {
            return prefixCache.prefix;
        }
        if (useDeveloperInstruction) {
            return prefixCache.prefix;
        }
        return [
            '[System Instructions]',
            args.systemPrompt,
            '',
            '[Cached Prefix]',
            prefixCache.prefix,
        ].join('\n');
    })();
    const cachedContent = await ai.caches.create({
        model: args.model,
        config: {
            contents: cachedPrefixText,
            displayName: prefixCache.displayName ?? prefixCache.cacheKey.slice(0, 128),
            ttl: `${ttlSeconds}s`,
            systemInstruction: useDeveloperInstruction && systemPromptMode === 'cached' ? args.systemPrompt : undefined,
        },
    });
    return typeof cachedContent.name === 'string' && cachedContent.name.trim().length > 0
        ? cachedContent.name
        : null;
}
function invalidateCachedContentName(cacheKey) {
    if (!cacheKey)
        return;
    cachedContentNames.delete(cacheKey);
}
function isCachedContentError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /cached.?content|context cache/i.test(message);
}
function getUsageFromGenAIChunk(chunk, modelId) {
    return {
        inputTokens: chunk.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: chunk.usageMetadata?.candidatesTokenCount ?? 0,
        modelId,
    };
}
/**
 * Logs the LLM prompt to the filesystem if debug mode is enabled.
 *
 * @param args - Arguments for the LLM call.
 */
async function logPromptIfDebug(args) {
    return;
}
/**
 * Persists the LLM response to a JSON file in the resource directory for debugging and auditing.
 *
 * @param args - The original call arguments.
 * @param text - The raw text response from the LLM.
 */
async function persistLLMResponse(args, text) {
    return;
}
/**
 * Extracts a JSON object from a text string, handling potential markdown code fences.
 *
 * @param text - The raw text containing JSON.
 * @returns The parsed JSON object or an empty object if parsing fails.
 */
function extractJsonFromText(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return {};
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Some models may wrap JSON in markdown fences
        const unwrapped = unwrapCodeFence(trimmed);
        if (unwrapped) {
            try {
                return JSON.parse(unwrapped);
            }
            catch {
                const extracted = extractBestEmbeddedJson(unwrapped);
                if (extracted !== null)
                    return extracted;
            }
        }
        const extracted = extractBestEmbeddedJson(trimmed);
        return extracted ?? {};
    }
}
function extractBestEmbeddedJson(text) {
    const candidates = collectBalancedJsonObjectCandidates(text);
    let bestScore = -1;
    let bestLength = -1;
    let bestValue = null;
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            const score = scoreJsonCandidate(parsed);
            if (score > bestScore || (score === bestScore && candidate.length > bestLength)) {
                bestScore = score;
                bestLength = candidate.length;
                bestValue = parsed;
            }
        }
        catch {
            // ignore invalid candidate
        }
    }
    return bestScore >= 0 ? bestValue : null;
}
function collectBalancedJsonObjectCandidates(text) {
    const candidates = [];
    const startIndexes = [];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (char === '{') {
            startIndexes.push(index);
            continue;
        }
        if (char === '}') {
            const start = startIndexes.pop();
            if (start === undefined)
                continue;
            candidates.push(text.slice(start, index + 1));
        }
    }
    return candidates;
}
function scoreJsonCandidate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return -1;
    const record = value;
    const keys = Object.keys(record);
    if (keys.length === 0)
        return 0;
    let score = keys.length;
    if (Array.isArray(record.nodes))
        score += 30;
    if (Array.isArray(record.edges))
        score += 30;
    if (Array.isArray(record.evidence))
        score += 30;
    if (Array.isArray(record.people))
        score += 12;
    if (Array.isArray(record.ideas))
        score += 12;
    if (Array.isArray(record.events))
        score += 12;
    if (Array.isArray(record.entities))
        score += 12;
    if (Array.isArray(record.themes))
        score += 12;
    if (Array.isArray(record.relations))
        score += 12;
    if (Array.isArray(record.questions))
        score += 20;
    if (record.data && typeof record.data === 'object' && !Array.isArray(record.data))
        score += 5;
    return score;
}
/**
 * Removes markdown code fences from a string.
 *
 * @param s - The string to unwrap.
 * @returns The unwrapped content or null if no fence is found.
 */
function unwrapCodeFence(s) {
    const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/;
    const m = s.match(fence);
    return m ? m[1] : null;
}
/**
 * Normalizes an unknown error into a standard Error object.
 *
 * @param error - The unknown error.
 * @returns A standard Error object.
 */
function normalizeError(error, args) {
    if ((0, abort_1.isAbortError)(error)) {
        if (!args?.signal?.aborted) {
            const timeoutMs = args?.timeoutMs;
            return new Error(timeoutMs && Number.isFinite(timeoutMs)
                ? `LLM request timed out after ${timeoutMs}ms`
                : 'LLM request timed out');
        }
        return error instanceof Error ? error : new Error('Operation aborted');
    }
    if (error instanceof Error)
        return error;
    return new Error('Unknown LLM client error');
}
function formatDebugPrompt(args) {
    const sections = [
        '[System Prompt]',
        args.systemPrompt,
        '',
    ];
    if (args.prefixCache) {
        sections.push('[Cached Prefix]', args.prefixCache.prefix, '', '[User Prompt]', args.userPrompt);
        return sections.join('\n');
    }
    sections.push('[User Prompt]', args.userPrompt);
    return sections.join('\n');
}
function createUsageTracker(modelId) {
    let resolveUsage;
    let settled = false;
    const latestUsage = { modelId };
    const usage = new Promise((resolve) => {
        resolveUsage = resolve;
    });
    const resolve = (usageValue) => {
        if (settled)
            return;
        settled = true;
        resolveUsage(usageValue ?? latestUsage);
    };
    const fail = () => {
        resolve(latestUsage);
    };
    return {
        latestUsage,
        usage,
        resolve,
        fail,
    };
}
//# sourceMappingURL=llmService.js.map