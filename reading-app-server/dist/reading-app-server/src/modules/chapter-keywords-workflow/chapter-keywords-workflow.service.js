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
const refKey = (ref) => `${ref.page_index}:${ref.paragraph_index}:${ref.paragraph_id}:${ref.sentence_id}`;
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
            const mergedByRef = new Map();
            for (const chunk of chunks) {
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
                });
                for (const item of result.key_sentences) {
                    const key = refKey(item.sentence_ref);
                    const existing = mergedByRef.get(key);
                    if (!existing || item.importance > existing.importance) {
                        mergedByRef.set(key, {
                            ref: item.sentence_ref,
                            text: item.sentence_text,
                            importance: item.importance,
                            reason: item.reason,
                        });
                    }
                }
            }
            const mergedResult = {
                key_sentences: Array.from(mergedByRef.values())
                    .sort((left, right) => {
                    if (left.ref.page_index !== right.ref.page_index) {
                        return left.ref.page_index - right.ref.page_index;
                    }
                    if (left.ref.paragraph_index !== right.ref.paragraph_index) {
                        return left.ref.paragraph_index - right.ref.paragraph_index;
                    }
                    return left.ref.sentence_id - right.ref.sentence_id;
                })
                    .map((item) => ({
                    sentence_ref: item.ref,
                    sentence_text: item.text,
                    importance: item.importance,
                    reason: item.reason,
                })),
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