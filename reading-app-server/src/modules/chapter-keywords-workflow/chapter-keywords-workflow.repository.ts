import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { workflowLog } from '../workflow.logger';
import { SurrealService } from '../surrealDB/surrealdb.service';
import type {
  ChapterKeywordsWorkflowCheckpoint,
  ChapterKeywordsWorkflowPartialChunkResult,
  ChapterKeywordsWorkflowResultPayload,
  ChapterKeywordsWorkflowRestartMode,
  ChapterKeywordsWorkflowRunRecord,
  ChapterKeywordsWorkflowStoredResult,
  SubmitChapterKeywordsWorkflowInput,
} from './chapter-keywords-workflow.types';

const chapterKey = (bookId: string, chapterId: string): string => `${bookId}::${chapterId}`;
const normalizeWorkflowRunId = (value: string): string =>
  value.startsWith('chapter_keywords_workflow_run:')
    ? value.slice('chapter_keywords_workflow_run:'.length)
    : value;

type PersistTable = 'chapter_keywords_workflow_run' | 'chapter_keyword_results';

@Injectable()
export class ChapterKeywordsWorkflowRepository implements OnModuleInit {
  private readonly runs = new Map<string, ChapterKeywordsWorkflowRunRecord>();
  private readonly runIdsByIdempotencyKey = new Map<string, string>();
  private readonly latestResultsByChapter = new Map<string, ChapterKeywordsWorkflowStoredResult>();
  private pendingPersist: Promise<void> = Promise.resolve();

  constructor(
    @Optional()
    @Inject(SurrealService)
    private readonly surrealService?: SurrealService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.surrealService) return;
    await this.ensureSchema();
    await this.loadFromStore();
  }

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
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', run.id, run));
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
    return this.runs.get(normalizeWorkflowRunId(workflowRunId)) ?? null;
  }

  listRecoverableRuns(): ChapterKeywordsWorkflowRunRecord[] {
    return Array.from(this.runs.values())
      .filter((run) => run.status === 'queued' || run.status === 'running')
      .sort((left, right) => {
        const leftTime = Date.parse(left.startedAt ?? left.createdAt);
        const rightTime = Date.parse(right.startedAt ?? right.createdAt);
        return leftTime - rightTime;
      })
      .map((run) => ({ ...run }));
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
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
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

  updateRunCheckpoint(
    workflowRunId: string,
    checkpoint: ChapterKeywordsWorkflowCheckpoint,
  ): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return null;

    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      checkpoint,
      updatedAt: checkpoint.updatedAt,
    };
    this.runs.set(workflowRunId, updated);
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
    return updated;
  }

  updatePartialChunkResult(
    workflowRunId: string,
    partialChunkResult: ChapterKeywordsWorkflowPartialChunkResult,
  ): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return null;

    const nextResults = (run.partialChunkResults ?? [])
      .filter((item) => item.chunkIndex !== partialChunkResult.chunkIndex)
      .concat(partialChunkResult)
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
    const timestamp = new Date().toISOString();
    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      partialChunkResults: nextResults,
      updatedAt: timestamp,
    };
    this.runs.set(workflowRunId, updated);
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
    return updated;
  }

  clearPartialChunkResults(workflowRunId: string): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      partialChunkResults: undefined,
      updatedAt: timestamp,
    };
    this.runs.set(workflowRunId, updated);
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
    return updated;
  }

  clearRunCheckpoint(workflowRunId: string): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run) return null;

    const timestamp = new Date().toISOString();
    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      checkpoint: undefined,
      updatedAt: timestamp,
    };
    this.runs.set(workflowRunId, updated);
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
    return updated;
  }

  restartFailedRun(
    workflowRunId: string,
    mode: ChapterKeywordsWorkflowRestartMode,
  ): ChapterKeywordsWorkflowRunRecord | null {
    const run = this.runs.get(workflowRunId);
    if (!run || run.status !== 'failed') return null;

    const timestamp = new Date().toISOString();
    const updated: ChapterKeywordsWorkflowRunRecord = {
      ...run,
      status: 'queued',
      output: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      checkpoint: mode === 'resume' ? run.checkpoint : undefined,
      partialChunkResults: mode === 'resume' ? run.partialChunkResults : undefined,
      updatedAt: timestamp,
      deduped: false,
    };
    this.runs.set(workflowRunId, updated);
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
    workflowLog('run.restarted', {
      workflowKind: updated.kind,
      workflowRunId: updated.id,
      bookId: updated.bookId,
      chapterId: updated.chapterId,
      chapterIndex: updated.chapterIndex,
      workflowVersion: updated.workflowVersion,
      restartMode: mode,
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
      checkpoint: undefined,
      partialChunkResults: undefined,
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
    this.schedulePersist(async () => {
      await this.persistRecord('chapter_keywords_workflow_run', updated.id, updated);
      await this.persistRecord('chapter_keyword_results', this.makeStoredResultId(updated.bookId, updated.chapterId), storedResult);
    });
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
    this.schedulePersist(() => this.persistRecord('chapter_keywords_workflow_run', updated.id, updated));
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

  private async ensureSchema(): Promise<void> {
    if (!this.surrealService) return;
    await this.surrealService.query<unknown>([
      'DEFINE TABLE IF NOT EXISTS chapter_keywords_workflow_run SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS chapter_keyword_results SCHEMALESS;',
    ].join('\n'));
  }

  private async loadFromStore(): Promise<void> {
    if (!this.surrealService) return;

    const [workflowRuns, results] = await Promise.all([
      this.surrealService.selectTable<ChapterKeywordsWorkflowRunRecord>('chapter_keywords_workflow_run'),
      this.surrealService.selectTable<ChapterKeywordsWorkflowStoredResult>('chapter_keyword_results'),
    ]);

    this.runs.clear();
    this.runIdsByIdempotencyKey.clear();
    this.latestResultsByChapter.clear();

    for (const result of results) {
      const hydratedResult: ChapterKeywordsWorkflowStoredResult = {
        ...result,
        workflowRunId: normalizeWorkflowRunId(result.workflowRunId),
      };
      this.latestResultsByChapter.set(chapterKey(result.bookId, result.chapterId), hydratedResult);
    }

    for (const run of workflowRuns) {
      const hydratedRun: ChapterKeywordsWorkflowRunRecord = {
        ...run,
        id: normalizeWorkflowRunId(run.id),
      };
      this.runs.set(hydratedRun.id, hydratedRun);
      this.runIdsByIdempotencyKey.set(hydratedRun.idempotencyKey, hydratedRun.id);
    }
  }

  private makeStoredResultId(bookId: string, chapterId: string): string {
    return `${bookId}::${chapterId}`;
  }

  private schedulePersist(task: () => Promise<void>): void {
    if (!this.surrealService) return;
    this.pendingPersist = this.pendingPersist
      .then(task)
      .catch((error) => {
        console.error('[chapter-keywords] failed to persist repository state', error);
      });
  }

  private async persistRecord(table: PersistTable, id: string, record: object): Promise<void> {
    if (!this.surrealService) return;
    await this.surrealService.putRecord(table, id, record);
  }
}
