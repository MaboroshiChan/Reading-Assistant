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
import { GoogleGenerativeAI } from '@google/generative-ai';

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

const LOG_DIR = path.join(__dirname, '..', 'log');
const LOG_FILE = path.join(LOG_DIR, 'prompts.log');
const RESPONSE_DIR = path.join(__dirname, '..', '..', 'resource', 'LLM_response');

async function callLLM<T extends string | unknown>(args: CallArgs): Promise<CallReturn<T>> {
  await logPromptIfDebug(args);

  if (config.useMockLLM) {
    return callMockLLM<T>(args);
  }

  // Note: The Google Generative AI Node SDK does not currently expose a simple AbortSignal hook
  // for generateContent in the same way fetch does, but we can respect the timeout for the wrapper.
  // For this implementation, we rely on the promise race or just standard await.

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY environment variable');
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: args.model,
      generationConfig: {
        maxOutputTokens: args.maxOutputTokens,
        temperature: args.temperature,
        responseMimeType: args.responseAs === 'json' ? 'application/json' : 'text/plain',
      },
    });
    // TODO: We need to change it to streaming mode
    const result = await model.generateContent(args.prompt);
    const response = await result.response;
    const text = response.text();

    if (config.debugMode) {
      console.log(
        JSON.stringify({
          level: 'info',
          scope: 'llm-service',
          message: 'LLM response received',
          model: args.model,
          responseAs: args.responseAs,
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    void persistLLMResponse(args, text);

    const usage: LLMUsage = {
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
      modelId: args.model,
    };

    if (args.responseAs === 'text') {
      return { data: text as T, usage };
    }

    // responseAs === 'json'
    const obj = extractJsonFromText(text);
    return { data: obj as T, usage };
  } catch (error: unknown) {
    throw normalizeError(error);
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

async function persistLLMResponse(args: CallArgs, text: string): Promise<void> {
  try {
    await fs.mkdir(RESPONSE_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    const safeStamp = timestamp.replace(/[:.]/g, '-');
    const parsed = (() => {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    const record = {
      timestamp,
      model: args.model,
      responseAs: args.responseAs,
      text: text || null,
      parsed: parsed ?? undefined,
      prompt: config.debugMode ? args.prompt : undefined,
    };
    const filePath = path.join(RESPONSE_DIR, `${safeStamp}_${args.model}.json`);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
  } catch (error) {
    console.warn('[llm-response] failed to persist response', error);
  }
}

// Extract JSON value (object) from text output
function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Some models may wrap JSON in markdown fences
    const unwrapped = unwrapCodeFence(trimmed);
    if (!unwrapped) return {};
    try { return JSON.parse(unwrapped) as unknown; } catch { return {}; }
  }
}

function unwrapCodeFence(s: string): string | null {
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/;
  const m = s.match(fence);
  return m ? m[1] : null;
}

function normalizeError(error: unknown): Error {
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
