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
import { type GenerateContentStreamResult, GoogleGenerativeAI } from '@google/generative-ai';

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

export interface CallReturn<T> {
  data: AsyncIterable<T>;
  usage: Promise<LLMUsage>;
}

export interface CompleteResult {
  text: string;
  usage: LLMUsage;
}

// -----------------------------
// Public API
// -----------------------------

/**
 * Performs a plain-text completion using the LLM.
 *
 * @param prompt - The full text prompt for the LLM.
 * @param opts - Configuration options for the completion.
 * @returns A promise resolving to a CompleteResult (text and usage).
 */
export async function complete(prompt: string, opts: LLMOptions = {}): Promise<CompleteResult> {
  const { data, usage } = await callLLM({
    prompt,
    responseAs: 'text',
    model: opts.model ?? config.model,
    temperature: opts.temperature ?? config.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    timeoutMs: opts.timeoutMs ?? config.timeoutMs,
    signal: opts.signal,
  });

  let text = '';
  for await (const chunk of data) {
    text += chunk;
  }

  return { text, usage: await usage };
}

/**
 * Performs a JSON-structured completion using the LLM.
 *
 * @param prompt - The full text prompt for the LLM.
 * @param opts - Configuration options for the completion.
 * @returns A promise resolving to a CallReturn (stream and usage).
 */
export async function json(prompt: string, opts: LLMOptions = {}): Promise<CallReturn<string>> {
  return callLLM({
    prompt,
    responseAs: 'json',
    model: opts.model ?? config.model,
    temperature: opts.temperature ?? config.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    timeoutMs: opts.timeoutMs ?? config.timeoutMs,
    signal: opts.signal,
  });
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

const LOG_DIR = path.join(__dirname, '..', 'log');
const LOG_FILE = path.join(LOG_DIR, 'prompts.log');
const RESPONSE_DIR = path.join(__dirname, '..', '..', 'resource', 'LLM_response');

/**
 * Calls the appropriate LLM implementation (real or mock) based on configuration.
 *
 * @param args - Arguments for the LLM call.
 * @returns A promise resolving to a CallReturn with streaming data and usage.
 */
async function callLLM(args: CallArgs): Promise<CallReturn<string>> {
  await logPromptIfDebug(args);

  if (config.useMockLLM) {
    return callMockLLM(args);
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
    console.log(`LLM model is ${args.model}`);
    const model = genAI.getGenerativeModel({
      model: args.model,
      generationConfig: {
        maxOutputTokens: args.maxOutputTokens,
        temperature: args.temperature,
        responseMimeType: args.responseAs === 'json' ? 'application/json' : 'text/plain',
      },
    });

    const result: GenerateContentStreamResult = await model.generateContentStream(args.prompt);

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

      if (config.debugMode) {
        const u = await usagePromise;
        console.log(
          JSON.stringify({
            level: 'info',
            scope: 'llm-service',
            message: 'LLM response received',
            model: args.model,
            responseAs: args.responseAs,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            timestamp: new Date().toISOString(),
          }),
        );
      }
      void persistLLMResponse(args, fullText);
    })();

    return { data: dataStream, usage: usagePromise };
  } catch (error: unknown) {
    throw normalizeError(error);
  }
}

/**
 * Logs the LLM prompt to the filesystem if debug mode is enabled.
 *
 * @param args - Arguments for the LLM call.
 */
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

/**
 * Simulates an LLM call for testing or development.
 *
 * @param args - Arguments for the LLM call.
 * @returns A promise resolving to a CallReturn with mock data.
 */
async function callMockLLM(args: CallArgs): Promise<CallReturn<string>> {
  if (args.signal?.aborted) {
    throw new Error('Mock LLM call aborted');
  }

  const usage: LLMUsage = {
    modelId: `mock:${args.model}`,
    inputTokens: 0,
    outputTokens: 0,
  };

  let text: string;
  if (args.responseAs === 'text') {
    text = `[mock:${args.model}] ${truncate(args.prompt.replace(/\s+/g, ' ').trim(), 200)}`;
  } else {
    const json = extractJsonFromPrompt(args.prompt) ?? {
      mock: true,
      model: args.model,
      prompt_preview: truncate(args.prompt, 200),
    };
    text = JSON.stringify(json, null, 2);
  }

  const data = (async function* () {
    yield text;
  })();

  return { data, usage: Promise.resolve(usage) };
}

/**
 * Persists the LLM response to a JSON file in the resource directory for debugging and auditing.
 *
 * @param args - The original call arguments.
 * @param text - The raw text response from the LLM.
 */
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

/**
 * Extracts a JSON object from a text string, handling potential markdown code fences.
 *
 * @param text - The raw text containing JSON.
 * @returns The parsed JSON object or an empty object if parsing fails.
 */
export function extractJsonFromText(text: string): unknown {
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

/**
 * Removes markdown code fences from a string.
 *
 * @param s - The string to unwrap.
 * @returns The unwrapped content or null if no fence is found.
 */
function unwrapCodeFence(s: string): string | null {
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
function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error('Unknown LLM client error');
}

/**
 * Truncates a string to a maximum length, adding an ellipsis if necessary.
 *
 * @param text - The string to truncate.
 * @param maxLen - The maximum allowed length.
 * @returns The truncated string.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

/**
 * Attempts to extract JSON from a prompt string, used for mock LLM simulations.
 *
 * @param prompt - The prompt containing a potential JSON block.
 * @returns The parsed JSON or null.
 */
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

/**
 * Finds the first balanced curly-brace block in a string.
 *
 * @param prompt - The string to search.
 * @returns The first JSON-like block or null.
 */
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
