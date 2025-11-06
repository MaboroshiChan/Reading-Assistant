/*
 * llmService.ts — Minimal LLM Adapter (no any)
 *
 * Purpose
 *  - Provide a tiny, framework-agnostic client for LLM calls used by handlers.
 *  - Two entrypoints:
 *      1) complete(): prompt → plain text
 *      2) json<T>(): prompt → structured JSON (runtime-validated if you pass a validator)
 *  - Decoupled from client envelopes; handlers decide prompts and DTO types.
 *
 * Notes
 *  - This implementation targets an OpenAI-compatible "Responses" API.
 *  - If you use a different provider, only edit `callLLM()` and the text extraction helpers.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';

// -----------------------------
// Public types
// -----------------------------

export interface LLMOptions {
  model?: string;           // override default model
  temperature?: number;     // 0..2
  maxOutputTokens?: number; // provider-specific (OpenAI: max_output_tokens)
  timeoutMs?: number;       // request timeout
  signal?: AbortSignal;     // external cancel
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
}

export interface CompleteResult {
  text: string;
  usage: LLMUsage;
}

export interface JsonResult<T> {
  object: T;
  usage: LLMUsage;
}

// Optional runtime validator signature (e.g., from Zod: (u) => schema.parse(u))
export type Validator<T> = (u: unknown) => T;

// -----------------------------
// Public API
// -----------------------------

/** Plain-text completion */
export async function complete(prompt: string, opts: LLMOptions = {}): Promise<CompleteResult> {
  const { data, usage } = await callLLM<string>({
    prompt,
    responseAs: 'text',
    model: opts.model ?? config.model,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    timeoutMs: opts.timeoutMs ?? config.timeoutMs,
    signal: opts.signal,
  });

  return { text: data, usage };
}

/** JSON-structured completion. If you pass a validator, it will be applied before returning. */
export async function json<T>(
  prompt: string,
  validator?: Validator<T>,
  opts: LLMOptions = {}
): Promise<JsonResult<T>> {
  const { data, usage } = await callLLM({
    prompt,
    responseAs: 'json',
    model: opts.model ?? config.model,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    timeoutMs: opts.timeoutMs ?? config.timeoutMs,
    signal: opts.signal,
  });

  // `data` is unknown until we validate or assert
  const parsed: unknown = data;
  const object: T = validator ? validator(parsed) : (parsed as T);
  return { object, usage };
}

// -----------------------------
// Internal plumbing (OpenAI-compatible Responses API)
// -----------------------------

type ResponseShape = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<unknown>;   // new Responses API
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  // Chat Completions (fallback) shape
  choices?: Array<{ message?: { content?: string }; text?: string }>;
};

interface CallArgs {
  prompt: string;
  responseAs: 'text' | 'json';
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

interface CallReturn<T> { data: T; usage: LLMUsage }

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

class LLMHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'LLMHttpError';
    this.status = status;
    this.body = body;
  }
}

const LOG_DIR = path.join(__dirname, '..', 'log');
const LOG_FILE = path.join(LOG_DIR, 'prompts.log');
const RESPONSE_DIR = path.join(__dirname, '..', '..', 'resource', 'LLM_response');

async function callLLM<T extends string | unknown>(args: CallArgs): Promise<CallReturn<T>> {
  await logPromptIfDebug(args);

  if (config.useMockLLM) {
    return callMockLLM<T>(args);
  }

  const controller = new AbortController();
  const signal = linkSignals(controller, args.signal);
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    if (!config.apiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable for OpenAI client');
    }

    const body = buildRequestBody(
      args.prompt,
      args.responseAs,
      args.model,
      args.temperature,
      args.maxOutputTokens,
    );
    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      throw new LLMHttpError(`Non-JSON response from LLM (status ${res.status})`, res.status, null);
    }

    if (!res.ok) {
      const message =
        (typeof payload === 'object' && payload && 'error' in payload && typeof (payload as { error?: { message?: string } }).error?.message === 'string')
          ? String((payload as { error?: { message?: string } }).error?.message)
          : `OpenAI request failed with status ${res.status}`;
      throw new LLMHttpError(message, res.status, payload);
    }

    const json = payload as ResponseShape;
    void persistLLMResponse(args, json);

    const usage: LLMUsage = {
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
      modelId: json.model,
    };

    if (args.responseAs === 'text') {
      const text = extractText(json);
      return { data: text as T, usage };
    }

    // responseAs === 'json'
    const obj = extractJson(json);
    return { data: obj as T, usage };
  } catch (error: unknown) {
    throw normalizeError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function logPromptIfDebug(args: CallArgs): Promise<void> {
  if (!config.debugMode) return;
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    model: args.model,
    responseAs: args.responseAs,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    prompt: args.prompt,
  };

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
    console.log(
      `[llm-debug] ${timestamp} model=${args.model} responseAs=${args.responseAs}\n${args.prompt}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[llm-debug] failed to persist prompt log: ${message}`);
  }
}

async function callMockLLM<T extends string | unknown>(args: CallArgs): Promise<CallReturn<T>> {
  if (args.signal?.aborted) {
    throw new Error('Mock LLM call aborted');
  }

  const usage: LLMUsage = {
    modelId: `mock:${args.model}`,
    inputTokens: 0,
    outputTokens: 0,
  };

  if (args.responseAs === 'text') {
    const reply = `[mock:${args.model}] ${truncate(args.prompt.replace(/\s+/g, ' ').trim(), 200)}`;
    return { data: reply as T, usage };
  }

  const json = extractJsonFromPrompt(args.prompt) ?? {
    mock: true,
    model: args.model,
    prompt_preview: truncate(args.prompt, 200),
  };
  return { data: json as T, usage };
}

async function persistLLMResponse(args: CallArgs, payload: ResponseShape): Promise<void> {
  try {
    await fs.mkdir(RESPONSE_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    const safeStamp = timestamp.replace(/[:.]/g, '-');
    const textBlock = extractText(payload);
    const parsed = (() => {
      if (!textBlock) return null;
      try {
        return JSON.parse(textBlock);
      } catch {
        const unwrapped = unwrapCodeFence(textBlock);
        if (!unwrapped) return null;
        try {
          return JSON.parse(unwrapped);
        } catch {
          return null;
        }
      }
    })();
    const record = {
      timestamp,
      model: args.model,
      responseAs: args.responseAs,
      text: textBlock || null,
      parsed: parsed ?? undefined,
      prompt: config.debugMode ? args.prompt : undefined,
    };
    const filePath = path.join(RESPONSE_DIR, `${safeStamp}_${args.model}.json`);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
  } catch (error) {
    console.warn('[llm-response] failed to persist response', error);
  }
}

function buildRequestBody(
  prompt: string,
  responseAs: 'text' | 'json',
  model: string,
  temperature?: number,
  maxOutputTokens?: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model,
    input: prompt,
  };

  if (temperature !== undefined) base.temperature = temperature;
  if (maxOutputTokens !== undefined) base.max_output_tokens = maxOutputTokens;

  if (responseAs === 'json') {
    base.text = {
      format: {
        type: 'json_schema',
        name: 'response',
        schema: {
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
        strict: false,
      },
    };
  } else {
    base.text = {
      format: {
        type: 'text',
        name: 'default',
      },
    };
  }

  return base;
}



// Extract text from either Responses API or Chat Completions fallbacks
function extractText(resp: ResponseShape): string {
  if (typeof resp.output_text === 'string' && resp.output_text.length > 0) {
    return resp.output_text;
  }
  // Responses API: output[].text
  const out = resp.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      if (item && typeof item === 'object' && 'content' in item) {
        // Some providers use { type: 'output_text', content: [ { type: 'output_text', text: '...' } ] }
        const content = (item as { content?: Array<unknown> }).content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c && typeof c === 'object' && 'text' in c) {
              const t = (c as { text?: string }).text;
              if (typeof t === 'string') return t;
            }
          }
        }
      }
      if (item && typeof item === 'object' && 'text' in item) {
        const t = (item as { text?: string }).text;
        if (typeof t === 'string') return t;
      }
    }
  }
  // Chat Completions fallback
  const ch = resp.choices;
  if (Array.isArray(ch) && ch.length > 0) {
    const c = ch[0];
    if (c.text && typeof c.text === 'string') return c.text;
    const msg = c.message?.content;
    if (typeof msg === 'string') return msg;
  }
  return '';
}

// Extract JSON value (object) from text output
function extractJson(resp: ResponseShape): unknown {
  const text = extractText(resp).trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Some models may wrap JSON in markdown fences
    const unwrapped = unwrapCodeFence(text);
    if (!unwrapped) return {};
    try { return JSON.parse(unwrapped) as unknown; } catch { return {}; }
  }
}

function unwrapCodeFence(s: string): string | null {
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/;
  const m = s.match(fence);
  return m ? m[1] : null;
}

function linkSignals(inner: AbortController, outer?: AbortSignal): AbortSignal {
  if (!outer) return inner.signal;
  if (outer.aborted) { inner.abort(); return inner.signal; }
  const onAbort = () => inner.abort();
  outer.addEventListener('abort', onAbort, { once: true });
  return inner.signal;
}

function normalizeError(error: unknown): Error {
  if (error instanceof LLMHttpError) {
    const details =
      typeof error.body === 'object' && error.body !== null
        ? JSON.stringify(error.body)
        : String(error.body ?? '');
    const message = details ? `${error.message} (status ${error.status}) :: ${details}` : `${error.message} (status ${error.status})`;
    return new Error(message);
  }
  if (error instanceof Error) return error;
  return new Error('Unknown LLM client error');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function extractJsonFromPrompt(prompt: string): unknown | null {
  const fenceMatch = prompt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : findFirstJsonBlock(prompt);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function findFirstJsonBlock(prompt: string): string | null {
  const firstBrace = prompt.indexOf('{');
  if (firstBrace === -1) return null;
  let depth = 0;
  for (let i = firstBrace; i < prompt.length; i++) {
    const char = prompt[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return prompt.slice(firstBrace, i + 1);
      }
    }
  }
  return null;
}
