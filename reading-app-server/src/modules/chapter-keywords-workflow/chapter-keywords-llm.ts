import fs from 'node:fs/promises';
import type {
  AnalyzeChapterKeywordsData,
  ChunkKeySentence,
  RequestEnvelopeChapterKeywords,
  ResponseEnvelopeChapterKeywords,
  SentenceRef,
} from '../../../../packages/contracts/src';
import { createLLMClient, extractJsonFromText, type CallReturn } from '../../../services/llmService';
import { config } from '../../config/runtime-config';
import { buildChunkPrefixCache } from '../../utils/chapter-prefix-cache';
import { resolvePromptPath } from '../../utils/prompt-path';

const PROMPT_VERSION = 'chapter_keywords.v1';
const PROMPT_PATH = resolvePromptPath('chapter_keywords.txt');

export interface ChapterKeywordSentenceInput {
  ref: SentenceRef;
  text: string;
}

export interface ChapterKeywordsLLMInput {
  docId: string;
  chapterId: string;
  chapterIndex: number;
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkText: string;
  sentences: ChapterKeywordSentenceInput[];
  contentHash?: string;
}

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

const paragraphKey = (ref: SentenceRef): string =>
  [
    ref.page_index,
    ref.paragraph_index,
    ref.paragraph_id,
  ].join(':');

const compareSentenceRefs = (left: SentenceRef, right: SentenceRef): number => {
  if (left.page_index !== right.page_index) {
    return left.page_index - right.page_index;
  }
  if (left.paragraph_index !== right.paragraph_index) {
    return left.paragraph_index - right.paragraph_index;
  }
  if (left.paragraph_id !== right.paragraph_id) {
    return left.paragraph_id - right.paragraph_id;
  }
  return left.sentence_id - right.sentence_id;
};

const readSentenceRef = (value: unknown): SentenceRef | undefined => {
  if (!isRecord(value)) return undefined;
  const {
    page_index: pageIndex,
    paragraph_index: paragraphIndex,
    paragraph_id: paragraphId,
    sentence_id: sentenceId,
  } = value;
  if (
    !isNumber(pageIndex)
    || !isNumber(paragraphIndex)
    || !isNumber(paragraphId)
    || !isNumber(sentenceId)
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

let cachedSystemPrompt: string | null = null;

const loadSystemPrompt = async (): Promise<string> => {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
  return cachedSystemPrompt;
};

export const sanitizeChapterKeywords = (
  raw: unknown,
  sourceSentences: ChapterKeywordSentenceInput[],
): AnalyzeChapterKeywordsData => {
  const sourceByRef = new Map(
    sourceSentences.map((sentence) => [refKey(sentence.ref), sentence]),
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

  const bestByParagraph = new Map<string, ChunkKeySentence>();
  for (const item of keySentences) {
    const key = paragraphKey(item.sentence_ref);
    const existing = bestByParagraph.get(key);
    if (
      !existing
      || item.importance > existing.importance
      || (
        item.importance === existing.importance
        && compareSentenceRefs(item.sentence_ref, existing.sentence_ref) < 0
      )
    ) {
      bestByParagraph.set(key, item);
    }
  }

  return {
    key_sentences: Array.from(bestByParagraph.values()).sort((left, right) =>
      compareSentenceRefs(left.sentence_ref, right.sentence_ref)),
    sentence_keywords: [],
  };
};

export const buildChapterKeywordsPrompt = (input: ChapterKeywordsLLMInput): string => {
  const promptPayload = {
    doc_id: input.docId,
    chapter_id: input.chapterId,
    chapter_index: input.chapterIndex,
    chunk_id: input.chunkId,
    chunk_index: input.chunkIndex,
    total_chunks: input.totalChunks,
    sentences: input.sentences,
  };

  return [
    `Document ID: ${input.docId}`,
    `Chapter ID: ${input.chapterId}`,
    `Chapter Index: ${input.chapterIndex}`,
    `Chunk ID: ${input.chunkId}`,
    `Chunk Index: ${input.chunkIndex}`,
    `Total Chunks: ${input.totalChunks}`,
    `Prompt Version: ${PROMPT_VERSION}`,
    '',
    'Sentence payload JSON:',
    '```json',
    JSON.stringify(promptPayload, null, 2),
    '```',
    '',
    'Respond with JSON only. Do not wrap the JSON in markdown fences.',
  ].join('\n');
};

export const buildChapterKeywordsCall = async (
  input: ChapterKeywordsLLMInput,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  const [systemPrompt, userPrompt] = await Promise.all([
    loadSystemPrompt(),
    Promise.resolve(buildChapterKeywordsPrompt(input)),
  ]);
  const llmClient = createLLMClient({
    systemPrompt,
    model: config.chapterKeywordsWorkflowModel,
    prefixCache: buildChunkPrefixCache({
      task: 'chapter_keywords',
      version: PROMPT_VERSION,
      docId: input.docId,
      chapterId: input.chapterId,
      chunkId: input.chunkId,
      chunkText: input.chunkText,
      contentHash: input.contentHash,
    }),
    logContext: {
      workflowKind: 'chapter_keywords',
      docId: input.docId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      chunkId: input.chunkId,
      chunkIndex: input.chunkIndex,
      totalChunks: input.totalChunks,
    },
  });

  return llmClient.json(userPrompt, { signal });
};

export const analyzeChapterKeywordsChunk = async (
  input: ChapterKeywordsLLMInput,
  signal?: AbortSignal,
): Promise<AnalyzeChapterKeywordsData> => {
  const { data } = await buildChapterKeywordsCall(input, signal);
  let text = '';
  for await (const chunk of data) {
    text += chunk;
  }
  return sanitizeChapterKeywords(extractJsonFromText(text), input.sentences);
};

export const toLLMInputFromEnvelope = (
  req: RequestEnvelopeChapterKeywords,
): ChapterKeywordsLLMInput => ({
  docId: req.payload.doc_id,
  chapterId: req.payload.chapter_id,
  chapterIndex: req.payload.chapter_index,
  chunkId: req.payload.chunk_id,
  chunkIndex: req.payload.chunk_index,
  totalChunks: req.payload.total_chunks,
  chunkText: req.payload.chunk_text,
  sentences: req.payload.sentences,
  contentHash: req.context?.doc.content_hash,
});

export const toCachedResponseText = (
  cached: ResponseEnvelopeChapterKeywords,
): string => JSON.stringify({ ...cached, served_from: 'cache' });

export { PROMPT_VERSION as CHAPTER_KEYWORDS_PROMPT_VERSION };
