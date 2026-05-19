import fs from 'node:fs/promises';
import type {
  AnalyzeChapterKeywordsData,
  ChunkKeySentence,
  RequestEnvelopeChapterKeywords,
  ResponseEnvelopeChapterKeywords,
  SentenceRef,
} from '../../packages/contracts/src';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { createLLMClient, extractJsonFromText, type CallReturn } from '../services/llmService';
import { buildChunkPrefixCache } from '../src/utils/chapter-prefix-cache';
import { resolvePromptPath } from '../src/utils/prompt-path';
import { buildStableCacheKey, withBufferedStream } from './shared';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'chapter-keywords';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = 'chapter_keywords.v1';
const PROMPT_PATH = resolvePromptPath('chapter_keywords.txt');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const refKey = (ref: SentenceRef): string =>
  [
    ref.page_index,
    ref.paragraph_index,
    ref.paragraph_id,
    ref.sentence_id,
  ].join(':');

const readSentenceRef = (value: unknown): SentenceRef | undefined => {
  if (!isRecord(value)) return undefined;
  const {
    page_index: pageIndex,
    paragraph_index: paragraphIndex,
    paragraph_id: paragraphId,
    sentence_id: sentenceId,
  } = value;
  if (
    !isNumber(pageIndex) ||
    !isNumber(paragraphIndex) ||
    !isNumber(paragraphId) ||
    !isNumber(sentenceId)
  ) {
    return undefined;
  }
  return {
    page_index: pageIndex,
    paragraph_index: paragraphIndex,
    paragraph_id: paragraphId,
    sentence_id: sentenceId,
  };
};

const clamp01 = (value: unknown): number => {
  if (!isNumber(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const sanitizeChapterKeywords = (
  raw: unknown,
  req: RequestEnvelopeChapterKeywords,
): AnalyzeChapterKeywordsData => {
  const sourceByRef = new Map(
    req.payload.sentences.map((sentence) => [refKey(sentence.ref), sentence]),
  );
  const record = isRecord(raw) ? raw : {};
  const rawKeySentences = Array.isArray(record.key_sentences) ? record.key_sentences : [];
  const seen = new Set<string>();
  const keySentences: ChunkKeySentence[] = [];

  for (const item of rawKeySentences) {
    if (!isRecord(item)) continue;
    const sentenceRef = readSentenceRef(item.sentence_ref);
    if (!sentenceRef) continue;

    const key = refKey(sentenceRef);
    if (seen.has(key)) continue;

    const source = sourceByRef.get(key);
    if (!source || item.sentence_text !== source.text) continue;

    seen.add(key);
    keySentences.push({
      sentence_ref: source.ref,
      sentence_text: source.text,
      importance: clamp01(item.importance),
      reason: typeof item.reason === 'string' ? item.reason : '',
    });
  }

  return {
    key_sentences: keySentences,
    sentence_keywords: [],
  };
};

const buildCacheKey = (req: RequestEnvelopeChapterKeywords): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.model,
  });
};

let cachedSystemPrompt: string | null = null;

const loadSystemPrompt = async (): Promise<string> => {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
  return cachedSystemPrompt;
};

const buildUserPrompt = (req: RequestEnvelopeChapterKeywords): string => {
  const promptPayload = {
    doc_id: req.payload.doc_id,
    chapter_id: req.payload.chapter_id,
    chapter_index: req.payload.chapter_index,
    chunk_id: req.payload.chunk_id,
    chunk_index: req.payload.chunk_index,
    total_chunks: req.payload.total_chunks,
    sentences: req.payload.sentences,
  };
  const sections = [
    `Document ID: ${req.payload.doc_id}`,
    `Chapter ID: ${req.payload.chapter_id}`,
    `Chapter Index: ${req.payload.chapter_index}`,
    `Chunk ID: ${req.payload.chunk_id}`,
    `Chunk Index: ${req.payload.chunk_index}`,
    `Total Chunks: ${req.payload.total_chunks}`,
    `Prompt Version: ${PROMPT_VERSION}`,
    '',
    'Sentence payload JSON:',
    '```json',
    JSON.stringify(promptPayload, null, 2),
    '```',
    '',
    'Respond with JSON only. Do not wrap the JSON in markdown fences.',
  ];

  return sections.join('\n');
};

const buildChapterKeywordsData = async (
  req: RequestEnvelopeChapterKeywords,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('chapter_keywords', 'building LLM prompt', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
  });

  const [systemPrompt, userPrompt] = await Promise.all([
    loadSystemPrompt(),
    Promise.resolve(buildUserPrompt(req)),
  ]);
  const llmClient = createLLMClient({
    systemPrompt,
    prefixCache: buildChunkPrefixCache({
      task: 'chapter_keywords',
      version: PROMPT_VERSION,
      docId: req.payload.doc_id,
      chapterId: req.payload.chapter_id,
      chunkId: req.payload.chunk_id,
      chunkText: req.payload.chunk_text,
      contentHash: req.context?.doc.content_hash,
    }),
  });

  handlerLog('chapter_keywords', 'LLM prompt prepared', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
  });

  return llmClient.json(userPrompt, { signal });
};

export const handleChapterKeywords = async (
  req: RequestEnvelopeChapterKeywords,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('chapter_keywords', 'request received', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
  });

  const cacheKey = buildCacheKey(req);
  const allowCache = req.cache_hint !== 'bypass';
  const cached = allowCache ? cache.get<ResponseEnvelopeChapterKeywords>(cacheKey) : undefined;
  if (cached) {
    handlerLog('chapter_keywords', 'cache hit', {
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
  const { data: stream, usage: usagePromise } = await buildChapterKeywordsData(req, signal);

  const sanitizedStream = (async function* () {
    try {
      let text = '';
      for await (const chunk of withBufferedStream(stream, async () => undefined)) {
        text += chunk;
      }

      const usage = await usagePromise;
      const raw = extractJsonFromText(text);
      const data = sanitizeChapterKeywords(raw, req);
      const latencyMs = Date.now() - started;
      const response: ResponseEnvelopeChapterKeywords = {
        request_id: req.request_id,
        status: 'ok',
        served_from: 'fresh',
        data,
        usage: {
          latency_ms: latencyMs,
          model_id: usage?.modelId,
          tokens_in: usage?.inputTokens,
          tokens_out: usage?.outputTokens,
        },
      };
      if (allowCache) {
        cache.set(cacheKey, response, config.cacheTtlMs);
      }

      handlerLog('chapter_keywords', 'request completed', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
        latencyMs,
        keySentenceCount: data.key_sentences.length,
      });

      yield JSON.stringify(data);
    } catch (error) {
      handlerLog('chapter_keywords', 'request failed', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  })();

  return { data: sanitizedStream, usage: usagePromise };
};
