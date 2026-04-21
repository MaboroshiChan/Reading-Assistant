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
import { json as llmJson, extractJsonFromText, type CallReturn } from '../services/llmService';
import { buildStableCacheKey } from './shared';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'quiz';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = 'quiz.v1.0';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'quiz.txt');

/**
 * Builds a cache key for quiz generation requests.
 */
const buildCacheKey = (req: RequestEnvelopeQuiz): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.useMockLLM ? `mock:${config.model}` : config.model,
  });
};

let cachedQuizPrompt: string | null = null;

/**
 * Loads the quiz generation prompt from the filesystem, with caching.
 */
const loadQuizPrompt = async (): Promise<string> => {
  if (cachedQuizPrompt) return cachedQuizPrompt;
  cachedQuizPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedQuizPrompt;
};

/**
 * Builds the full LLM prompt for quiz generation.
 */
const buildPrompt = async (req: RequestEnvelopeQuiz): Promise<string> => {
  const basePrompt = (await loadQuizPrompt()).trim();
  const sections: string[] = [
    basePrompt,
    '',
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
): Promise<CallReturn<string>> => {
  if (config.useMockLLM) {
    handlerLog('quiz', 'building mock payload', {
      requestId: req.request_id,
      mock: true,
    });
    const mockData: AnalyzeQuizData = {
        questions: [
            {
                id: "mock_q1",
                type: "multiple_choice",
                question: "What is the main topic of this mock article?",
                options: ["Mock A", "Mock B", "Mock C", "Mock D"],
                correctAnswerIndex: 0,
                explanation: "This is a mock answer for testing.",
                skill: "Facts"
            }
        ]
    };
    const text = JSON.stringify(mockData);
    const stream = (async function* () {
      yield text;
    })();
    return {
      data: stream,
      usage: Promise.resolve({
        modelId: `mock:${config.model}`,
        inputTokens: 0,
        outputTokens: 0,
      }),
    };
  }

  handlerLog('quiz', 'building LLM prompt', {
    requestId: req.request_id,
    promptVersion: PROMPT_VERSION,
  });
  
  const prompt = await buildPrompt(req);
  
  handlerLog('quiz', 'LLM prompt prepared', {
    requestId: req.request_id,
    promptLength: prompt.length,
    mock: false,
  });
  
  return llmJson(prompt);
};

/**
 * The main handler for quiz generation requests.
 */
export const handleQuiz = async (
  req: RequestEnvelopeQuiz,
): Promise<CallReturn<string>> => {
  handlerLog('quiz', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
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
      let data: AnalyzeQuizData;
      
      if (config.useMockLLM) {
        data = JSON.parse(text) as AnalyzeQuizData;
      } else {
        const object = extractJsonFromText(text);
        const questions = coerceQuizResponse(object);
        data = { questions };
      }

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
  })();

  return { data: tappedStream, usage: usagePromise };
};
