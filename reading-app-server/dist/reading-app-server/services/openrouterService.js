"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenRouterLLMClient = createOpenRouterLLMClient;
exports.createOpenRouterLLMChatClient = createOpenRouterLLMChatClient;
const openai_1 = __importDefault(require("openai"));
const runtime_config_1 = require("../src/config/runtime-config");
const abort_1 = require("../src/utils/abort");
function createOpenRouterLLMClient(factoryOptions) {
    const systemPrompt = factoryOptions.systemPrompt.trim();
    if (!systemPrompt) {
        throw new Error('LLM client factory requires a non-empty system prompt');
    }
    return {
        async complete(userPrompt, opts = {}) {
            const { data, usage } = await callOpenRouter({
                systemPrompt,
                userPrompt,
                responseAs: 'text',
                model: opts.model ?? factoryOptions.model ?? runtime_config_1.config.model,
                temperature: opts.temperature ?? factoryOptions.temperature ?? runtime_config_1.config.temperature,
                maxOutputTokens: opts.maxOutputTokens ?? factoryOptions.maxOutputTokens,
                timeoutMs: opts.timeoutMs ?? factoryOptions.timeoutMs ?? runtime_config_1.config.timeoutMs,
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
            return callOpenRouter({
                systemPrompt,
                userPrompt,
                responseAs: 'json',
                model: opts.model ?? factoryOptions.model ?? runtime_config_1.config.model,
                temperature: opts.temperature ?? factoryOptions.temperature ?? runtime_config_1.config.temperature,
                maxOutputTokens: opts.maxOutputTokens ?? factoryOptions.maxOutputTokens,
                timeoutMs: opts.timeoutMs ?? factoryOptions.timeoutMs ?? runtime_config_1.config.timeoutMs,
                signal: opts.signal,
                prefixCache: opts.prefixCache ?? factoryOptions.prefixCache,
            });
        },
    };
}
function createOpenRouterLLMChatClient(factoryOptions) {
    const systemPrompt = factoryOptions.systemPrompt.trim();
    if (!systemPrompt) {
        throw new Error('LLM client factory requires a non-empty system prompt');
    }
    const apiKey = (0, runtime_config_1.getOpenRouterApiKey)();
    if (!apiKey) {
        throw new Error('Missing OPENROUTER_API_KEY environment variable');
    }
    const openai = new openai_1.default({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
    });
    const defaultModel = factoryOptions.model ?? runtime_config_1.config.model;
    // We manually manage chat history for openrouter
    const textMessages = [
        { role: 'system', content: systemPrompt }
    ];
    const jsonMessages = [
        { role: 'system', content: systemPrompt }
    ];
    return {
        async complete(userPrompt, opts = {}) {
            const modelId = opts.model ?? defaultModel;
            textMessages.push({ role: 'user', content: userPrompt });
            const stream = await openai.chat.completions.create({
                model: modelId,
                messages: textMessages,
                temperature: factoryOptions.temperature ?? runtime_config_1.config.temperature,
                max_tokens: factoryOptions.maxOutputTokens,
                stream: true,
                stream_options: { include_usage: true },
            }, { signal: opts.signal });
            let text = '';
            let usage = { modelId };
            for await (const chunk of stream) {
                if (chunk.choices[0]?.delta?.content) {
                    text += chunk.choices[0].delta.content;
                }
                if (chunk.usage) {
                    usage.inputTokens = chunk.usage.prompt_tokens;
                    usage.outputTokens = chunk.usage.completion_tokens;
                }
            }
            textMessages.push({ role: 'assistant', content: text });
            return { text, usage };
        },
        async json(userPrompt, opts = {}) {
            const modelId = opts.model ?? defaultModel;
            jsonMessages.push({ role: 'user', content: userPrompt });
            const stream = await openai.chat.completions.create({
                model: modelId,
                messages: jsonMessages,
                temperature: factoryOptions.temperature ?? runtime_config_1.config.temperature,
                max_tokens: factoryOptions.maxOutputTokens,
                response_format: { type: 'json_object' },
                stream: true,
                stream_options: { include_usage: true },
            }, { signal: opts.signal });
            let resolveUsage;
            const usagePromise = new Promise((resolve) => { resolveUsage = resolve; });
            const dataStream = (async function* () {
                let fullText = '';
                let latestUsage = { modelId };
                for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    fullText += content;
                    if (content) {
                        yield content;
                    }
                    if (chunk.usage) {
                        latestUsage.inputTokens = chunk.usage.prompt_tokens;
                        latestUsage.outputTokens = chunk.usage.completion_tokens;
                    }
                }
                jsonMessages.push({ role: 'assistant', content: fullText });
                resolveUsage(latestUsage);
            })();
            return { data: dataStream, usage: usagePromise };
        },
    };
}
async function callOpenRouter(args) {
    (0, abort_1.throwIfAborted)(args.signal);
    const apiKey = (0, runtime_config_1.getOpenRouterApiKey)();
    if (!apiKey) {
        throw new Error('Missing OPENROUTER_API_KEY environment variable');
    }
    const openai = new openai_1.default({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
    });
    const messages = [];
    if (args.prefixCache?.prefix) {
        messages.push({ role: 'system', content: args.systemPrompt + '\n\n[Context]\n' + args.prefixCache.prefix });
    }
    else {
        messages.push({ role: 'system', content: args.systemPrompt });
    }
    messages.push({ role: 'user', content: args.userPrompt });
    const stream = await openai.chat.completions.create({
        model: args.model,
        messages,
        temperature: args.temperature,
        max_tokens: args.maxOutputTokens,
        response_format: args.responseAs === 'json' ? { type: 'json_object' } : undefined,
        stream: true,
        stream_options: { include_usage: true },
    }, { signal: args.signal, timeout: args.timeoutMs });
    let resolveUsage;
    const usagePromise = new Promise((resolve) => { resolveUsage = resolve; });
    const dataStream = (async function* () {
        let latestUsage = { modelId: args.model };
        try {
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    yield content;
                }
                if (chunk.usage) {
                    latestUsage.inputTokens = chunk.usage.prompt_tokens;
                    latestUsage.outputTokens = chunk.usage.completion_tokens;
                }
            }
            resolveUsage(latestUsage);
        }
        catch (error) {
            throw error;
        }
    })();
    return { data: dataStream, usage: usagePromise };
}
//# sourceMappingURL=openrouterService.js.map