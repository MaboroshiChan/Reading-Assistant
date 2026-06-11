import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { workflowLog } from '../workflow.logger';
import type {
  ChapterOpenAnalysisRunRecord,
  ChapterOpenAnalysisStatus,
  SubmitChapterOpenAnalysisInput,
} from './chapter-open-analysis.types';

const chapterKey = (bookId: string, chapterId: string): string => `${bookId}::${chapterId}`;

@Injectable()
export class ChapterOpenAnalysisRepository {
  private readonly runs = new Map<string, ChapterOpenAnalysisRunRecord>();
  private readonly runIdsByIdempotencyKey = new Map<string, string>();
  private readonly latestRunIdsByChapter = new Map<string, string>();

  createOrReuseRun(input: SubmitChapterOpenAnalysisInput): {
    run: ChapterOpenAnalysisRunRecord;
    deduped: boolean;
  } {
    const existingRunId = this.runIdsByIdempotencyKey.get(input.idempotencyKey);
    if (existingRunId) {
      const existingRun = this.runs.get(existingRunId);
      if (existingRun) {
        if (existingRun.status === 'failed' || existingRun.status === 'stale') {
          this.runIdsByIdempotencyKey.delete(input.idempotencyKey);
        } else {
          return {
            run: { ...existingRun },
            deduped: true,
          };
        }
      }
    }

    const timestamp = new Date().toISOString();
    const run: ChapterOpenAnalysisRunRecord = {
      id: randomUUID(),
      kind: 'chapter_open_analysis',
      status: 'queued',
      bookId: input.bookId,
      chapterId: input.chapterId,
      chapterIndex: input.chapterIndex,
      pipelineVersion: input.pipelineVersion,
      idempotencyKey: input.idempotencyKey,
      expectedSnapshotVersion: input.expectedSnapshotVersion,
      expectedChapterContentHash: input.expectedChapterContentHash,
      clientSessionId: input.clientSessionId,
      trigger: input.trigger,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.runs.set(run.id, run);
    this.runIdsByIdempotencyKey.set(input.idempotencyKey, run.id);
    this.latestRunIdsByChapter.set(chapterKey(run.bookId, run.chapterId), run.id);
    workflowLog('run.queued', {
      workflowKind: run.kind,
      workflowRunId: run.id,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      pipelineVersion: run.pipelineVersion,
      idempotencyKey: run.idempotencyKey,
    });
    return { run, deduped: false };
  }

  getRun(runId: string): ChapterOpenAnalysisRunRecord | null {
    return this.runs.get(runId) ?? null;
  }

  getLatestRun(bookId: string, chapterId: string): ChapterOpenAnalysisRunRecord | null {
    const runId = this.latestRunIdsByChapter.get(chapterKey(bookId, chapterId));
    return runId ? this.runs.get(runId) ?? null : null;
  }

  markRunning(runId: string, snapshotVersion?: number, chapterContentHash?: string): ChapterOpenAnalysisRunRecord | null {
    return this.update(runId, (run) => ({
      ...run,
      status: 'running',
      snapshotVersion: snapshotVersion ?? run.snapshotVersion,
      chapterContentHash: chapterContentHash ?? run.chapterContentHash,
      startedAt: run.startedAt ?? new Date().toISOString(),
      completedAt: undefined,
      error: undefined,
    }));
  }

  attachChildRuns(args: {
    runId: string;
    preReadingWorkflowRunId?: string;
    chapterKeywordsWorkflowRunId?: string;
    knowledgeExtractionWorkflowRunId?: string;
    quizWorkflowRunId?: string;
  }): ChapterOpenAnalysisRunRecord | null {
    return this.update(args.runId, (run) => ({
      ...run,
      preReadingWorkflowRunId: args.preReadingWorkflowRunId ?? run.preReadingWorkflowRunId,
      chapterKeywordsWorkflowRunId: args.chapterKeywordsWorkflowRunId ?? run.chapterKeywordsWorkflowRunId,
      knowledgeExtractionWorkflowRunId: args.knowledgeExtractionWorkflowRunId ?? run.knowledgeExtractionWorkflowRunId,
      quizWorkflowRunId: args.quizWorkflowRunId ?? run.quizWorkflowRunId,
    }));
  }

  finish(
    runId: string,
    status: ChapterOpenAnalysisStatus,
    error?: { code: string; message: string },
  ): ChapterOpenAnalysisRunRecord | null {
    return this.update(runId, (run) => ({
      ...run,
      status,
      error,
      completedAt: new Date().toISOString(),
    }));
  }

  updateSnapshot(runId: string, snapshotVersion: number, chapterContentHash: string): ChapterOpenAnalysisRunRecord | null {
    return this.update(runId, (run) => ({
      ...run,
      snapshotVersion,
      chapterContentHash,
    }));
  }

  private update(
    runId: string,
    mutate: (run: ChapterOpenAnalysisRunRecord) => ChapterOpenAnalysisRunRecord,
  ): ChapterOpenAnalysisRunRecord | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    const updated = {
      ...mutate(run),
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, updated);
    this.latestRunIdsByChapter.set(chapterKey(updated.bookId, updated.chapterId), updated.id);
    return updated;
  }
}
