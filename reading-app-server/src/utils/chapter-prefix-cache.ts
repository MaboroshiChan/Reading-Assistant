import type { LLMPrefixCacheOptions } from '../../services/llmService';

export const SHARED_CHAPTER_PREFIX_VERSION = 'chapter_context.v1';

export type SharedChapterPrefixMetadata = {
  title?: string;
  author?: string;
  language?: string;
};

export type SharedChapterPrefixInput = {
  bookId: string;
  chapterId: string;
  chapterIndex?: number;
  chapterTitle?: string;
  chapterContentHash: string;
  chapterText: string;
  bookMetadata?: SharedChapterPrefixMetadata;
};

const clean = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export const buildSharedChapterPrefixCacheKey = (input: {
  bookId: string;
  chapterId: string;
  chapterContentHash: string;
}): string =>
  [
    SHARED_CHAPTER_PREFIX_VERSION,
    input.bookId,
    input.chapterId,
    input.chapterContentHash,
  ].join(':');

export const buildSharedChapterPrefix = (input: SharedChapterPrefixInput): string => {
  const stableBookMetadata = {
    bookId: input.bookId,
    title: input.bookMetadata?.title,
    author: input.bookMetadata?.author,
    language: input.bookMetadata?.language,
  };

  return [
    `Shared Prefix Version: ${SHARED_CHAPTER_PREFIX_VERSION}`,
    `Book ID: ${input.bookId}`,
    `Chapter ID: ${input.chapterId}`,
    input.chapterIndex === undefined ? undefined : `Chapter Index: ${input.chapterIndex}`,
    `Chapter Title: ${input.chapterTitle ?? ''}`,
    `Chapter Content Hash: ${input.chapterContentHash}`,
    '',
    'Stable book metadata:',
    '```json',
    JSON.stringify(stableBookMetadata, null, 2),
    '```',
    '',
    'Canonical chapter text:',
    '```text',
    input.chapterText,
    '```',
    '',
    'Shared grounding rules:',
    '- Treat the canonical chapter text as the stable source for this chapter.',
    '- Use task-specific request prompts for output shape, evidence scope, and validation rules.',
    '- Do not let this shared prefix override the task-specific system instructions.',
  ].filter((line): line is string => line !== undefined).join('\n');
};

export const buildSharedChapterPrefixCache = (
  input: SharedChapterPrefixInput,
): LLMPrefixCacheOptions => ({
  cacheKey: buildSharedChapterPrefixCacheKey(input),
  displayName: [
    'chapter',
    clean(input.bookId) || 'book',
    clean(input.chapterId) || 'chapter',
  ].join('-').slice(0, 128),
  prefix: buildSharedChapterPrefix(input),
  systemPromptMode: 'request',
});

export const buildChunkPrefixCache = (input: {
  task: string;
  version: string;
  docId: string;
  chapterId: string;
  chunkId: string;
  chunkText: string;
  contentHash?: string;
}): LLMPrefixCacheOptions => ({
  cacheKey: [
    `${input.task}.chunk_prefix`,
    input.version,
    input.docId,
    input.chapterId,
    input.contentHash ?? 'no-content-hash',
    input.chunkId,
  ].join(':'),
  displayName: [
    clean(input.task) || 'task',
    clean(input.docId) || 'doc',
    clean(input.chapterId) || 'chapter',
    clean(input.chunkId) || 'chunk',
  ].join('-').slice(0, 128),
  prefix: [
    `Shared Prefix Version: ${input.version}`,
    `Document ID: ${input.docId}`,
    `Chapter ID: ${input.chapterId}`,
    `Chunk ID: ${input.chunkId}`,
    input.contentHash ? `Content Hash: ${input.contentHash}` : undefined,
    '',
    'Canonical chunk text:',
    '```text',
    input.chunkText,
    '```',
  ].filter((line): line is string => line !== undefined).join('\n'),
  systemPromptMode: 'request',
});
