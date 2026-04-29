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
exports.extractJsonFromText = extractJsonFromText;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const generative_ai_1 = require("@google/generative-ai");
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
            });
        },
    };
}
const LOG_DIR = node_path_1.default.join(__dirname, '..', 'log');
const LOG_FILE = node_path_1.default.join(LOG_DIR, 'prompts.log');
const RESPONSE_DIR = node_path_1.default.join(__dirname, '..', '..', 'resource', 'LLM_response');
/**
 * Calls the configured LLM implementation.
 *
 * @param args - Arguments for the LLM call.
 * @returns A promise resolving to a CallReturn with streaming data and usage.
 */
async function callLLM(args) {
    await logPromptIfDebug(args);
    // Note: The Google Generative AI Node SDK does not currently expose a simple AbortSignal hook
    // for generateContent in the same way fetch does, but we can respect the timeout for the wrapper.
    // For this implementation, we rely on the promise race or just standard await.
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('Missing GEMINI_API_KEY environment variable');
        }
        const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        console.log(`LLM model is ${args.model}`);
        const model = genAI.getGenerativeModel({
            model: args.model,
            systemInstruction: args.systemPrompt,
            generationConfig: {
                maxOutputTokens: args.maxOutputTokens,
                temperature: args.temperature,
                responseMimeType: args.responseAs === 'json' ? 'application/json' : 'text/plain',
            },
        });
        const result = await model.generateContentStream(args.userPrompt);
        const usagePromise = result.response.then(res => ({
            inputTokens: res.usageMetadata?.promptTokenCount || 0,
            outputTokens: res.usageMetadata?.candidatesTokenCount || 0,
            modelId: args.model,
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
                console.log(`[${new Date().toISOString()}][info][llm-service] LLM response received`
                    + ` model=${args.model}`
                    + ` responseAs=${args.responseAs}`
                    + ` inputTokens=${u.inputTokens ?? 0}`
                    + ` outputTokens=${u.outputTokens ?? 0}`);
            }
            void persistLLMResponse(args, fullText);
        })();
        return { data: dataStream, usage: usagePromise };
    }
    catch (error) {
        throw normalizeError(error);
    }
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
    if (error instanceof Error)
        return error;
    return new Error('Unknown LLM client error');
}
function formatDebugPrompt(args) {
    return [
        '[System Prompt]',
        args.systemPrompt,
        '',
        '[User Prompt]',
        args.userPrompt,
    ].join('\n');
}
//# sourceMappingURL=llmService.js.map