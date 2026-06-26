import { describe, expect, test } from 'vitest';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';

const recordProgressPercent = (record: Record<string, unknown>): number | undefined => {
  const progress = record.progress;
  return typeof progress === 'object'
    && progress !== null
    && typeof (progress as { percent?: unknown }).percent === 'number'
    ? (progress as { percent: number }).percent
    : undefined;
};

describe('KnowledgeExtractionWorkflowRepository', () => {
  test('persists slim workflow and snapshot records while keeping full results in memory', async () => {
    const persisted: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    const surrealStub = {
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        persisted.push({ table, id, record });
      },
      putRelationRecord: async () => {},
      selectTable: async () => [],
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    const input = {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1' as const,
      idempotencyKey: 'knowledge-extraction:v1:book-1:chapter-1:hash-1',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-1',
      requestedByUserId: undefined,
    };

    const created = repository.createOrReuseRun(input);
    const fullResult = {
      title: 'Chapter One',
      summary: 'A full in-memory result.',
      people: [{ local_id: 'p1', name: 'Alice' }],
      ideas: [{ local_id: 'i1', label: 'Freedom', kind: 'claim' as const }],
      events: [{ local_id: 'e1', label: 'Speech' }],
      entities: [{ local_id: 'n1', label: 'City Hall', type: 'place' as const }],
      themes: [{ local_id: 't1', label: 'Resistance' }],
      relations: [{
        local_id: 'r1',
        from_id: 'p1',
        from_type: 'person' as const,
        to_id: 'i1',
        to_type: 'idea' as const,
        relation_type: 'supports' as const,
      }],
    };

    repository.completeRun({
      workflowRunId: created.run.id,
      snapshotVersion: 1,
      chapterContentHash: 'hash-1',
      result: fullResult,
    });
    await (repository as never).pendingPersist;

    const run = repository.getRun(created.run.id);
    expect(run?.output?.people).toHaveLength(1);
    expect(repository.getLatestResult('book-1', 'chapter-1')?.result.people).toHaveLength(1);

    const workflowPersist = persisted.find(
      (entry) => entry.table === 'workflow_run'
        && entry.id === created.run.id
        && entry.record.status === 'completed',
    );
    const snapshotPersist = persisted.find((entry) => entry.table === 'chapter_knowledge_snapshot');
    expect(workflowPersist?.record.output).toMatchObject({
      title: 'Chapter One',
      summary: 'A full in-memory result.',
    });
    expect(Object.keys((workflowPersist?.record.output as Record<string, unknown>) ?? {}).sort()).toEqual([
      'summary',
      'title',
    ]);
    expect(snapshotPersist?.record.result).toMatchObject({
      title: 'Chapter One',
      summary: 'A full in-memory result.',
    });
    expect(Object.keys((snapshotPersist?.record.result as Record<string, unknown>) ?? {}).sort()).toEqual([
      'summary',
      'title',
    ]);
  });

  test('truncates oversized persisted summaries while keeping the full result in memory', async () => {
    const persisted: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    const surrealStub = {
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        persisted.push({ table, id, record });
      },
      putRelationRecord: async () => {},
      selectTable: async () => [],
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    const created = repository.createOrReuseRun({
      bookId: 'book-long',
      chapterId: 'chapter-long',
      chapterIndex: 2,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge-extraction:v1:book-long:chapter-long:hash-long',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-long',
      requestedByUserId: undefined,
    });
    const longSummary = 'S'.repeat(50_000);

    repository.completeRun({
      workflowRunId: created.run.id,
      snapshotVersion: 1,
      chapterContentHash: 'hash-long',
      result: {
        title: 'Long Chapter',
        summary: longSummary,
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });
    await (repository as never).pendingPersist;

    expect(repository.getRun(created.run.id)?.output?.summary).toBe(longSummary);

    const workflowPersist = persisted.find(
      (entry) => entry.table === 'workflow_run'
        && entry.id === created.run.id
        && entry.record.status === 'completed',
    );
    const persistedOutput = workflowPersist?.record.output as { summary?: string } | undefined;
    expect(persistedOutput?.summary?.length).toBeLessThan(longSummary.length);
    expect(persistedOutput?.summary).toContain('[truncated]');
  });

  test('persists in-flight progress updates and clears progress on terminal states', async () => {
    const persisted: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    const surrealStub = {
      query: async () => [],
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        persisted.push({ table, id, record });
      },
      putRelationRecord: async () => {},
      selectTable: async () => [],
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    const created = repository.createOrReuseRun({
      bookId: 'book-progress',
      chapterId: 'chapter-progress',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge-extraction:v1:book-progress:chapter-progress:hash-1',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-1',
      requestedByUserId: undefined,
    });

    repository.markRunning(created.run.id);
    repository.updateRunProgress(created.run.id, {
      percent: 42.4,
      stage: 'extract_chunk_knowledge',
      message: 'Extracting knowledge from chunk 2 of 5',
    });
    repository.failRun(created.run.id, 'TEST_FAILURE', 'failure');
    await (repository as never).pendingPersist;

    expect(repository.getRun(created.run.id)?.progress).toBeUndefined();

    const progressPersist = persisted.find(
      (entry) => entry.table === 'workflow_run'
        && entry.id === created.run.id
        && recordProgressPercent(entry.record) === 42,
    );
    const terminalPersist = persisted.find(
      (entry) => entry.table === 'workflow_run'
        && entry.id === created.run.id
        && entry.record.status === 'failed',
    );

    expect(progressPersist?.record.progress).toMatchObject({
      percent: 42,
      stage: 'extract_chunk_knowledge',
      message: 'Extracting knowledge from chunk 2 of 5',
    });
    expect(terminalPersist?.record.progress).toBeUndefined();
  });

  test('keeps oversized page cache records in memory when Surreal returns HTTP 413', async () => {
    const surrealStub = {
      query: async () => [],
      putRecord: async (table: string) => {
        if (table === 'page_knowledge_extraction_cache') {
          throw new Error('SurrealDB write failed with HTTP 413: length limit exceeded');
        }
      },
      putRelationRecord: async () => {},
      selectTable: async () => [],
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);

    repository.setCachedPageExtraction({
      bookId: 'book-cache',
      chapterId: 'chapter-cache',
      pageIndex: 0,
      sourceHash: 'hash-cache',
      chapterContentHash: 'chapter-hash-cache',
      promptVersion: 'knowledge_extraction.v2.10:nonfiction',
      extraction: {
        title: 'Cached Chapter',
        summary: 'Cached page extraction still remains available in memory.',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    await expect((repository as never).pendingPersist).resolves.toBeUndefined();
    expect(repository.getCachedPageExtraction(
      'book-cache',
      'chapter-cache',
      0,
      'hash-cache',
      'chapter-hash-cache',
      'knowledge_extraction.v2.10:nonfiction',
    )?.summary).toBe('Cached page extraction still remains available in memory.');
  });

  test('truncates partial piece evidence prefixes before persisting workflow runs', async () => {
    const persisted: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    const surrealStub = {
      query: async () => [],
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        persisted.push({ table, id, record });
      },
      putRelationRecord: async () => {},
      selectTable: async () => [],
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    const created = repository.createOrReuseRun({
      bookId: 'book-partial',
      chapterId: 'chapter-partial',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge-extraction:v1:book-partial:chapter-partial:hash-1',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-1',
      requestedByUserId: undefined,
    });
    const longQuote = 'Q'.repeat(800);

    repository.upsertPartialPieceResult(created.run.id, {
      pieceIndex: 0,
      pageIndex: 0,
      pageNumber: 1,
      sourceHash: 'piece-hash-1',
      pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      extraction: {
        title: 'Chapter',
        summary: 'Summary',
        nodes: [],
        edges: [],
        evidence: [{
          id: 'ev1',
          owner_kind: 'node',
          owner_id: 'p1',
          quote: longQuote,
          pageIndex: 0,
          pageNumber: 1,
        }],
      },
    });
    await (repository as never).pendingPersist;

    const workflowPersist = persisted.find(
      (entry) => entry.table === 'workflow_run'
        && entry.id === created.run.id
        && Array.isArray(entry.record.partialPieceResults),
    );
    const partials = workflowPersist?.record.partialPieceResults as Array<Record<string, unknown>> | undefined;
    const extraction = partials?.[0]?.extraction as Record<string, unknown> | undefined;
    const evidence = extraction?.evidence as Array<Record<string, unknown>> | undefined;
    const persistedQuote = evidence?.[0]?.quote;

    expect(typeof persistedQuote).toBe('string');
    expect((persistedQuote as string).length).toBeLessThan(longQuote.length);
    expect((persistedQuote as string).length).toBe(280);
  });

  test('retries workflow run persistence without partial piece results after HTTP 413', async () => {
    const persisted: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    let workflowAttemptCount = 0;
    const surrealStub = {
      query: async () => [],
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        if (table === 'workflow_run') {
          workflowAttemptCount += 1;
          persisted.push({ table, id, record });
          if (Array.isArray(record.partialPieceResults) && workflowAttemptCount === 2) {
            throw new Error('SurrealDB write failed with HTTP 413: length limit exceeded');
          }
        }
      },
      putRelationRecord: async () => {},
      selectTable: async () => [],
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    const created = repository.createOrReuseRun({
      bookId: 'book-retry',
      chapterId: 'chapter-retry',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge-extraction:v1:book-retry:chapter-retry:hash-1',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-1',
      requestedByUserId: undefined,
    });

    repository.upsertPartialPieceResult(created.run.id, {
      pieceIndex: 0,
      pageIndex: 0,
      pageNumber: 1,
      sourceHash: 'piece-hash-1',
      pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      extraction: {
        title: 'Chapter',
        summary: 'Summary',
        nodes: [],
        edges: [],
        evidence: [{
          id: 'ev1',
          owner_kind: 'node',
          owner_id: 'p1',
          quote: 'Quoted evidence',
          pageIndex: 0,
          pageNumber: 1,
        }],
      },
    });

    await expect((repository as never).pendingPersist).resolves.toBeUndefined();
    expect(workflowAttemptCount).toBe(3);
    const retryAttempts = persisted.filter(
      (entry) => entry.table === 'workflow_run' && entry.id === created.run.id,
    );
    expect(retryAttempts[0]?.record.partialPieceResults).toBeUndefined();
    expect(retryAttempts[1]?.record.partialPieceResults).toBeDefined();
    expect(retryAttempts[2]?.record.partialPieceResults).toBeUndefined();
  });

  test('loads persisted runs without progress for backward compatibility', async () => {
    const surrealStub = {
      query: async () => [],
      putRecord: async () => {},
      putRelationRecord: async () => {},
      selectTable: async (table: string) => {
        if (table === 'workflow_run') {
          return [{
            id: 'wr_legacy',
            kind: 'knowledge_extraction',
            status: 'completed',
            bookId: 'book-legacy',
            chapterId: 'chapter-legacy',
            chapterIndex: 1,
            workflowVersion: 'v1',
            idempotencyKey: 'knowledge-extraction:v1:book-legacy:chapter-legacy:hash-legacy',
            producer: 'server',
            qualityTier: 'server_final',
            deduped: false,
            resultVersion: 'v1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            completedAt: '2026-01-01T00:01:00.000Z',
            snapshotVersion: 1,
            chapterContentHash: 'hash-legacy',
          }];
        }
        if (table === 'chapter_knowledge_snapshot') {
          return [{
            workflowRunId: 'wr_legacy',
            bookId: 'book-legacy',
            chapterId: 'chapter-legacy',
            chapterIndex: 1,
            workflowVersion: 'v1',
            resultVersion: 'v1',
            producer: 'server',
            qualityTier: 'server_final',
            snapshotVersion: 1,
            chapterContentHash: 'hash-legacy',
            result: {
              title: 'Legacy Chapter',
              summary: 'Legacy summary',
              people: [],
              ideas: [],
              events: [],
              entities: [],
              themes: [],
              relations: [],
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:01:00.000Z',
          }];
        }
        return [];
      },
    };

    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    await repository.onModuleInit();

    const run = repository.getRun('wr_legacy');
    expect(run?.progress).toBeUndefined();
    expect(run?.output?.title).toBe('Legacy Chapter');
    expect(repository.getLatestResult('book-legacy', 'chapter-legacy')?.result.summary).toBe('Legacy summary');
  });

  test('rebuilds full results from graph tables when persisted workflow records are slim', async () => {
    const surrealStub = {
      query: async () => [],
      putRecord: async () => {},
      putRelationRecord: async () => {},
      selectTable: async (table: string) => {
        if (table === 'workflow_run') {
          return [{
            id: 'wr_slim',
            kind: 'knowledge_extraction',
            status: 'completed',
            bookId: 'book-slim',
            chapterId: 'chapter-slim',
            chapterIndex: 1,
            workflowVersion: 'v1',
            idempotencyKey: 'knowledge-extraction:v1:book-slim:chapter-slim:hash-slim',
            producer: 'server',
            qualityTier: 'server_final',
            deduped: false,
            resultVersion: 'v1',
            output: {
              title: 'Slim Chapter',
              summary: 'Slim summary',
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:01:00.000Z',
            completedAt: '2026-01-01T00:01:00.000Z',
            snapshotVersion: 1,
            chapterContentHash: 'hash-slim',
          }];
        }
        if (table === 'chapter_knowledge_snapshot') {
          return [{
            workflowRunId: 'wr_slim',
            bookId: 'book-slim',
            chapterId: 'chapter-slim',
            chapterIndex: 1,
            workflowVersion: 'v1',
            resultVersion: 'v1',
            producer: 'server',
            qualityTier: 'server_final',
            snapshotVersion: 1,
            chapterContentHash: 'hash-slim',
            result: {
              title: 'Slim Chapter',
              summary: 'Slim summary',
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:01:00.000Z',
          }];
        }
        if (table === 'chapter') {
          return [{
            recordId: 'chapter_slim',
            bookId: 'book-slim',
            chapterId: 'chapter-slim',
            chapterIndex: 1,
            title: 'Graph Chapter Title',
          }];
        }
        if (table === 'person') {
          return [{
            recordId: 'person_slim',
            localId: 'person_local',
            name: 'Alice',
            normalizedName: 'alice',
          }];
        }
        if (table === 'knowledge_evidence') {
          return [{
            recordId: 'evidence_slim',
            bookId: 'book-slim',
            chapterId: 'chapter-slim',
            chapterRecordId: 'chapter_slim',
            ownerTable: 'appears_in',
            ownerRecordId: 'appears_slim',
            pageIndex: 0,
            pageNumber: 1,
            quote: 'Alice appears here.',
            quoteHash: 'hash',
            createdAt: '2026-01-01T00:00:00.000Z',
          }];
        }
        if (table === 'appears_in') {
          return [{
            recordId: 'appears_slim',
            in: 'person:person_slim',
            out: 'chapter:chapter_slim',
            chapterRecordId: 'chapter_slim',
            nodeRecordId: 'person_slim',
            nodeType: 'person',
            localId: 'person_local',
            name: 'Alice',
          }];
        }
        return [];
      },
    };

    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    await repository.onModuleInit();

    expect(repository.getRun('wr_slim')?.output).toMatchObject({
      title: 'Slim Chapter',
      summary: 'Slim summary',
      people: [{ local_id: 'person_local', name: 'Alice' }],
    });
    expect(repository.getLatestResult('book-slim', 'chapter-slim')?.result).toMatchObject({
      title: 'Slim Chapter',
      summary: 'Slim summary',
      people: [{ local_id: 'person_local', name: 'Alice' }],
    });
  });

  test('normalizes persisted Surreal record ids after reload', async () => {
    const surrealStub = {
      query: async () => [],
      putRecord: async () => {},
      putRelationRecord: async () => {},
      selectTable: async (table: string) => {
        if (table === 'workflow_run') {
          return [{
            id: 'workflow_run:wr_restart_case',
            kind: 'knowledge_extraction',
            status: 'running',
            bookId: 'book-restart',
            chapterId: 'chapter-restart',
            chapterIndex: 6,
            workflowVersion: 'v1',
            idempotencyKey: 'knowledge-extraction:v1:book-restart:chapter-restart:hash-restart',
            producer: 'server',
            qualityTier: 'server_final',
            deduped: false,
            resultVersion: 'v1',
            progress: {
              percent: 7,
              stage: 'extract_chunk_knowledge',
              message: '正在抽取关键人物与关系',
            },
            createdAt: '2026-05-20T21:18:27.603Z',
            updatedAt: '2026-05-20T21:21:02.770Z',
            startedAt: '2026-05-20T21:18:27.603Z',
          }];
        }
        if (table === 'chapter_knowledge_snapshot') {
          return [{
            workflowRunId: 'workflow_run:wr_restart_case',
            bookId: 'book-restart',
            chapterId: 'chapter-restart',
            chapterIndex: 6,
            workflowVersion: 'v1',
            resultVersion: 'v1',
            producer: 'server',
            qualityTier: 'server_final',
            snapshotVersion: 2,
            chapterContentHash: 'hash-restart',
            result: {
              title: 'Restart Chapter',
              summary: 'Restart summary',
              people: [],
              ideas: [],
              events: [],
              entities: [],
              themes: [],
              relations: [],
            },
            createdAt: '2026-05-20T21:18:27.603Z',
            updatedAt: '2026-05-20T21:21:02.770Z',
          }];
        }
        return [];
      },
    };

    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    await repository.onModuleInit();

    expect(repository.getRun('wr_restart_case')?.id).toBe('wr_restart_case');
    expect(repository.getRun('workflow_run:wr_restart_case')?.id).toBe('wr_restart_case');
  });

  test('persists slim page cache metadata even when the source extraction is large', async () => {
    const persisted: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    const repository = new KnowledgeExtractionWorkflowRepository({
      query: async () => [],
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        persisted.push({ table, id, record });
      },
      putRelationRecord: async () => {},
      selectTable: async () => [],
    } as never);

    repository.setCachedPageExtraction({
      bookId: 'book-cache',
      chapterId: 'chapter-cache',
      pageIndex: 0,
      sourceHash: 'source-hash',
      chapterContentHash: 'chapter-hash',
      promptVersion: 'v1',
      extraction: {
        title: 'Cache Chapter',
        summary: 'X'.repeat(950_000),
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });
    await (repository as never).pendingPersist;

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      table: 'page_knowledge_extraction_cache',
      record: {
        status: 'cached',
        nodeCount: 0,
        edgeCount: 0,
        evidenceCount: 0,
      },
    });
    expect('extraction' in persisted[0].record).toBe(false);
    expect(repository.getCachedPageExtraction(
      'book-cache',
      'chapter-cache',
      0,
      'source-hash',
      'chapter-hash',
      'v1',
    )?.summary).toHaveLength(950_000);
  });

  test('ignores legacy persisted page cache extraction payloads during reload', async () => {
    const persisted = new Map<string, Record<string, unknown>>();
    const surrealStub = {
      query: async () => [],
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        persisted.set(`${table}:${id}`, record);
      },
      putRelationRecord: async () => {},
      selectTable: async (table: string) => {
        if (table === 'page_knowledge_extraction_cache') {
          return Array.from(persisted.entries())
            .filter(([key]) => key.startsWith('page_knowledge_extraction_cache:'))
            .map(([, record]) => record);
        }
        return [];
      },
    };

    const writerRepository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    writerRepository.setCachedPageGraphExtraction({
      bookId: 'book-cache-reload',
      chapterId: 'chapter-cache-reload',
      pageIndex: 0,
      sourceHash: 'source-hash-reload',
      chapterContentHash: 'chapter-hash-reload',
      promptVersion: 'knowledge_extraction.v2.10:nonfiction',
      extraction: {
        title: 'Cache Reload Chapter',
        summary: 'Persisted piece graph.',
        nodes: [{
          id: 'p1',
          type: 'person',
          label: 'Alice',
        }],
        edges: [],
        evidence: [{
          id: 'ev1',
          owner_kind: 'node',
          owner_id: 'p1',
          quote: 'Alice appears first.',
          pageIndex: 0,
          pageNumber: 1,
        }],
      },
    });
    await (writerRepository as never).pendingPersist;

    const readerRepository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    await readerRepository.onModuleInit();

    expect(readerRepository.getCachedPageGraphExtraction(
      'book-cache-reload',
      'chapter-cache-reload',
      0,
      'source-hash-reload',
      'chapter-hash-reload',
      'knowledge_extraction.v2.10:nonfiction',
    )).toBeNull();
  });

  test('stores evidence quotes as a bounded prefix', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();
    const longQuote = 'Q'.repeat(400);

    await repository.replaceChapterExtraction({
      bookId: 'book-evidence-limit',
      chapterId: 'chapter-evidence-limit',
      chapterIndex: 1,
      chapterContentHash: 'hash-evidence-limit',
      extraction: {
        title: 'Evidence Limit',
        summary: '',
        people: [{
          local_id: 'p1',
          name: 'Alice',
          evidence: [{ quote: longQuote, pageIndex: 0, pageNumber: 1 }],
        }],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
      promptVersion: 'v1',
    });

    const snapshot = await repository.buildChapterSnapshot('book-evidence-limit', 'chapter-evidence-limit');

    expect(snapshot.people[0]?.evidence).toEqual([
      { quote: 'Q'.repeat(280), pageIndex: 0, pageNumber: 1 },
    ]);
  });

  test('backfills missing person descriptions from relation text in chapter and global projections', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageExtraction({
      bookId: 'book-person-backfill',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: '',
        people: [
          {
            local_id: 'p1',
            name: 'Bourget',
            importance: 'supporting',
            evidence: [{ quote: 'Bourget is invoked here.', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        ideas: [
          {
            local_id: 'i1',
            label: 'Passion-love',
            kind: 'claim',
            evidence: [{ quote: 'passion-love', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        events: [],
        entities: [],
        themes: [],
        relations: [
          {
            local_id: 'r1',
            from_id: 'i1',
            from_type: 'idea',
            to_id: 'p1',
            to_type: 'person',
            relation_type: 'mentions',
            description: "Bourget's definition of love is presented as satisfactory for passion-love.",
            evidence: [{ quote: 'Bourget defines love', pageIndex: 0, pageNumber: 1 }],
          },
        ],
      },
    });

    const snapshot = await repository.buildChapterSnapshot('book-person-backfill', 'chapter-1');
    const keyInformation = repository.buildBookKeyInformation('book-person-backfill');

    expect(snapshot.people[0]?.description).toBe(
      "Bourget's definition of love is presented as satisfactory for passion-love.",
    );
    expect(keyInformation.people[0]?.description).toBe(
      "Bourget's definition of love is presented as satisfactory for passion-love.",
    );
  });

  test('filters knowledge without evidence from chapter snapshots and book projections', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageGraphExtraction({
      bookId: 'book-evidence-coverage',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        nodes: [
          {
            id: 'p1',
            type: 'person',
            label: 'Alice',
          },
          {
            id: 'i1',
            type: 'idea',
            label: 'Freedom',
            kind: 'claim',
          },
          {
            id: 'e1',
            type: 'event',
            label: 'Speech',
          },
          {
            id: 'n1',
            type: 'entity',
            label: 'City Hall',
            entity_type: 'place',
          },
        ],
        edges: [
          {
            id: 'r1',
            from: 'p1',
            to: 'e1',
            relation_type: 'participates_in',
          },
          {
            id: 'r2',
            from: 'p1',
            to: 'i1',
            relation_type: 'supports',
          },
        ],
        evidence: [
          {
            id: 'ev-p1',
            owner_kind: 'node',
            owner_id: 'p1',
            quote: 'Alice gives the speech.',
            pageIndex: 0,
            pageNumber: 1,
          },
          {
            id: 'ev-e1',
            owner_kind: 'node',
            owner_id: 'e1',
            quote: 'The speech begins here.',
            pageIndex: 0,
            pageNumber: 1,
          },
          {
            id: 'ev-r1',
            owner_kind: 'edge',
            owner_id: 'r1',
            quote: 'Alice gives the speech.',
            pageIndex: 0,
            pageNumber: 1,
          },
          {
            id: 'ev-i1-empty',
            owner_kind: 'node',
            owner_id: 'i1',
            quote: '   ',
            pageIndex: 0,
            pageNumber: 1,
          },
          {
            id: 'ev-n1-missing-page',
            owner_kind: 'node',
            owner_id: 'n1',
            quote: 'at City Hall',
            pageIndex: 0,
            pageNumber: undefined,
          },
          {
            id: 'ev-r2',
            owner_kind: 'edge',
            owner_id: 'r2',
            quote: 'Alice supports freedom.',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      },
    });

    const snapshot = await repository.buildChapterSnapshot('book-evidence-coverage', 'chapter-1');
    const keyInformation = repository.buildBookKeyInformation('book-evidence-coverage');

    expect(snapshot.people).toHaveLength(1);
    expect(snapshot.people[0]?.name).toBe('Alice');
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.label).toBe('Speech');
    expect(snapshot.ideas).toHaveLength(0);
    expect(snapshot.entities).toHaveLength(0);
    expect(snapshot.relations).toHaveLength(1);
    expect(snapshot.relations[0]).toMatchObject({
      relation_type: 'participates_in',
      evidence: [{ quote: 'Alice gives the speech.', pageIndex: 0, pageNumber: 1 }],
    });

    expect(keyInformation.people).toHaveLength(1);
    expect(keyInformation.events).toHaveLength(1);
    expect(keyInformation.ideas).toHaveLength(0);
    expect(keyInformation.entities).toHaveLength(0);
    expect(keyInformation.relations).toHaveLength(1);
    expect(keyInformation.links).toHaveLength(2);
    expect(new Set(keyInformation.links.map((link) => link.globalType))).toEqual(new Set(['event', 'person']));
  });

  test('creates a fresh run when the previous idempotent run failed or went stale', () => {
    const repository = new KnowledgeExtractionWorkflowRepository();
    const input = {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1' as const,
      idempotencyKey: 'knowledge-extraction:v1:book-1:chapter-1:hash-1',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-1',
      requestedByUserId: undefined,
    };

    const first = repository.createOrReuseRun(input);
    expect(first.deduped).toBe(false);

    repository.failRun(first.run.id, 'TEST_FAILURE', 'retryable failure');

    const retried = repository.createOrReuseRun(input);
    expect(retried.deduped).toBe(false);
    expect(retried.run.id).not.toBe(first.run.id);
    expect(retried.run.status).toBe('queued');

    repository.markStale(retried.run.id, 'TEST_STALE', 'stale canonical state');

    const afterStale = repository.createOrReuseRun(input);
    expect(afterStale.deduped).toBe(false);
    expect(afterStale.run.id).not.toBe(retried.run.id);
    expect(afterStale.run.status).toBe('queued');
  });

  test('merges repeated knowledge into a stable chapter snapshot', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        people: [
          {
            local_id: 'p1',
            name: 'Alice',
            aliases: ['Al'],
            importance: 'supporting',
            roles: ['leader'],
            traits: ['brave'],
            evidence: [{ quote: 'Alice begins the speech', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        ideas: [
          {
            local_id: 'i1',
            label: 'Freedom',
            description: 'A core ideal',
            kind: 'claim',
            evidence: [{ quote: 'about freedom', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        events: [
          {
            local_id: 'e1',
            label: 'Speech',
            description: 'Alice speaks publicly',
            participant_local_ids: ['p1'],
            evidence: [{ quote: 'begins the speech', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        entities: [
          {
            local_id: 'n1',
            label: 'City Hall',
            type: 'place',
            evidence: [{ quote: 'at City Hall', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        themes: [
          {
            local_id: 't1',
            label: 'Resistance',
            strength: 0.4,
            evidence: [{ quote: 'freedom', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        relations: [
          {
            local_id: 'r1',
            from_id: 'p1',
            from_type: 'person',
            to_id: 'i1',
            to_type: 'idea',
            relation_type: 'supports',
            confidence: 0.4,
            evidence: [{ quote: 'Alice begins the speech about freedom', pageIndex: 0, pageNumber: 1 }],
          },
        ],
      },
    });

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored again',
        summary: 'ignored again',
        people: [
          {
            local_id: 'p9',
            name: 'alice',
            aliases: ['Alice'],
            importance: 'main',
            roles: [' strategist '],
            traits: ['Brave'],
            evidence: [{ quote: 'Alice continues the speech', pageIndex: 2, pageNumber: 3 }],
          },
        ],
        ideas: [
          {
            local_id: 'i9',
            label: 'freedom',
            description: 'Still central',
            kind: 'claim',
            evidence: [{ quote: 'about freedom', pageIndex: 2, pageNumber: 3 }],
          },
        ],
        events: [
          {
            local_id: 'e9',
            label: 'speech',
            participant_local_ids: ['p9'],
            place_hint: 'City Hall',
            evidence: [{ quote: 'continues the speech', pageIndex: 2, pageNumber: 3 }],
          },
        ],
        entities: [
          {
            local_id: 'n9',
            label: 'city hall',
            type: 'place',
            description: 'Public building',
            evidence: [{ quote: 'City Hall', pageIndex: 2, pageNumber: 3 }],
          },
        ],
        themes: [
          {
            local_id: 't9',
            label: 'resistance',
            strength: 0.8,
            evidence: [{ quote: 'freedom', pageIndex: 2, pageNumber: 3 }],
          },
        ],
        relations: [
          {
            local_id: 'r9',
            from_id: 'p9',
            from_type: 'person',
            to_id: 'i9',
            to_type: 'idea',
            relation_type: 'supports',
            confidence: 0.9,
            evidence: [{ quote: 'Alice continues the speech about freedom', pageIndex: 2, pageNumber: 3 }],
          },
        ],
      },
    });

    const snapshot = await repository.buildChapterSnapshot('book-1', 'chapter-1');
    const keyInformation = repository.buildBookKeyInformation('book-1');
    const personLocalId = snapshot.people[0]?.local_id;
    const ideaLocalId = snapshot.ideas[0]?.local_id;

    expect(snapshot.title).toBe('Chapter One');
    expect(snapshot.summary).toBe('');
    expect(snapshot.people).toHaveLength(1);
    expect(snapshot.ideas).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.entities).toHaveLength(1);
    expect(snapshot.themes).toHaveLength(1);
    expect(snapshot.relations).toHaveLength(1);

    expect(snapshot.people[0]).toMatchObject({
      name: 'Alice',
      aliases: ['Al', 'Alice'],
      importance: 'main',
      roles: ['leader', 'strategist'],
      traits: ['brave'],
      evidence: [
        { quote: 'Alice begins the speech', pageIndex: 0, pageNumber: 1 },
        { quote: 'Alice continues the speech', pageIndex: 2, pageNumber: 3 },
      ],
    });
    expect(snapshot.events[0]).toMatchObject({
      label: 'Speech',
      participant_local_ids: [personLocalId],
      place_hint: 'City Hall',
    });
    expect(snapshot.entities[0]).toMatchObject({
      label: 'City Hall',
      description: 'Public building',
    });
    expect(snapshot.themes[0]).toMatchObject({
      label: 'Resistance',
      strength: 0.8,
    });
    expect(snapshot.relations[0]).toMatchObject({
      from_id: personLocalId,
      to_id: ideaLocalId,
      confidence: 0.9,
      evidence: [
        { quote: 'Alice begins the speech about freedom', pageIndex: 0, pageNumber: 1 },
        { quote: 'Alice continues the speech about freedom', pageIndex: 2, pageNumber: 3 },
      ],
    });
    expect(keyInformation.people[0]).toMatchObject({
      canonicalName: 'Alice',
      importance: 'main',
    });
  });

  test('keeps event identities chapter-scoped', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        people: [],
        ideas: [],
        events: [
          {
            local_id: 'e1',
            label: 'Speech',
            evidence: [{ quote: 'chapter one speech', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        people: [],
        ideas: [],
        events: [
          {
            local_id: 'e1',
            label: 'Speech',
            evidence: [{ quote: 'chapter two speech', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    const firstSnapshot = await repository.buildChapterSnapshot('book-1', 'chapter-1');
    const secondSnapshot = await repository.buildChapterSnapshot('book-1', 'chapter-2');

    expect(firstSnapshot.events).toHaveLength(1);
    expect(secondSnapshot.events).toHaveLength(1);
    expect(firstSnapshot.events[0]?.local_id).not.toBe(secondSnapshot.events[0]?.local_id);
    expect(firstSnapshot.events[0]?.evidence).toEqual([
      { quote: 'chapter one speech', pageIndex: 0, pageNumber: 1 },
    ]);
    expect(secondSnapshot.events[0]?.evidence).toEqual([
      { quote: 'chapter two speech', pageIndex: 0, pageNumber: 1 },
    ]);
  });

  test('merges concept labels that differ only by lightweight function words', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageGraphExtraction({
      bookId: 'book-idea-merge',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        nodes: [
          {
            id: 'i1',
            type: 'idea',
            label: 'Incentives are the cornerstone of modern life',
            kind: 'claim',
          },
        ],
        edges: [],
        evidence: [
          {
            id: 'ev1',
            owner_kind: 'node',
            owner_id: 'i1',
            quote: 'Incentives are the cornerstone of modern life.',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      },
    });

    await repository.upsertPageGraphExtraction({
      bookId: 'book-idea-merge',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        nodes: [
          {
            id: 'i2',
            type: 'idea',
            label: 'Incentives as the cornerstone of modern life',
            kind: 'principle',
          },
        ],
        edges: [],
        evidence: [
          {
            id: 'ev2',
            owner_kind: 'node',
            owner_id: 'i2',
            quote: 'Incentives as the cornerstone of modern life frames the argument.',
            pageIndex: 1,
            pageNumber: 2,
          },
        ],
      },
    });

    const keyInformation = repository.buildBookKeyInformation('book-idea-merge');

    expect(keyInformation.ideas).toHaveLength(1);
    expect(keyInformation.ideas[0]).toMatchObject({
      canonicalLabel: 'Incentives are the cornerstone of modern life',
      mentionedIn: [1, 2],
    });
    expect(keyInformation.ideas[0]?.evidence).toEqual([
      { chapterIndex: 1, chapterId: 'chapter-1', pageIndex: 0, pageNumber: 1, quote: 'Incentives are the cornerstone of modern life.' },
      { chapterIndex: 2, chapterId: 'chapter-2', pageIndex: 1, pageNumber: 2, quote: 'Incentives as the cornerstone of modern life frames the argument.' },
    ]);
  });

  test('merges correlation-causation concept variants across chapters', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageGraphExtraction({
      bookId: 'book-correlation-merge',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        nodes: [
          {
            id: 'i1',
            type: 'idea',
            label: 'Correlation does not imply causation',
            kind: 'principle',
          },
        ],
        edges: [],
        evidence: [
          {
            id: 'ev1',
            owner_kind: 'node',
            owner_id: 'i1',
            quote: 'Correlation does not imply causation.',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      },
    });

    await repository.upsertPageGraphExtraction({
      bookId: 'book-correlation-merge',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        nodes: [
          {
            id: 'i2',
            type: 'idea',
            label: 'Correlation vs. Causation in elections',
            kind: 'principle',
          },
        ],
        edges: [],
        evidence: [
          {
            id: 'ev2',
            owner_kind: 'node',
            owner_id: 'i2',
            quote: 'Election spending shows why correlation is not causation.',
            pageIndex: 1,
            pageNumber: 2,
          },
        ],
      },
    });

    const keyInformation = repository.buildBookKeyInformation('book-correlation-merge');

    expect(keyInformation.ideas).toHaveLength(1);
    expect(keyInformation.ideas[0]).toMatchObject({
      canonicalLabel: 'Correlation does not imply causation',
      mentionedIn: [1, 2],
    });
  });

  test('reuses the same entity record when a later page provides a more specific type', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageGraphExtraction({
      bookId: 'book-entity-merge',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        nodes: [
          {
            id: 'n1',
            type: 'entity',
            label: 'Real-estate agents',
            entity_type: 'other',
          },
        ],
        edges: [],
        evidence: [
          {
            id: 'ev1',
            owner_kind: 'node',
            owner_id: 'n1',
            quote: 'Real-estate agents appear early in the chapter.',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      },
    });

    await repository.upsertPageGraphExtraction({
      bookId: 'book-entity-merge',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        nodes: [
          {
            id: 'n2',
            type: 'entity',
            label: 'Real-estate agents',
            entity_type: 'organization',
          },
        ],
        edges: [],
        evidence: [
          {
            id: 'ev2',
            owner_kind: 'node',
            owner_id: 'n2',
            quote: 'Real-estate agents operate as a structured profession.',
            pageIndex: 1,
            pageNumber: 2,
          },
        ],
      },
    });

    const keyInformation = repository.buildBookKeyInformation('book-entity-merge');

    expect(keyInformation.entities).toHaveLength(1);
    expect(keyInformation.entities[0]).toMatchObject({
      canonicalLabel: 'Real-estate agents',
      type: 'organization',
      mentionedIn: [1, 2],
    });
  });

  test('dedupes repeated page evidence and relation updates', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    const extraction = {
      title: 'ignored',
      summary: 'ignored',
      people: [
        {
          local_id: 'p1',
          name: 'Alice',
          evidence: [{ quote: 'Alice speaks', pageIndex: 0, pageNumber: 1 }],
        },
      ],
      ideas: [
        {
          local_id: 'i1',
          label: 'Freedom',
          kind: 'claim' as const,
          evidence: [{ quote: 'Freedom matters', pageIndex: 0, pageNumber: 1 }],
        },
      ],
      events: [],
      entities: [],
      themes: [],
      relations: [
        {
          local_id: 'r1',
          from_id: 'p1',
          from_type: 'person' as const,
          to_id: 'i1',
          to_type: 'idea' as const,
          relation_type: 'supports' as const,
          confidence: 0.4,
          evidence: [{ quote: 'Alice supports freedom', pageIndex: 0, pageNumber: 1 }],
        },
      ],
    };

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction,
    });
    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        ...extraction,
        relations: [
          {
            ...extraction.relations[0],
            confidence: 0.9,
          },
        ],
      },
    });

    const snapshot = await repository.buildChapterSnapshot('book-1', 'chapter-1');

    expect(snapshot.people[0]?.evidence).toEqual([
      { quote: 'Alice speaks', pageIndex: 0, pageNumber: 1 },
    ]);
    expect(snapshot.relations[0]).toMatchObject({
      confidence: 0.9,
      evidence: [{ quote: 'Alice supports freedom', pageIndex: 0, pageNumber: 1 }],
    });
  });

  test('persists evidence as separate records and keeps graph records slim', async () => {
    const records: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    const relations: Array<{ table: string; id: string; record: Record<string, unknown> }> = [];
    const surrealStub = {
      putRecord: async (table: string, id: string, record: Record<string, unknown>) => {
        records.push({ table, id, record });
      },
      putRelationRecord: async (
        table: string,
        id: string,
        _in: string,
        _out: string,
        record: Record<string, unknown>,
      ) => {
        relations.push({ table, id, record });
      },
      selectTable: async () => [],
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);
    const extraction = {
      title: 'ignored',
      summary: 'ignored',
      people: [
        {
          local_id: 'p1',
          name: 'Alice',
          evidence: [{ quote: 'Alice speaks', pageIndex: 0, pageNumber: 1 }],
        },
      ],
      ideas: [
        {
          local_id: 'i1',
          label: 'Freedom',
          kind: 'claim' as const,
          evidence: [{ quote: 'Freedom matters', pageIndex: 0, pageNumber: 1 }],
        },
      ],
      events: [],
      entities: [],
      themes: [],
      relations: [
        {
          local_id: 'r1',
          from_id: 'p1',
          from_type: 'person' as const,
          to_id: 'i1',
          to_type: 'idea' as const,
          relation_type: 'supports' as const,
          confidence: 0.8,
          evidence: [{ quote: 'Alice supports freedom', pageIndex: 0, pageNumber: 1 }],
        },
      ],
    };

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction,
    });
    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction,
    });

    expect(records.filter((entry) => entry.table === 'knowledge_evidence')).toHaveLength(5);
    expect(records.filter((entry) => entry.table === 'knowledge_evidence').map((entry) => entry.id)).toEqual(
      Array.from(new Set(records.filter((entry) => entry.table === 'knowledge_evidence').map((entry) => entry.id))),
    );
    expect(records.find((entry) => entry.table === 'person')?.record).not.toHaveProperty('evidence');
    expect(records.find((entry) => entry.table === 'concept')?.record).not.toHaveProperty('evidence');
    expect(relations.find((entry) => entry.table === 'appears_in')?.record).not.toHaveProperty('evidence');
    expect(relations.find((entry) => entry.table === 'related_to')?.record).not.toHaveProperty('evidence');
  });

  test('hydrates legacy appearance evidence arrays into split evidence indexes', async () => {
    const legacyChapter = {
      recordId: 'chapter_legacy',
      bookId: 'book-legacy',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      title: 'Legacy Chapter',
    };
    const legacyPerson = {
      recordId: 'person_legacy',
      localId: 'p_legacy',
      name: 'Alice',
      normalizedName: 'alice',
    };
    const legacyAppearance = {
      recordId: 'appears_legacy',
      in: 'person:person_legacy',
      out: 'chapter:chapter_legacy',
      chapterRecordId: 'chapter_legacy',
      nodeRecordId: 'person_legacy',
      nodeType: 'person' as const,
      localId: 'p_legacy',
      name: 'Alice',
      evidence: [{ quote: 'legacy quote', pageIndex: 4, pageNumber: 5 }],
    };
    const legacySnapshot = {
      workflowRunId: 'wr_legacy',
      bookId: 'book-legacy',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
      resultVersion: 'v1',
      producer: 'server' as const,
      qualityTier: 'server_final' as const,
      snapshotVersion: 1,
      chapterContentHash: 'hash',
      result: {
        title: 'Legacy Chapter',
        summary: 'Legacy summary',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const surrealStub = {
      query: async () => [],
      putRecord: async () => {},
      putRelationRecord: async () => {},
      selectTable: async (table: string) => {
        if (table === 'chapter_knowledge_snapshot') return [legacySnapshot];
        if (table === 'chapter') return [legacyChapter];
        if (table === 'person') return [legacyPerson];
        if (table === 'appears_in') return [legacyAppearance];
        return [];
      },
    };
    const repository = new KnowledgeExtractionWorkflowRepository(surrealStub as never);

    await repository.onModuleInit();

    const snapshot = await repository.buildChapterSnapshot('book-legacy', 'chapter-1');
    expect(snapshot.people[0]).toMatchObject({
      name: 'Alice',
      evidence: [{ quote: 'legacy quote', pageIndex: 4, pageNumber: 5 }],
    });
    expect(repository.getLatestResult('book-legacy', 'chapter-1')?.result.people[0]).toMatchObject({
      name: 'Alice',
      evidence: [{ quote: 'legacy quote', pageIndex: 4, pageNumber: 5 }],
    });
  });

  test('builds a book-level key information projection with global links and merged events', async () => {
    const repository = new KnowledgeExtractionWorkflowRepository();

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        people: [
          {
            local_id: 'p1',
            name: 'Alice',
            aliases: ['Al'],
            evidence: [{ quote: 'Alice arrives', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        ideas: [
          {
            local_id: 'i1',
            label: 'Freedom',
            kind: 'claim',
            evidence: [{ quote: 'Freedom matters', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        events: [
          {
            local_id: 'e1',
            label: 'Speech',
            evidence: [{ quote: 'Alice gives a speech', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        entities: [
          {
            local_id: 'place1',
            label: 'City Hall',
            type: 'place',
            evidence: [{ quote: 'at City Hall', pageIndex: 0, pageNumber: 1 }],
          },
          {
            local_id: 'time1',
            label: 'Dawn',
            type: 'time',
            evidence: [{ quote: 'at dawn', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        themes: [
          {
            local_id: 't1',
            label: 'Resistance',
            strength: 0.3,
            evidence: [{ quote: 'resistance', pageIndex: 0, pageNumber: 1 }],
          },
        ],
        relations: [
          {
            local_id: 'r1',
            from_id: 'p1',
            from_type: 'person',
            to_id: 'e1',
            to_type: 'event',
            relation_type: 'participates_in',
            confidence: 0.6,
            evidence: [{ quote: 'Alice gives a speech', pageIndex: 0, pageNumber: 1 }],
          },
          {
            local_id: 'r2',
            from_id: 'e1',
            from_type: 'event',
            to_id: 'place1',
            to_type: 'entity',
            relation_type: 'located_in',
            confidence: 0.7,
            evidence: [{ quote: 'speech at City Hall', pageIndex: 0, pageNumber: 1 }],
          },
          {
            local_id: 'r3',
            from_id: 'e1',
            from_type: 'event',
            to_id: 'time1',
            to_type: 'entity',
            relation_type: 'happens_at',
            confidence: 0.7,
            evidence: [{ quote: 'speech at dawn', pageIndex: 0, pageNumber: 1 }],
          },
        ],
      },
    });

    await repository.upsertPageExtraction({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      extraction: {
        title: 'ignored',
        summary: 'ignored',
        people: [
          {
            local_id: 'p2',
            name: 'alice',
            evidence: [{ quote: 'Alice returns', pageIndex: 1, pageNumber: 2 }],
          },
        ],
        ideas: [
          {
            local_id: 'i2',
            label: 'freedom',
            kind: 'claim',
            evidence: [{ quote: 'Freedom returns', pageIndex: 1, pageNumber: 2 }],
          },
        ],
        events: [
          {
            local_id: 'e2',
            label: 'speech',
            evidence: [{ quote: 'another speech', pageIndex: 1, pageNumber: 2 }],
          },
        ],
        entities: [],
        themes: [
          {
            local_id: 't2',
            label: 'resistance',
            strength: 0.9,
            evidence: [{ quote: 'resistance grows', pageIndex: 1, pageNumber: 2 }],
          },
        ],
        relations: [
          {
            local_id: 'r4',
            from_id: 'p2',
            from_type: 'person',
            to_id: 'i2',
            to_type: 'idea',
            relation_type: 'supports',
            confidence: 0.8,
            evidence: [{ quote: 'Alice supports freedom', pageIndex: 1, pageNumber: 2 }],
          },
          {
            local_id: 'r5',
            from_id: 'p2',
            from_type: 'person',
            to_id: 'e2',
            to_type: 'event',
            relation_type: 'participates_in',
            confidence: 0.9,
            evidence: [{ quote: 'Alice joins another speech', pageIndex: 1, pageNumber: 2 }],
          },
        ],
      },
    });

    const keyInformation = repository.buildBookKeyInformation('book-1');

    expect(keyInformation.people).toHaveLength(1);
    expect(keyInformation.ideas).toHaveLength(1);
    expect(keyInformation.events).toHaveLength(1);
    expect(keyInformation.entities).toHaveLength(2);
    expect(keyInformation.themes).toHaveLength(1);

    expect(keyInformation.people[0]).toMatchObject({
      canonicalName: 'Alice',
      aliases: ['Al'],
      mentionedIn: [1, 2],
      evidence: [
        { chapterIndex: 1, chapterId: 'chapter-1', pageIndex: 0, pageNumber: 1, quote: 'Alice arrives' },
        { chapterIndex: 2, chapterId: 'chapter-2', pageIndex: 1, pageNumber: 2, quote: 'Alice returns' },
      ],
    });

    const globalEvent = keyInformation.events[0];
    expect(globalEvent).toMatchObject({
      canonicalLabel: 'Speech',
      occurredInChapter: 1,
      mentionedIn: [1, 2],
      participantIds: [keyInformation.people[0]?.personId],
    });
    expect(globalEvent.placeEntityId).toBe(
      keyInformation.entities.find((entity) => entity.type === 'place')?.entityId,
    );
    expect(globalEvent.timeEntityId).toBe(
      keyInformation.entities.find((entity) => entity.type === 'time')?.entityId,
    );

    expect(keyInformation.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromId: keyInformation.people[0]?.personId,
          toId: keyInformation.ideas[0]?.ideaId,
          relationType: 'supports',
          mentionedIn: [2],
        }),
        expect.objectContaining({
          fromId: keyInformation.people[0]?.personId,
          toId: globalEvent.eventId,
          relationType: 'participates_in',
          mentionedIn: [1, 2],
        }),
      ]),
    );

    expect(keyInformation.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chapterId: 'chapter-1',
          chapterIndex: 1,
          globalId: keyInformation.people[0]?.personId,
          globalType: 'person',
        }),
        expect.objectContaining({
          chapterId: 'chapter-2',
          chapterIndex: 2,
          globalId: globalEvent.eventId,
          globalType: 'event',
        }),
      ]),
    );
  });
});
