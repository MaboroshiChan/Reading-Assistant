import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AnalyzeQuizData,
  QuizQuestion,
  RequestEnvelopeQuiz,
  ResponseEnvelopeQuiz,
} from '../../packages/contracts/src';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { createLLMClient, extractJsonFromText, type CallReturn } from '../services/llmService';
import { resolvePromptPath } from '../src/utils/prompt-path';
import { buildStableCacheKey, withBufferedStream } from './shared';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'quiz';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = 'quiz.v1.0';
const PROMPT_PATH = resolvePromptPath('quiz.txt');

/**
 * Builds a cache key for quiz generation requests.
 */
const buildCacheKey = (req: RequestEnvelopeQuiz): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.model,
  });
};

let cachedQuizSystemPrompt: string | null = null;

/**
 * Loads the quiz generation prompt from the filesystem, with caching.
 */
const loadQuizSystemPrompt = async (): Promise<string> => {
  if (cachedQuizSystemPrompt) return cachedQuizSystemPrompt;
  cachedQuizSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
  return cachedQuizSystemPrompt;
};

/**
 * Builds the full LLM prompt for quiz generation.
 */
const buildUserPrompt = (req: RequestEnvelopeQuiz): string => {
  const sections: string[] = [
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
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Casts unknown to string or undefined.
 */
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * Casts unknown to a finite number or undefined.
 */
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Coerces the raw LLM JSON response into a typed QuizQuestion array.
 */
const coerceQuizResponse = (value: unknown): QuizQuestion[] => {
  if (!isRecord(value) || !Array.isArray(value.questions)) return [];
  
  return value.questions.map((q: unknown) => {
    if (!isRecord(q)) return null;
    
    // Validate options
    const options = Array.isArray(q.options) 
        ? q.options.map(asString).filter((s): s is string => typeof s === 'string')
        : [];
        
    if (options.length !== 4) return null; // We need exactly 4 options

    // Validate correct answer index
    const correctAnswerIndex = asNumber(q.correctAnswerIndex);
    if (correctAnswerIndex === undefined || correctAnswerIndex < 0 || correctAnswerIndex > 3) return null;

    const id = asString(q.id) ?? `q_${Math.random().toString(36).substring(2, 9)}`;
    const question = asString(q.question);
    const explanation = asString(q.explanation);
    let skill = asString(q.skill) as 'Facts' | 'Inference' | 'Tone' | 'Argument' | undefined;
    
    // Default fallback if skill is missing or invalid
    if (skill !== 'Facts' && skill !== 'Inference' && skill !== 'Tone' && skill !== 'Argument') {
      skill = 'Facts';
    }

    if (!question || !explanation) return null;

    return {
      id,
      type: 'multiple_choice' as const,
      question,
      options,
      correctAnswerIndex,
      explanation,
      skill,
    };
  }).filter((q): q is QuizQuestion => q !== null);
};


/**
 * Orchestrates quiz data collection from LLM.
 */
const buildQuizData = async (
  req: RequestEnvelopeQuiz,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('quiz', 'building LLM prompt', {
    requestId: req.request_id,
    promptVersion: PROMPT_VERSION,
  });
  const [systemPrompt, userPrompt] = await Promise.all([
    loadQuizSystemPrompt(),
    Promise.resolve(buildUserPrompt(req)),
  ]);
  const llmClient = createLLMClient({ systemPrompt });
  handlerLog('quiz', 'LLM prompt prepared', {
    requestId: req.request_id,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
  });

  return llmClient.json(userPrompt, { signal });
};

/**
 * The main handler for quiz generation requests.
 */
export const handleQuiz = async (
  req: RequestEnvelopeQuiz,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('quiz', 'request received', {
    requestId: req.request_id,
    promptVersion: PROMPT_VERSION,
  });
  
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeQuiz>(cacheKey);
  
  if (cached) {
    handlerLog('quiz', 'cache hit', {
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
  const { data: stream, usage: usagePromise } = await buildQuizData(req, signal);

  const tappedStream = withBufferedStream(stream, async ({ text, completed }) => {
    if (!completed) return;

    try {
      const usage = await usagePromise;
      const object = extractJsonFromText(text);
      const questions = coerceQuizResponse(object);
      const data: AnalyzeQuizData = { questions };

      const response: ResponseEnvelopeQuiz = {
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
      cache.set(cacheKey, response, config.cacheTtlMs);
    } catch (error) {
      console.warn('[quiz] failed to cache response', error);
    }
  });

  return { data: tappedStream, usage: usagePromise };
};
