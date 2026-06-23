"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterKeywordsWorkflowService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const book_ingestion_repository_1 = require("../book-ingestion/book-ingestion.repository");
const workflow_queue_service_1 = require("../workflow-queue/workflow-queue.service");
const workflow_logger_1 = require("../workflow.logger");
const chapter_keywords_llm_1 = require("./chapter-keywords-llm");
const chapter_keywords_workflow_repository_1 = require("./chapter-keywords-workflow.repository");
const WORKFLOW_VERSION = 'v1';
const TARGET_CHUNK_CHARACTERS = 2400;
const MAX_PARAGRAPHS_PER_CHUNK = 6;
const OVERLAP_PARAGRAPHS = 1;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asBoolean = (value) => typeof value === 'boolean' ? value : undefined;
const refKey = (ref) => `${ref.page_index}:${ref.paragraph_index}:${ref.paragraph_id}:${ref.sentence_id}`;
const paragraphKey = (ref) => `${ref.page_index}:${ref.paragraph_index}:${ref.paragraph_id}`;
const compareSentenceRefs = (left, right) => {
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
const stableParagraphId = (raw, paragraphIndex) => {
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && String(numeric) === raw.trim()) {
        return numeric;
    }
    const hash = (0, node_crypto_1.createHash)('sha256').update(raw).digest('hex').slice(0, 8);
    const bounded = Number.parseInt(hash, 16) % 1_000_000;
    return bounded === 0 ? paragraphIndex + 1 : bounded;
};
const splitSentences = (text) => {
    const matches = text.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g);
    const sentences = (matches ?? [text])
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    return sentences.length ? sentences : [text.trim()].filter(Boolean);
};
const sortParagraphEntries = (pageParagraphs) => Object.entries(pageParagraphs)
    .sort(([left], [right]) => {
    const leftNum = Number(left);
    const rightNum = Number(right);
    const leftNumeric = Number.isInteger(leftNum) && String(leftNum) === left.trim();
    const rightNumeric = Number.isInteger(rightNum) && String(rightNum) === right.trim();
    if (leftNumeric && rightNumeric)
        return leftNum - rightNum;
    if (leftNumeric)
        return -1;
    if (rightNumeric)
        return 1;
    return left.localeCompare(right);
})
    .map(([key, value]) => ({ key, value }));
let ChapterKeywordsWorkflowService = class ChapterKeywordsWorkflowService {
    bookIngestionRepository;
    chapterKeywordsWorkflowRepository;
    workflowQueueService;
    constructor(bookIngestionRepository, chapterKeywordsWorkflowRepository, workflowQueueService) {
        this.bookIngestionRepository = bookIngestionRepository;
        this.chapterKeywordsWorkflowRepository = chapterKeywordsWorkflowRepository;
        this.workflowQueueService = workflowQueueService;
    }
    onApplicationBootstrap() {
        for (const run of this.chapterKeywordsWorkflowRepository.listRecoverableRuns()) {
            (0, workflow_logger_1.workflowLog)('run.recovered', {
                workflowKind: run.kind,
                workflowRunId: run.id,
                bookId: run.bookId,
                chapterId: run.chapterId,
                chapterIndex: run.chapterIndex,
                workflowVersion: run.workflowVersion,
                status: run.status,
            });
            this.workflowQueueService.enqueue(() => this.executeRun(run.id));
        }
    }
    parseSubmitRequest(rawBody) {
        if (!rawBody || rawBody.trim() === '') {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'chapter_keywords',
                reason: 'empty_body',
            });
            throw new common_1.BadRequestException('Request body cannot be empty');
        }
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch (error) {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'chapter_keywords',
                reason: 'invalid_json',
                error: error instanceof Error ? error.message : String(error),
            });
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed)) {
            (0, workflow_logger_1.workflowLog)('request.parse_failed', {
                workflowKind: 'chapter_keywords',
                reason: 'non_object_body',
            });
            throw new common_1.BadRequestException('Request body must be a JSON object');
        }
        const request = {
            bookId: this.requireString(parsed.bookId, 'bookId'),
            chapterId: this.requireString(parsed.chapterId, 'chapterId'),
            chapterIndex: this.requireNonNegativeInteger(parsed.chapterIndex, 'chapterIndex'),
            workflowVersion: parsed.workflowVersion === undefined
                ? WORKFLOW_VERSION
                : this.requireString(parsed.workflowVersion, 'workflowVersion'),
            idempotencyKey: parsed.idempotencyKey === undefined
                ? undefined
                : this.requireString(parsed.idempotencyKey, 'idempotencyKey'),
            expectedSnapshotVersion: parsed.expectedSnapshotVersion === undefined
                ? undefined
                : this.requireNonNegativeInteger(parsed.expectedSnapshotVersion, 'expectedSnapshotVersion'),
            expectedChapterContentHash: parsed.expectedChapterContentHash === undefined
                ? undefined
                : this.requireString(parsed.expectedChapterContentHash, 'expectedChapterContentHash'),
            requestedByUserId: parsed.requestedByUserId === undefined
                ? undefined
                : this.requireString(parsed.requestedByUserId, 'requestedByUserId'),
        };
        (0, workflow_logger_1.workflowLog)('request.parsed', {
            workflowKind: 'chapter_keywords',
            bookId: request.bookId,
            chapterId: request.chapterId,
            chapterIndex: request.chapterIndex,
            workflowVersion: request.workflowVersion,
            hasIdempotencyKey: request.idempotencyKey !== undefined,
            expectedSnapshotVersion: request.expectedSnapshotVersion,
            expectedChapterContentHash: request.expectedChapterContentHash,
            requestedByUserId: request.requestedByUserId,
        });
        return request;
    }
    parseRestartRequest(rawBody) {
        if (!rawBody || rawBody.trim() === '') {
            return { mode: 'resume' };
        }
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch (error) {
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed)) {
            throw new common_1.BadRequestException('Request body must be a JSON object');
        }
        const mode = parsed.mode === undefined ? 'resume' : this.requireRestartMode(parsed.mode);
        return { mode };
    }
    submitChapterKeywordsWorkflow(request) {
        const book = this.bookIngestionRepository.getBook(request.bookId);
        const chapter = this.bookIngestionRepository.getChapter(request.bookId, request.chapterId);
        if (!book || !chapter) {
            throw new common_1.NotFoundException('Chapter not found in canonical ingestion state');
        }
        if (chapter.chapterIndex !== request.chapterIndex) {
            throw new common_1.ConflictException('chapterIndex does not match canonical chapter state');
        }
        if (request.expectedSnapshotVersion !== undefined
            && request.expectedSnapshotVersion !== book.snapshotVersion) {
            throw new common_1.ConflictException('expectedSnapshotVersion does not match canonical book state');
        }
        if (request.expectedChapterContentHash !== undefined
            && request.expectedChapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.ConflictException('expectedChapterContentHash does not match canonical chapter state');
        }
        if (chapter.chapterTextMaterialized.trim().length === 0) {
            throw new common_1.ConflictException('Canonical chapter text is empty; ingest pages before submitting chapter keywords workflow');
        }
        const input = {
            ...request,
            idempotencyKey: request.idempotencyKey ?? this.buildDefaultIdempotencyKey(request.bookId, request.chapterId, request.workflowVersion, chapter.chapterContentHash),
            expectedSnapshotVersion: request.expectedSnapshotVersion ?? book.snapshotVersion,
            expectedChapterContentHash: request.expectedChapterContentHash ?? chapter.chapterContentHash,
        };
        const { run, deduped } = this.chapterKeywordsWorkflowRepository.createOrReuseRun(input);
        if (!deduped) {
            this.workflowQueueService.enqueue(() => this.executeRun(run.id));
        }
        const canonicalRun = deduped
            ? this.chapterKeywordsWorkflowRepository.getRun(run.id) ?? run
            : run;
        (0, workflow_logger_1.workflowLog)('run.submitted', {
            workflowKind: canonicalRun.kind,
            workflowRunId: canonicalRun.id,
            bookId: canonicalRun.bookId,
            chapterId: canonicalRun.chapterId,
            chapterIndex: canonicalRun.chapterIndex,
            workflowVersion: canonicalRun.workflowVersion,
            deduped,
            status: canonicalRun.status,
        });
        return this.toSubmitResponse(canonicalRun, deduped);
    }
    getWorkflowStatus(workflowRunId) {
        const run = this.requireRun(workflowRunId);
        return this.toStatusResponse(run);
    }
    restartWorkflow(workflowRunId, request) {
        const run = this.requireRun(workflowRunId);
        const restartMode = request.mode ?? 'resume';
        if (run.status === 'queued' || run.status === 'running') {
            return {
                ...this.toStatusResponse(run),
                restartMode,
            };
        }
        if (run.status === 'completed') {
            throw new common_1.ConflictException('Chapter keywords workflow is already completed and cannot be restarted');
        }
        if (run.status === 'stale') {
            throw new common_1.ConflictException('Chapter keywords workflow is stale and cannot be restarted');
        }
        const book = this.bookIngestionRepository.getBook(run.bookId);
        const chapter = this.bookIngestionRepository.getChapter(run.bookId, run.chapterId);
        if (!book || !chapter) {
            throw new common_1.NotFoundException('Chapter not found in canonical ingestion state');
        }
        if (run.expectedSnapshotVersion !== undefined
            && run.expectedSnapshotVersion !== book.snapshotVersion) {
            throw new common_1.ConflictException('Canonical book snapshot changed; submit a new chapter keywords workflow');
        }
        if (run.expectedChapterContentHash !== undefined
            && run.expectedChapterContentHash !== chapter.chapterContentHash) {
            throw new common_1.ConflictException('Canonical chapter content changed; submit a new chapter keywords workflow');
        }
        const restarted = this.chapterKeywordsWorkflowRepository.restartFailedRun(workflowRunId, restartMode);
        if (!restarted) {
            throw new common_1.ConflictException('Chapter keywords workflow cannot be restarted from its current state');
        }
        this.workflowQueueService.enqueue(() => this.executeRun(restarted.id));
        return {
            ...this.toStatusResponse(restarted),
            restartMode,
        };
    }
    getWorkflowResult(workflowRunId) {
        const run = this.requireRun(workflowRunId);
        if (run.status !== 'completed'
            || !run.output
            || run.snapshotVersion === undefined
            || !run.chapterContentHash) {
            throw new common_1.ConflictException('Chapter keywords workflow result is not available yet');
        }
        return {
            workflowRunId: run.id,
            kind: run.kind,
            bookId: run.bookId,
            chapterId: run.chapterId,
            chapterIndex: run.chapterIndex,
            workflowVersion: run.workflowVersion,
            resultVersion: run.resultVersion,
            producer: run.producer,
            qualityTier: run.qualityTier,
            snapshotVersion: run.snapshotVersion,
            chapterContentHash: run.chapterContentHash,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            result: run.output,
        };
    }
    getLatestChapterKeywords(bookId, chapterId) {
        const result = this.chapterKeywordsWorkflowRepository.getLatestResult(bookId, chapterId);
        if (!result) {
            throw new common_1.NotFoundException('No completed chapter keywords workflow result found for chapter');
        }
        return this.toLatestResponse(result);
    }
    async executeRun(workflowRunId) {
        const runningRun = this.chapterKeywordsWorkflowRepository.markRunning(workflowRunId);
        if (!runningRun)
            return;
        const book = this.bookIngestionRepository.getBook(runningRun.bookId);
        const chapter = this.bookIngestionRepository.getChapter(runningRun.bookId, runningRun.chapterId);
        if (!book || !chapter) {
            this.chapterKeywordsWorkflowRepository.failRun(workflowRunId, 'CHAPTER_KEYWORDS_CHAPTER_NOT_FOUND', 'Canonical chapter state was not found during workflow execution.');
            return;
        }
        if (runningRun.expectedSnapshotVersion !== undefined
            && runningRun.expectedSnapshotVersion !== book.snapshotVersion) {
            this.chapterKeywordsWorkflowRepository.markStale(workflowRunId, 'CHAPTER_KEYWORDS_CANONICAL_BOOK_STALE', 'Canonical book snapshot changed before chapter keywords workflow execution completed.');
            return;
        }
        if (runningRun.expectedChapterContentHash !== undefined
            && runningRun.expectedChapterContentHash !== chapter.chapterContentHash) {
            this.chapterKeywordsWorkflowRepository.markStale(workflowRunId, 'CHAPTER_KEYWORDS_CANONICAL_CHAPTER_STALE', 'Canonical chapter content changed before chapter keywords workflow execution completed.');
            return;
        }
        if (chapter.chapterTextMaterialized.trim().length === 0) {
            this.chapterKeywordsWorkflowRepository.failRun(workflowRunId, 'CHAPTER_KEYWORDS_EMPTY_CHAPTER_TEXT', 'Canonical chapter text is empty; unable to generate chapter keywords.');
            return;
        }
        try {
            const chunks = this.planChunks(runningRun.bookId, runningRun.chapterId);
            if (!chunks.length) {
                this.chapterKeywordsWorkflowRepository.failRun(workflowRunId, 'CHAPTER_KEYWORDS_NO_SENTENCES', 'No text sentences were found in the canonical chapter state.');
                return;
            }
            const promptVariant = this.promptVariantForBook(runningRun.bookId);
            const totalParagraphCount = new Set(chunks.flatMap((chunk) => chunk.sentences.map((sentence) => paragraphKey(sentence.ref)))).size;
            const resumeState = this.restoreChunkProgress(workflowRunId, runningRun, chunks);
            const mergedByParagraph = resumeState.mergedByParagraph;
            if (resumeState.startChunkIndex === 0) {
                this.chapterKeywordsWorkflowRepository.updateRunCheckpoint(workflowRunId, this.buildChunkCheckpoint(chunks, -1));
            }
            for (const chunk of chunks.slice(resumeState.startChunkIndex)) {
                const result = await (0, chapter_keywords_llm_1.analyzeChapterKeywordsChunk)({
                    docId: runningRun.bookId,
                    chapterId: runningRun.chapterId,
                    chapterIndex: runningRun.chapterIndex,
                    chunkId: chunk.id,
                    chunkIndex: chunk.index,
                    totalChunks: chunk.total,
                    chunkText: chunk.chunkText,
                    sentences: chunk.sentences,
                    contentHash: chapter.chapterContentHash,
                    promptVariant,
                });
                const normalizedChunkResult = {
                    chunkIndex: chunk.index,
                    keySentences: this.filterChunkKeySentences(result.key_sentences, promptVariant),
                };
                this.chapterKeywordsWorkflowRepository.updatePartialChunkResult(workflowRunId, normalizedChunkResult);
                this.applyChunkResultToMergedParagraphs(mergedByParagraph, normalizedChunkResult);
                this.chapterKeywordsWorkflowRepository.updateRunCheckpoint(workflowRunId, this.buildChunkCheckpoint(chunks, chunk.index));
            }
            const mergedResult = {
                key_sentences: this.finalizeMergedKeySentences(Array.from(mergedByParagraph.values()), promptVariant, totalParagraphCount),
                sentence_keywords: [],
            };
            this.chapterKeywordsWorkflowRepository.completeRun({
                workflowRunId,
                snapshotVersion: book.snapshotVersion,
                chapterContentHash: chapter.chapterContentHash,
                result: mergedResult,
            });
        }
        catch (error) {
            this.chapterKeywordsWorkflowRepository.failRun(workflowRunId, 'CHAPTER_KEYWORDS_GENERATION_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    planChunks(bookId, chapterId) {
        const chapter = this.bookIngestionRepository.getChapter(bookId, chapterId);
        if (!chapter)
            return [];
        const paragraphGroups = [];
        const pages = Array.from(chapter.pages.entries()).sort(([left], [right]) => left - right);
        for (const [pageIndex, page] of pages) {
            const paragraphEntries = sortParagraphEntries(page.pageParagraphs);
            paragraphEntries.forEach((entry, paragraphIndex) => {
                const paragraphText = entry.value.trim();
                if (!paragraphText)
                    return;
                const paragraphId = stableParagraphId(entry.key, paragraphIndex);
                const sentences = splitSentences(paragraphText)
                    .map((sentenceText, sentenceIndex) => ({
                    ref: {
                        page_index: pageIndex,
                        paragraph_index: paragraphIndex,
                        paragraph_id: paragraphId,
                        sentence_id: sentenceIndex,
                    },
                    text: sentenceText,
                }));
                if (!sentences.length)
                    return;
                paragraphGroups.push({
                    pageIndex,
                    paragraphIndex,
                    paragraphId,
                    paragraphText,
                    sentences,
                });
            });
        }
        if (!paragraphGroups.length)
            return [];
        const ranges = [];
        let start = 0;
        while (start < paragraphGroups.length) {
            let end = start;
            let characterCount = 0;
            let paragraphCount = 0;
            while (end < paragraphGroups.length) {
                const separatorCount = paragraphCount === 0 ? 0 : 2;
                const proposedCharacters = characterCount
                    + separatorCount
                    + paragraphGroups[end].paragraphText.length;
                if (paragraphCount > 0
                    && (paragraphCount >= MAX_PARAGRAPHS_PER_CHUNK
                        || proposedCharacters > TARGET_CHUNK_CHARACTERS)) {
                    break;
                }
                characterCount = proposedCharacters;
                paragraphCount += 1;
                end += 1;
            }
            if (end === start)
                end += 1;
            ranges.push({ start, end });
            if (end >= paragraphGroups.length)
                break;
            start = Math.max(start + 1, end - OVERLAP_PARAGRAPHS);
        }
        const total = ranges.length;
        return ranges.map((range, index) => {
            const groups = paragraphGroups.slice(range.start, range.end);
            return {
                id: `chunk-${index + 1}`,
                index,
                total,
                chunkText: groups.map((group) => group.paragraphText).join('\n\n'),
                sentences: groups.flatMap((group) => group.sentences),
            };
        });
    }
    promptVariantForBook(bookId) {
        const book = this.bookIngestionRepository.getBook(bookId);
        const metadataRecord = isPlainObject(book?.bookMetadata) ? book.bookMetadata : {};
        return asBoolean(metadataRecord.isFiction) === true ? 'fiction' : 'nonfiction';
    }
    filterChunkKeySentences(keySentences, promptVariant) {
        if (promptVariant !== 'fiction')
            return keySentences;
        return [...keySentences]
            .filter((item) => item.importance >= 0.86)
            .sort((left, right) => {
            if (right.importance !== left.importance) {
                return right.importance - left.importance;
            }
            return compareSentenceRefs(left.sentence_ref, right.sentence_ref);
        })
            .slice(0, 1);
    }
    restoreChunkProgress(workflowRunId, run, chunks) {
        const mergedByParagraph = new Map();
        const checkpoint = run.checkpoint;
        if (!checkpoint || checkpoint.nextChunkIndex <= 0) {
            return {
                startChunkIndex: 0,
                mergedByParagraph,
            };
        }
        const partialChunkResults = run.partialChunkResults ?? [];
        const expectedChunkCount = Math.min(checkpoint.nextChunkIndex, chunks.length);
        const replayableResults = partialChunkResults
            .filter((item) => item.chunkIndex >= 0 && item.chunkIndex < expectedChunkCount)
            .sort((left, right) => left.chunkIndex - right.chunkIndex);
        const isSequential = replayableResults.length === expectedChunkCount
            && replayableResults.every((item, index) => item.chunkIndex === index);
        const isCompatibleCheckpoint = checkpoint.totalChunks === chunks.length
            && checkpoint.nextChunkIndex <= chunks.length;
        if (!isSequential || !isCompatibleCheckpoint) {
            (0, workflow_logger_1.workflowLog)('run.resume_fallback_to_start', {
                workflowKind: run.kind,
                workflowRunId,
                bookId: run.bookId,
                chapterId: run.chapterId,
                chapterIndex: run.chapterIndex,
                workflowVersion: run.workflowVersion,
                reason: !isCompatibleCheckpoint ? 'checkpoint_mismatch' : 'missing_partial_chunks',
            });
            this.chapterKeywordsWorkflowRepository.clearRunCheckpoint(workflowRunId);
            this.chapterKeywordsWorkflowRepository.clearPartialChunkResults(workflowRunId);
            return {
                startChunkIndex: 0,
                mergedByParagraph,
            };
        }
        for (const partialChunkResult of replayableResults) {
            this.applyChunkResultToMergedParagraphs(mergedByParagraph, partialChunkResult);
        }
        return {
            startChunkIndex: checkpoint.nextChunkIndex,
            mergedByParagraph,
        };
    }
    applyChunkResultToMergedParagraphs(mergedByParagraph, partialChunkResult) {
        for (const item of partialChunkResult.keySentences) {
            const key = paragraphKey(item.sentence_ref);
            const existing = mergedByParagraph.get(key);
            if (!existing
                || item.importance > existing.importance
                || (item.importance === existing.importance
                    && compareSentenceRefs(item.sentence_ref, existing.ref) < 0)) {
                mergedByParagraph.set(key, {
                    ref: item.sentence_ref,
                    text: item.sentence_text,
                    importance: item.importance,
                    reason: item.reason,
                });
            }
        }
    }
    buildChunkCheckpoint(chunks, completedChunkIndex) {
        return {
            totalChunks: chunks.length,
            lastCompletedChunkIndex: completedChunkIndex,
            nextChunkIndex: completedChunkIndex + 1,
            updatedAt: new Date().toISOString(),
        };
    }
    finalizeMergedKeySentences(items, promptVariant, totalParagraphCount) {
        const sortedByReadingOrder = items
            .sort((left, right) => {
            if (left.ref.page_index !== right.ref.page_index) {
                return left.ref.page_index - right.ref.page_index;
            }
            if (left.ref.paragraph_index !== right.ref.paragraph_index) {
                return left.ref.paragraph_index - right.ref.paragraph_index;
            }
            return left.ref.sentence_id - right.ref.sentence_id;
        });
        let selected = sortedByReadingOrder;
        if (promptVariant === 'fiction') {
            const maxHighlights = Math.max(1, Math.ceil(totalParagraphCount / 6));
            selected = [...sortedByReadingOrder]
                .filter((item) => item.importance >= 0.86)
                .sort((left, right) => {
                if (right.importance !== left.importance) {
                    return right.importance - left.importance;
                }
                return compareSentenceRefs(left.ref, right.ref);
            })
                .slice(0, maxHighlights)
                .sort((left, right) => compareSentenceRefs(left.ref, right.ref));
        }
        return selected.map((item) => ({
            sentence_ref: item.ref,
            sentence_text: item.text,
            importance: item.importance,
            reason: item.reason,
        }));
    }
    buildDefaultIdempotencyKey(bookId, chapterId, workflowVersion, chapterContentHash) {
        return `chapter-keywords:${workflowVersion}:${bookId}:${chapterId}:${chapterContentHash}`;
    }
    requireRun(workflowRunId) {
        const run = this.chapterKeywordsWorkflowRepository.getRun(workflowRunId);
        if (!run) {
            throw new common_1.NotFoundException('Chapter keywords workflow run not found');
        }
        return run;
    }
    toSubmitResponse(run, deduped) {
        return {
            workflowRunId: run.id,
            kind: run.kind,
            status: run.status,
            bookId: run.bookId,
            chapterId: run.chapterId,
            chapterIndex: run.chapterIndex,
            workflowVersion: run.workflowVersion,
            producer: run.producer,
            qualityTier: run.qualityTier,
            resultVersion: run.resultVersion,
            snapshotVersion: run.snapshotVersion,
            chapterContentHash: run.chapterContentHash,
            deduped,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            completedAt: run.completedAt,
            error: run.error,
        };
    }
    toStatusResponse(run) {
        return {
            workflowRunId: run.id,
            kind: run.kind,
            status: run.status,
            bookId: run.bookId,
            chapterId: run.chapterId,
            chapterIndex: run.chapterIndex,
            workflowVersion: run.workflowVersion,
            producer: run.producer,
            qualityTier: run.qualityTier,
            resultVersion: run.resultVersion,
            snapshotVersion: run.snapshotVersion,
            chapterContentHash: run.chapterContentHash,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            resultAvailable: Boolean(run.output),
            error: run.error,
            checkpoint: run.checkpoint,
        };
    }
    toLatestResponse(result) {
        return {
            workflowRunId: result.workflowRunId,
            bookId: result.bookId,
            chapterId: result.chapterId,
            chapterIndex: result.chapterIndex,
            workflowVersion: result.workflowVersion,
            resultVersion: result.resultVersion,
            producer: result.producer,
            qualityTier: result.qualityTier,
            snapshotVersion: result.snapshotVersion,
            chapterContentHash: result.chapterContentHash,
            updatedAt: result.updatedAt,
            result: result.result,
        };
    }
    requireString(value, field) {
        const result = asString(value);
        if (!result) {
            throw new common_1.BadRequestException(`${field} must be a non-empty string`);
        }
        return result;
    }
    requireNonNegativeInteger(value, field) {
        const result = asNumber(value);
        if (result === undefined || !Number.isInteger(result) || result < 0) {
            throw new common_1.BadRequestException(`${field} must be a non-negative integer`);
        }
        return result;
    }
    requireRestartMode(value) {
        const result = asString(value);
        if (result !== 'resume' && result !== 'from_start') {
            throw new common_1.BadRequestException('mode must be "resume" or "from_start"');
        }
        return result;
    }
};
exports.ChapterKeywordsWorkflowService = ChapterKeywordsWorkflowService;
exports.ChapterKeywordsWorkflowService = ChapterKeywordsWorkflowService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(book_ingestion_repository_1.BookIngestionRepository)),
    __param(1, (0, common_1.Inject)(chapter_keywords_workflow_repository_1.ChapterKeywordsWorkflowRepository)),
    __param(2, (0, common_1.Inject)(workflow_queue_service_1.WorkflowQueueService)),
    __metadata("design:paramtypes", [book_ingestion_repository_1.BookIngestionRepository,
        chapter_keywords_workflow_repository_1.ChapterKeywordsWorkflowRepository,
        workflow_queue_service_1.WorkflowQueueService])
], ChapterKeywordsWorkflowService);
//# sourceMappingURL=chapter-keywords-workflow.service.js.map