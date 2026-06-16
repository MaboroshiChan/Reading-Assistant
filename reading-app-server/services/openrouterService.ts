import OpenAI from 'openai';
import { config, getOpenRouterApiKey } from '../src/config/runtime-config';
import { throwIfAborted } from '../src/utils/abort';
import type {
  LLMClient,
  LLMChatClient,
  LLMClientFactoryOptions,
  LLMOptions,
  CompleteResult,
  CallReturn,
  LLMUsage
} from './llmService';

export function createOpenRouterLLMClient(factoryOptions: LLMClientFactoryOptions): LLMClient {
  const systemPrompt = factoryOptions.systemPrompt.trim();
  if (!systemPrompt) {
    throw new Error('LLM client factory requires a non-empty system prompt');
  }

  return {
    async complete(userPrompt: string, opts: LLMOptions = {}): Promise<CompleteResult> {
      const { data, usage } = await callOpenRouter({
        systemPrompt,
        userPrompt,
        responseAs: 'text',
        model: opts.model ?? factoryOptions.model ?? config.model,
        temperature: opts.temperature ?? factoryOptions.temperature ?? config.temperature,
        maxOutputTokens: opts.maxOutputTokens ?? factoryOptions.maxOutputTokens,
        timeoutMs: opts.timeoutMs ?? factoryOptions.timeoutMs ?? config.timeoutMs,
        signal: opts.signal,
        prefixCache: opts.prefixCache ?? factoryOptions.prefixCache,
      });

      let text = '';
      for await (const chunk of data) {
        text += chunk;
      }
      return { text, usage: await usage };
    },

    json(userPrompt: string, opts: LLMOptions = {}): Promise<CallReturn<string>> {
      return callOpenRouter({
        systemPrompt,
        userPrompt,
        responseAs: 'json',
        model: opts.model ?? factoryOptions.model ?? config.model,
        temperature: opts.temperature ?? factoryOptions.temperature ?? config.temperature,
        maxOutputTokens: opts.maxOutputTokens ?? factoryOptions.maxOutputTokens,
        timeoutMs: opts.timeoutMs ?? factoryOptions.timeoutMs ?? config.timeoutMs,
        signal: opts.signal,
        prefixCache: opts.prefixCache ?? factoryOptions.prefixCache,
      });
    },
  };
}

export function createOpenRouterLLMChatClient(factoryOptions: LLMClientFactoryOptions): LLMChatClient {
  const systemPrompt = factoryOptions.systemPrompt.trim();
  if (!systemPrompt) {
    throw new Error('LLM client factory requires a non-empty system prompt');
  }

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY environment variable');
  }

  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  const defaultModel = factoryOptions.model ?? config.model;

  // We manually manage chat history for openrouter
  const textMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt }
  ];
  const jsonMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt }
  ];

  return {
    async complete(userPrompt: string, opts: LLMOptions = {}): Promise<CompleteResult> {
      const modelId = opts.model ?? defaultModel;
      textMessages.push({ role: 'user', content: userPrompt });

      const stream = await openai.chat.completions.create({
        model: modelId,
        messages: textMessages,
        temperature: factoryOptions.temperature ?? config.temperature,
        max_tokens: factoryOptions.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: opts.signal });

      let text = '';
      let usage: LLMUsage = { modelId };

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

    async json(userPrompt: string, opts: LLMOptions = {}): Promise<CallReturn<string>> {
      const modelId = opts.model ?? defaultModel;
      jsonMessages.push({ role: 'user', content: userPrompt });

      const stream = await openai.chat.completions.create({
        model: modelId,
        messages: jsonMessages,
        temperature: factoryOptions.temperature ?? config.temperature,
        max_tokens: factoryOptions.maxOutputTokens,
        response_format: { type: 'json_object' },
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: opts.signal });

      let resolveUsage!: (usage: LLMUsage) => void;
      const usagePromise = new Promise<LLMUsage>((resolve) => { resolveUsage = resolve; });

      const dataStream = (async function* () {
        let fullText = '';
        let latestUsage: LLMUsage = { modelId };
        
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

interface CallArgs {
  systemPrompt: string;
  userPrompt: string;
  responseAs: 'text' | 'json';
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  prefixCache?: any;
}

async function callOpenRouter(args: CallArgs): Promise<CallReturn<string>> {
  throwIfAborted(args.signal);

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY environment variable');
  }

  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  
  if (args.prefixCache?.prefix) {
    messages.push({ role: 'system', content: args.systemPrompt + '\n\n[Context]\n' + args.prefixCache.prefix });
  } else {
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

  let resolveUsage!: (usage: LLMUsage) => void;
  const usagePromise = new Promise<LLMUsage>((resolve) => { resolveUsage = resolve; });

  const dataStream = (async function* () {
    let latestUsage: LLMUsage = { modelId: args.model };
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
    } catch (error) {
      throw error;
    }
  })();

  return { data: dataStream, usage: usagePromise };
}
