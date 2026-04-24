import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { workflowLog } from '../workflow.logger';
import type {
  KnowledgeExtractionWorkflowResultPayload,
  KnowledgeExtractionWorkflowRunRecord,
  KnowledgeExtractionWorkflowStoredResult,
  SubmitKnowledgeExtractionWorkflowInput,
} from './knowledge-extraction-workflow.types';

const chapterKey = (bookId: string, chapterId: string): string => `${bookId}::${chapterId}`;

@Injectable()
export class KnowledgeExtractionWorkflowRepository {
  private readonly runs = new Map<string, KnowledgeExtractionWorkflowRunRecord>();
  private readonly runIdsByIdempotencyKey = new Map<string, string>();
  private readonly latestResultsByChapter = new Map<string, KnowledgeExtractionWorkflowStoredResult>();

  createOrReuseRun(input: SubmitKnowledgeExtractionWorkflowInput): {
    run: KnowledgeExtractionWorkflowRunRecord;
    deduped: boolean;
  } {
    const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
    if (existingRunId) {
      const existingRun = this.runs.get(existingRunId);
      if (existingRun) {
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

    const timestamp = new Date().toISOString();
    const run: KnowledgeExtractionWorkflowRunRecord = {
      id: randomUUID(),
      kind: 'knowledge_extraction',
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

  getRun(workflowRunId: string): KnowledgeExtractionWorkflowRunRecord | null {
    return this.runs.get(workflowRunId) ?? null;
  }

  markRunning(workflowRunId: string): KnowledgeExtractionWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: KnowledgeExtractionWorkflowRunRecord = {
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
    result: KnowledgeExtractionWorkflowResultPayload;
  }): KnowledgeExtractionWorkflowRunRecord | null {
    const run = this.runs.get(args.workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: KnowledgeExtractionWorkflowRunRecord = {
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

    const storedResult: KnowledgeExtractionWorkflowStoredResult = {
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
      peopleCount: args.result.people?.length ?? 0,
      ideaCount: args.result.ideas?.length ?? 0,
      eventCount: args.result.events?.length ?? 0,
      entityCount: args.result.entities?.length ?? 0,
      themeCount: args.result.themes?.length ?? 0,
      relationCount: args.result.relations?.length ?? 0,
      completedAt: updated.completedAt,
    });

    return updated;
  }

  failRun(workflowRunId: string, code: string, message: string): KnowledgeExtractionWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'failed', code, message);
  }

  markStale(workflowRunId: string, code: string, message: string): KnowledgeExtractionWorkflowRunRecord | null {
    return this.finishWithError(workflowRunId, 'stale', code, message);
  }

  getLatestResult(bookId: string, chapterId: string): KnowledgeExtractionWorkflowStoredResult | null {
    return this.latestResultsByChapter.get(chapterKey(bookId, chapterId)) ?? null;
  }

  private finishWithError(
    workflowRunId: string,
    status: 'failed' | 'stale',
    code: string,
    message: string,
  ): KnowledgeExtractionWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: KnowledgeExtractionWorkflowRunRecord = {
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
