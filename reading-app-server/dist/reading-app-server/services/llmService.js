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
exports.createLLMChatClient = createLLMChatClient;
exports.extractJsonFromText = extractJsonFromText;
const promises_1 = __importDefault(require("node:fs/promises"));
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
            });
        },
    };
}
/**
 * Creates a reusable stateful LLM chat client bound to a stable system prompt.
 * It uses the SDK's startChat method to preserve conversation history.
 */
function createLLMChatClient(factoryOptions) {
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
        throw normalizeError(error);
    }
}
async function callLLMDirect(args, apiKey, useDeveloperInstruction) {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    console.log(`LLM model is ${args.model}`);
    const requestPrompt = useDeveloperInstruction ? args.userPrompt : buildInlineSystemPrompt(args);
    let resolveUsage;
    let rejectUsage;
    const usagePromise = new Promise((resolve, reject) => {
        resolveUsage = resolve;
        rejectUsage = reject;
    });
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
        let latestUsage = { modelId: args.model };
        try {
            for await (const chunk of stream) {
                latestUsage = getUsageFromGenAIChunk(chunk, args.model);
                const text = typeof chunk.text === 'string' ? chunk.text : '';
                fullText += text;
                if (text) {
                    yield text;
                }
            }
            resolveUsage(latestUsage);
            if (config_1.config.debugMode) {
                console.log(`[${new Date().toISOString()}][info][llm-service] LLM response received`
                    + ` model=${args.model}`
                    + ` inlineSystemPrompt=${useDeveloperInstruction ? '0' : '1'}`
                    + ` prefixCache=0`
                    + ` responseAs=${args.responseAs}`
                    + ` inputTokens=${latestUsage.inputTokens ?? 0}`
                    + ` outputTokens=${latestUsage.outputTokens ?? 0}`);
            }
            void persistLLMResponse(args, fullText);
        }
        catch (error) {
            rejectUsage(error);
            throw error;
        }
    })();
    return { data: dataStream, usage: usagePromise };
}
async function callLLMWithCachedPrefix(args, apiKey, cachedContentName, useDeveloperInstruction) {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const requestPrompt = useDeveloperInstruction ? args.userPrompt : buildInlineSystemPrompt(args);
    const shouldSendSystemPrompt = useDeveloperInstruction && args.prefixCache?.systemPromptMode === 'request';
    let resolveUsage;
    let rejectUsage;
    const usagePromise = new Promise((resolve, reject) => {
        resolveUsage = resolve;
        rejectUsage = reject;
    });
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
        let latestUsage = { modelId: args.model };
        try {
            for await (const chunk of stream) {
                latestUsage = getUsageFromGenAIChunk(chunk, args.model);
                const text = typeof chunk.text === 'string' ? chunk.text : '';
                fullText += text;
                if (text) {
                    yield text;
                }
            }
            resolveUsage(latestUsage);
            if (config_1.config.debugMode) {
                console.log(`[${new Date().toISOString()}][info][llm-service] LLM response received`
                    + ` model=${args.model}`
                    + ` inlineSystemPrompt=0`
                    + ` prefixCache=1`
                    + ` responseAs=${args.responseAs}`
                    + ` inputTokens=${latestUsage.inputTokens ?? 0}`
                    + ` outputTokens=${latestUsage.outputTokens ?? 0}`);
            }
            void persistLLMResponse(args, fullText);
        }
        catch (error) {
            rejectUsage(error);
            throw error;
        }
    })();
    return { data: dataStream, usage: usagePromise };
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
    if (!config_1.config.debugMode)
        return;
    const timestamp = new Date().toISOString();
    const entry = {
        timestamp,
        model: args.model,
        responseAs: args.responseAs,
        temperature: args.temperature,
        maxOutputTokens: args.maxOutputTokens,
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
        prefixCache: args.prefixCache ?? undefined,
    };
    try {
        await promises_1.default.mkdir(LOG_DIR, { recursive: true });
        await promises_1.default.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
        console.log(`[llm-debug] ${timestamp} model=${args.model} responseAs=${args.responseAs}\n${formatDebugPrompt(args)}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[llm-debug] failed to persist prompt log: ${message}`);
    }
}
/**
 * Persists the LLM response to a JSON file in the resource directory for debugging and auditing.
 *
 * @param args - The original call arguments.
 * @param text - The raw text response from the LLM.
 */
async function persistLLMResponse(args, text) {
    try {
        await promises_1.default.mkdir(RESPONSE_DIR, { recursive: true });
        const timestamp = new Date().toISOString();
        const safeStamp = timestamp.replace(/[:.]/g, '-');
        const parsed = (() => {
            if (!text)
                return null;
            try {
                return JSON.parse(text);
            }
            catch {
                return null;
            }
        })();
        const record = {
            timestamp,
            model: args.model,
            responseAs: args.responseAs,
            text: text || null,
            parsed: parsed ?? undefined,
            systemPrompt: config_1.config.debugMode ? args.systemPrompt : undefined,
            userPrompt: config_1.config.debugMode ? args.userPrompt : undefined,
            prompt: config_1.config.debugMode ? formatDebugPrompt(args) : undefined,
        };
        const filePath = node_path_1.default.join(RESPONSE_DIR, `${safeStamp}_${args.model}.json`);
        await promises_1.default.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
    }
    catch (error) {
        console.warn('[llm-response] failed to persist response', error);
    }
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
        if (!unwrapped)
            return {};
        try {
            return JSON.parse(unwrapped);
        }
        catch {
            return {};
        }
    }
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
function normalizeError(error) {
    if ((0, abort_1.isAbortError)(error)) {
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
//# sourceMappingURL=llmService.js.map