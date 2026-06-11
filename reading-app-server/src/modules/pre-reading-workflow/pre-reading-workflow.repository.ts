import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  PreReadingResultPayload,
  PreReadingWorkflowRunRecord,
  PreReadingWorkflowStoredResult,
  SubmitPreReadingWorkflowInput,
} from './pre-reading-workflow.types';

const chapterKey = (bookId: string, chapterId: string): string => `${bookId}::${chapterId}`;

@Injectable()
export class PreReadingWorkflowRepository {
  private readonly runs = new Map<string, PreReadingWorkflowRunRecord>();
  private readonly runIdsByIdempotencyKey = new Map<string, string>();
  private readonly latestResultsByChapter = new Map<string, PreReadingWorkflowStoredResult>();

  createOrReuseRun(input: SubmitPreReadingWorkflowInput): {
    run: PreReadingWorkflowRunRecord;
    deduped: boolean;
  } {
    const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
    const existingRun = existingRunId ? this.runs.get(existingRunId) : undefined;
    if (existingRun && existingRun.status !== 'failed' && existingRun.status !== 'stale') {
      return { run: existingRun, deduped: true };
    }
    if (existingRunId) {
      this.runIdsByIdempotencyKey.delete(input.idempotencyKey);
    }

    const timestamp = new Date().toISOString();
    const run: PreReadingWorkflowRunRecord = {
      id: randomUUID(),
      kind: 'pre_reading_generation',
      status: 'queued',
      bookId: input.bookId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      workflowVersion: input.workflowVersion,
      idempotencyKey: input.idempotencyKey,
      expectedSnapshotVersion: input.expectedSnapshotVersion,
      expectedChapterContentHash: input.expectedChapterContentHash,
      requestedByUserId: input.requestedByUserId,
      resultVersion: input.workflowVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.runs.set(run.id, run);
    this.runIdsByIdempotencyKey.set(input.idempotencyKey, run.id);
    return { run, deduped: false };
  }

  getRun(workflowRunId: string): PreReadingWorkflowRunRecord | null {
    return this.runs.get(workflowRunId) ?? null;
  }

  findLatestRunForChapter(bookId: string, chapterId: string): PreReadingWorkflowRunRecord | null {
    return Array.from(this.runs.values())
      .filter((run) => run.bookId === bookId && run.chapterId === chapterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  }

  markRunning(workflowRunId: string): PreReadingWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run || run.status !== 'queued') return null;
    return this.store({
      ...run,
      status: 'running',
      startedAt: run.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: undefined,
    });
  }

  completeRun(args: {
    workflowRunId: string;
    snapshotVersion: number;
    chapterContentHash: string;
    result: PreReadingResultPayload;
  }): PreReadingWorkflowRunRecord | null {
    const run = this.runs.get(args.workflowRunId);
    if (!run) return null;
    const timestamp = new Date().toISOString();
    const updated = this.store({
      ...run,
      status: 'completed',
      snapshotVersion: args.snapshotVersion,
      chapterContentHash: args.chapterContentHash,
      output: args.result,
      error: undefined,
      updatedAt: timestamp,
      completedAt: timestamp,
    });
    this.latestResultsByChapter.set(chapterKey(updated.bookId, updated.chapterId), {
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      resultVersion: updated.resultVersion,
      snapshotVersion: args.snapshotVersion,
      chapterContentHash: args.chapterContentHash,
      result: args.result,
      createdAt: updated.createdAt,
      updatedAt: timestamp,
    });
    return updated;
  }

  failRun(workflowRunId: string, code: string, message: string): PreReadingWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'failed', code, message);
  }

  markStale(workflowRunId: string, code: string, message: string): PreReadingWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'stale', code, message);
  }

  getLatestResult(bookId: string, chapterId: string): PreReadingWorkflowStoredResult | null {
    return this.latestResultsByChapter.get(chapterKey(bookId, chapterId)) ?? null;
  }

  private finishWithError(
    workflowRunId: string,
    status: 'failed' | 'stale',
    code: string,
    message: string,
  ): PreReadingWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;
    const timestamp = new Date().toISOString();
    return this.store({
      ...run,
      status,
      error: { code, message },
      updatedAt: timestamp,
      completedAt: timestamp,
    });
  }

  private store(run: PreReadingWorkflowRunRecord): PreReadingWorkflowRunRecord {
    this.runs.set(run.id, run);
    return run;
  }
}
