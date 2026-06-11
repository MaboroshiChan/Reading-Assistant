import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { workflowLog } from '../workflow.logger';
import type {
  ChapterKeywordsWorkflowResultPayload,
  ChapterKeywordsWorkflowRunRecord,
  ChapterKeywordsWorkflowStoredResult,
  SubmitChapterKeywordsWorkflowInput,
} from './chapter-keywords-workflow.types';

const chapterKey = (bookId: string, chapterId: string): string => `${bookId}::${chapterId}`;

@Injectable()
export class ChapterKeywordsWorkflowRepository {
  private readonly runs = new Map<string, ChapterKeywordsWorkflowRunRecord>();
  private readonly runIdsByIdempotencyKey = new Map<string, string>();
  private readonly latestResultsByChapter = new Map<string, ChapterKeywordsWorkflowStoredResult>();

  createOrReuseRun(input: SubmitChapterKeywordsWorkflowInput): {
    run: ChapterKeywordsWorkflowRunRecord;
    deduped: boolean;
  } {
    const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
    if (existingRunId) {
      const existingRun = this.runs.get(existingRunId);
      if (existingRun) {
        if (existingRun.status === 'failed' || existingRun.status === 'stale') {
          this.runIdsByIdempotencyKey.delete(input.idempotencyKey);
        } else {
          workflowLog('run.deduped', {
            workflowKind: existingRun.kind,
            workflowRunId: existingRun.id,
            dedupedWorkflowRunId: existingRun.id,
            bookId: existingRun.bookId,
            chapterId: existingRun.chapterId,
            chapterIndex: existingRun.chapterIndex,
            workflowVersion: existingRun.workflowVersion,
            idempotencyKey: existingRun.idempotencyKey,
            status: existingRun.status,
          });
          return {
            run: { ...existingRun, deduped: true },
            deduped: true,
          };
        }
      }
    }

    const timestamp = new Date().toISOString();
    const run: ChapterKeywordsWorkflowRunRecord = {
      id: randomUUID(),
      kind: 'chapter_keywords',
      status: 'queued',
      bookId: input.bookId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      workflowVersion: input.workflowVersion,
      idempotencyKey: input.idempotencyKey,
      producer: 'server',
      qualityTier: 'server_final',
      requestedByUserId: input.requestedByUserId,
      expectedSnapshotVersion: input.expectedSnapshotVersion,
      expectedChapterContentHash: input.expectedChapterContentHash,
      deduped: false,
      resultVersion: input.workflowVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.runs.set(run.id, run);
    this.runIdsByIdempotencyKey.set(input.idempotencyKey, run.id);
    workflowLog('run.queued', {
      workflowKind: run.kind,
      workflowRunId: run.id,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      idempotencyKey: run.idempotencyKey,
      requestedByUserId: run.requestedByUserId,
    });

    return { run, deduped: false };
  }

  getRun(workflowRunId: string): ChapterKeywordsWorkflowRunRecord | null {
    return this.runs.get(workflowRunId) ?? null;
  }

  markRunning(workflowRunId: string): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      status: 'running',
      startedAt: run.startedAt ?? timestamp,
      updatedAt: timestamp,
      deduped: false,
    };
    this.runs.set(workflowRunId, updated);
    workflowLog('run.running', {
      workflowKind: updated.kind,
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      startedAt: updated.startedAt,
    });
    return updated;
  }

  completeRun(args: {
    workflowRunId: string;
    snapshotVersion: number;
    chapterContentHash: string;
    result: ChapterKeywordsWorkflowResultPayload;
  }): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(args.workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      status: 'completed',
      snapshotVersion: args.snapshotVersion,
      chapterContentHash: args.chapterContentHash,
      output: args.result,
      error: undefined,
      updatedAt: timestamp,
      completedAt: timestamp,
      deduped: false,
    };
    this.runs.set(args.workflowRunId, updated);

    const storedResult: ChapterKeywordsWorkflowStoredResult = {
      workflowRunId: args.workflowRunId,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      resultVersion: updated.resultVersion,
      producer: updated.producer,
      qualityTier: updated.qualityTier,
      snapshotVersion: args.snapshotVersion,
      chapterContentHash: args.chapterContentHash,
      result: args.result,
      createdAt: updated.createdAt,
      updatedAt: timestamp,
    };
    this.latestResultsByChapter.set(chapterKey(updated.bookId, updated.chapterId), storedResult);
    workflowLog('run.completed', {
      workflowKind: updated.kind,
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      snapshotVersion: updated.snapshotVersion,
      chapterContentHash: updated.chapterContentHash,
      resultSentenceCount: args.result.key_sentences.length,
      completedAt: updated.completedAt,
    });

    return updated;
  }

  failRun(workflowRunId: string, code: string, message: string): ChapterKeywordsWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'failed', code, message);
  }

  markStale(workflowRunId: string, code: string, message: string): ChapterKeywordsWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'stale', code, message);
  }

  getLatestResult(bookId: string, chapterId: string): ChapterKeywordsWorkflowStoredResult | null {
    return this.latestResultsByChapter.get(chapterKey(bookId, chapterId)) ?? null;
  }

  findLatestRunForChapter(bookId: string, chapterId: string): ChapterKeywordsWorkflowRunRecord | null {
    const candidates = Array.from(this.runs.values())
      .filter((run) => run.bookId === bookId && run.chapterId === chapterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return candidates[0] ?? null;
  }

  private finishWithError(
    workflowRunId: string,
    status: 'failed' | 'stale',
    code: string,
    message: string,
  ): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      status,
      error: { code, message },
      updatedAt: timestamp,
      completedAt: timestamp,
      deduped: false,
    };
    this.runs.set(workflowRunId, updated);
    workflowLog(`run.${status}`, {
      workflowKind: updated.kind,
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      errorCode: code,
      errorMessage: message,
      completedAt: updated.completedAt,
    });
    return updated;
  }
}
