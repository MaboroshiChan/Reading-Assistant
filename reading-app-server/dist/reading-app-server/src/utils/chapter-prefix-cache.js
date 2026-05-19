"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChunkPrefixCache = exports.buildSharedChapterPrefixCache = exports.buildSharedChapterPrefix = exports.buildSharedChapterPrefixCacheKey = exports.SHARED_CHAPTER_PREFIX_VERSION = void 0;
exports.SHARED_CHAPTER_PREFIX_VERSION = 'chapter_context.v1';
const clean = (value) => value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
const buildSharedChapterPrefixCacheKey = (input) => [
    exports.SHARED_CHAPTER_PREFIX_VERSION,
    input.bookId,
    input.chapterId,
    input.chapterContentHash,
].join(':');
exports.buildSharedChapterPrefixCacheKey = buildSharedChapterPrefixCacheKey;
const buildSharedChapterPrefix = (input) => {
    const stableBookMetadata = {
        bookId: input.bookId,
        title: input.bookMetadata?.title,
        author: input.bookMetadata?.author,
        language: input.bookMetadata?.language,
    };
    return [
        `Shared Prefix Version: ${exports.SHARED_CHAPTER_PREFIX_VERSION}`,
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
    ].filter((line) => line !== undefined).join('\n');
};
exports.buildSharedChapterPrefix = buildSharedChapterPrefix;
const buildSharedChapterPrefixCache = (input) => ({
    cacheKey: (0, exports.buildSharedChapterPrefixCacheKey)(input),
    displayName: [
        'chapter',
        clean(input.bookId) || 'book',
        clean(input.chapterId) || 'chapter',
    ].join('-').slice(0, 128),
    prefix: (0, exports.buildSharedChapterPrefix)(input),
    systemPromptMode: 'request',
});
exports.buildSharedChapterPrefixCache = buildSharedChapterPrefixCache;
const buildChunkPrefixCache = (input) => ({
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
    ].filter((line) => line !== undefined).join('\n'),
    systemPromptMode: 'request',
});
exports.buildChunkPrefixCache = buildChunkPrefixCache;
//# sourceMappingURL=chapter-prefix-cache.js.map