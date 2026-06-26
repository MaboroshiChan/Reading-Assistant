import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookContextService } from '../src/modules/book-ingestion/book-context.service';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service';
import { QuizWorkflowRepository } from '../src/modules/quiz-workflow/quiz-workflow.repository';
import { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';
import * as llmService from '../services/llmService';
import type {
  AnalyzeKnowledgeExtractionData,
  AnalyzeKnowledgeExtractionGraphData,
} from '../../packages/contracts/src';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-workflow-'));
  return new BookIngestionRepository(dataDir);
};

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const toGraphExtraction = (
  extraction: AnalyzeKnowledgeExtractionData,
): AnalyzeKnowledgeExtractionGraphData => {
  const evidence: AnalyzeKnowledgeExtractionGraphData['evidence'] = [];
  const pushEvidence = (
    ownerKind: 'node' | 'edge',
    ownerId: string,
    items: AnalyzeKnowledgeExtractionData['people'][number]['evidence'],
  ) => {
    for (const [index, item] of (items ?? []).entries()) {
      evidence.push({
        id: `ev_${ownerKind}_${ownerId}_${index}_${item.pageIndex ?? -1}_${item.pageNumber ?? -1}`,
        owner_kind: ownerKind,
        owner_id: ownerId,
        quote: item.quote,
        pageIndex: item.pageIndex,
        pageNumber: item.pageNumber,
      });
    }
  };

  return {
    title: extraction.title,
    summary: extraction.summary,
    nodes: [
      ...extraction.people.map((person) => {
        pushEvidence('node', person.local_id, person.evidence);
        return {
          id: person.local_id,
          type: 'person' as const,
          label: person.name,
          aliases: person.aliases,
          importance: person.importance,
          description: person.description,
          roles: person.roles,
          traits: person.traits,
        };
      }),
      ...extraction.ideas.map((idea) => {
        pushEvidence('node', idea.local_id, idea.evidence);
        return {
          id: idea.local_id,
          type: 'idea' as const,
          label: idea.label,
          kind: idea.kind,
          description: idea.description,
        };
      }),
      ...extraction.events.map((event) => {
        pushEvidence('node', event.local_id, event.evidence);
        return {
          id: event.local_id,
          type: 'event' as const,
          label: event.label,
          description: event.description,
          participant_ids: event.participant_local_ids,
          time_hint: event.time_hint,
          place_hint: event.place_hint,
        };
      }),
      ...extraction.entities.map((entity) => {
        pushEvidence('node', entity.local_id, entity.evidence);
        return {
          id: entity.local_id,
          type: 'entity' as const,
          label: entity.label,
          entity_type: entity.type,
          description: entity.description,
        };
      }),
      ...extraction.themes.map((theme) => {
        pushEvidence('node', theme.local_id, theme.evidence);
        return {
          id: theme.local_id,
          type: 'theme' as const,
          label: theme.label,
          strength: theme.strength,
          description: theme.description,
        };
      }),
    ],
    edges: extraction.relations.map((relation) => {
      pushEvidence('edge', relation.local_id, relation.evidence);
      return {
        id: relation.local_id,
        from: relation.from_id,
        to: relation.to_id,
        relation_type: relation.relation_type,
        description: relation.description,
        confidence: relation.confidence,
      };
    }),
    evidence,
  };
};

describe('KnowledgeExtractionWorkflowService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE;
    delete process.env.KNOWLEDGE_EXTRACTION_WORKFLOW_TIMEOUT_MS;
    delete process.env.AUTO_SUBMIT_QUIZ_WORKFLOW;
  });

  test('processes pages in pageIndex order and merges repeated knowledge across pages', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 2,
      sourceHash: 'hash-page-2',
      pageParagraphs: {
        '0': 'Alice continues the speech about freedom at City Hall.',
      },
      bookMetadata: { isFiction: true },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'Alice begins the speech about freedom at City Hall.',
      },
    });

    const seenPageIndexes: number[] = [];
    const pageCacheSpy = vi.spyOn(workflowRepository, 'setCachedPageGraphExtraction');
    const replaceSpy = vi.spyOn(workflowRepository, 'replaceChapterExtraction');
    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: {
        piece: { pageIndex: number };
      }) => {
        seenPageIndexes.push(input.piece.pageIndex);

        if (input.piece.pageIndex === 0) {
          return toGraphExtraction({
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
          });
        }

        return toGraphExtraction({
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
        });
      },
    );

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    expect(seenPageIndexes).toEqual([0, 2]);
    expect(pageCacheSpy).toHaveBeenCalledTimes(2);
    expect(pageCacheSpy).toHaveBeenCalledWith(expect.objectContaining({
      promptVersion: 'knowledge_extraction.v2.9:fiction',
    }));
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    const result = service.getWorkflowResult(submit.workflowRunId).result;
    const latest = service.getLatestChapterKnowledgeExtraction('book-1', 'chapter-1').result;
    const keyInformation = workflowRepository.buildBookKeyInformation('book-1');
    const personLocalId = result.people[0]?.local_id;
    const ideaLocalId = result.ideas[0]?.local_id;
    const eventLocalId = result.events[0]?.local_id;
    const entityLocalId = result.entities[0]?.local_id;
    const themeLocalId = result.themes[0]?.local_id;
    const expectedEvidence = [
      expect.objectContaining({ pageIndex: 0, pageNumber: 1 }),
      expect.objectContaining({ pageIndex: 2, pageNumber: 3 }),
    ];

    expect(result.title).toBe('Chapter One');
    expect(result.people).toHaveLength(1);
    expect(result.ideas).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.entities).toHaveLength(1);
    expect(result.themes).toHaveLength(1);
    expect(result.relations).toHaveLength(1);

    expect(result.people[0]).toMatchObject({
      name: 'Alice',
      aliases: ['Al', 'Alice'],
      importance: 'main',
      roles: ['leader', 'strategist'],
      traits: ['brave'],
      evidence: expectedEvidence,
    });
    expect(result.ideas[0]).toMatchObject({
      label: 'Freedom',
      evidence: expectedEvidence,
    });
    expect(result.events[0]).toMatchObject({
      label: 'Speech',
      participant_local_ids: [personLocalId],
      evidence: expectedEvidence,
    });
    expect(result.entities[0]).toMatchObject({
      label: 'City Hall',
      evidence: expectedEvidence,
    });
    expect(result.themes[0]).toMatchObject({
      label: 'Resistance',
      strength: 0.8,
      evidence: expectedEvidence,
    });
    expect(result.relations[0]).toMatchObject({
      from_id: personLocalId,
      from_type: 'person',
      to_id: ideaLocalId,
      to_type: 'idea',
      relation_type: 'supports',
      confidence: 0.9,
      evidence: expectedEvidence,
    });
    expect(personLocalId).toMatch(/^p_/);
    expect(ideaLocalId).toMatch(/^i_/);
    expect(eventLocalId).toMatch(/^e_/);
    expect(entityLocalId).toMatch(/^n_/);
    expect(themeLocalId).toMatch(/^t_/);
    expect(latest.people[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pageIndex: 0, pageNumber: 1 }),
        expect.objectContaining({ pageIndex: 2, pageNumber: 3 })
      ])
    );
    expect(latest.people[0]?.importance).toBe('main');
    expect(keyInformation.people[0]).toMatchObject({
      canonicalName: 'Alice',
      importance: 'main',
    });
    expect(service.getWorkflowStatus(submit.workflowRunId).progress).toBeUndefined();
  });

  test('builds pieces from consecutive pages in pairs', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-build-pieces',
      chapterId: 'chapter-build-pieces',
      chapterIndex: 1,
      chapterTitle: 'Chunking',
      pageIndex: 0,
      sourceHash: 'hash-0',
      pageParagraphs: { '0': 'Page zero.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-build-pieces',
      chapterId: 'chapter-build-pieces',
      chapterIndex: 1,
      chapterTitle: 'Chunking',
      pageIndex: 1,
      sourceHash: 'hash-1',
      pageParagraphs: { '0': 'Page one.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-build-pieces',
      chapterId: 'chapter-build-pieces',
      chapterIndex: 1,
      chapterTitle: 'Chunking',
      pageIndex: 3,
      sourceHash: 'hash-3',
      pageParagraphs: { '0': 'Page three.' },
    });

    const chapter = bookRepository.getChapter('book-build-pieces', 'chapter-build-pieces');
    expect(chapter).toBeTruthy();

    const pieces = (service as never).buildPieces(chapter);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({
      pageIndex: 0,
      pageNumber: 1,
      pieceIndex: 0,
      totalPieces: 2,
      pageRefs: [
        { pageIndex: 0, pageNumber: 1 },
        { pageIndex: 1, pageNumber: 2 },
      ],
    });
    expect(pieces[0].rawText).toContain('Page zero.');
    expect(pieces[0].rawText).toContain('Page one.');
    expect(pieces[1]).toMatchObject({
      pageIndex: 3,
      pageNumber: 4,
      pieceIndex: 1,
      totalPieces: 2,
      pageRefs: [{ pageIndex: 3, pageNumber: 4 }],
    });
  });

  test('returns queued progress for a newly submitted workflow before execution starts', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    vi.spyOn(queueService, 'enqueue').mockImplementation(() => undefined);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-queued-progress',
      chapterId: 'chapter-queued-progress',
      chapterIndex: 1,
      chapterTitle: 'Queued Progress',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'Alice waits in the queue.',
      },
    });

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-queued-progress',
      chapterId: 'chapter-queued-progress',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    expect(submit.status).toBe('queued');
    expect(service.getWorkflowStatus(submit.workflowRunId)).toMatchObject({
      status: 'queued',
      progress: {
        percent: 0,
        stage: 'queued',
        message: '正在排队',
      },
    });
  });

  test('publishes running progress while processing pieces and omits it after completion', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-progress',
      chapterId: 'chapter-progress',
      chapterIndex: 1,
      chapterTitle: 'Progress Chapter',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'Alice appears on the first page.',
      },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-progress',
      chapterId: 'chapter-progress',
      chapterIndex: 1,
      chapterTitle: 'Progress Chapter',
      pageIndex: 2,
      sourceHash: 'hash-page-2',
      pageParagraphs: {
        '0': 'Bob appears on the third page.',
      },
    });

    const firstPieceStarted = createDeferred<void>();
    const releaseFirstPiece = createDeferred<void>();
    const secondPieceStarted = createDeferred<void>();
    const releaseSecondPiece = createDeferred<void>();

    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: { piece: { pageIndex: number; pageNumber: number } }) => {
        if (input.piece.pageIndex === 0) {
          firstPieceStarted.resolve();
          await releaseFirstPiece.promise;
        } else {
          secondPieceStarted.resolve();
          await releaseSecondPiece.promise;
        }

        return toGraphExtraction({
          title: 'ignored',
          summary: 'ignored',
          people: [
            {
              local_id: `p${input.piece.pageIndex + 1}`,
              name: input.piece.pageIndex === 0 ? 'Alice' : 'Bob',
              evidence: [{
                quote: input.piece.pageIndex === 0 ? 'Alice appears' : 'Bob appears',
                pageIndex: input.piece.pageIndex,
                pageNumber: input.piece.pageNumber,
              }],
            },
          ],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        });
      },
    );

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-progress',
      chapterId: 'chapter-progress',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await firstPieceStarted.promise;
    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId)).toMatchObject({
        status: 'running',
        progress: {
          percent: 5,
          stage: 'extract_chunk_knowledge',
          message: '正在抽取关键人物与关系',
        },
      });
    });

    releaseFirstPiece.resolve();
    await secondPieceStarted.promise;
    await vi.waitFor(() => {
      const status = service.getWorkflowStatus(submit.workflowRunId);
      expect(status.status).toBe('running');
      expect(status.progress).toMatchObject({
        percent: 50,
        stage: 'extract_chunk_knowledge',
        message: '正在抽取关键人物与关系',
      });
    });

    releaseSecondPiece.resolve();
    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });
    expect(service.getWorkflowStatus(submit.workflowRunId).progress).toBeUndefined();
  });

  test('rejects workflow submission when canonical chapter text is empty', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-2',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'non-empty paragraph',
      },
    });

    const chapter = bookRepository.getChapter('book-2', 'chapter-2');
    if (!chapter) {
      throw new Error('expected canonical chapter to exist');
    }
    chapter.chapterTextMaterialized = '';

    expect(() => service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-2',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      workflowVersion: 'v1',
    })).toThrowError(ConflictException);
  });

  test('re-enqueues queued and running runs during application bootstrap', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    const enqueueSpy = vi.spyOn(queueService, 'enqueue').mockImplementation(() => undefined);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    const queuedRun = workflowRepository.createOrReuseRun({
      bookId: 'book-queued',
      chapterId: 'chapter-queued',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge:v1:book-queued:chapter-queued:hash-queued',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-queued',
      requestedByUserId: undefined,
    }).run;
    const runningRun = workflowRepository.createOrReuseRun({
      bookId: 'book-running',
      chapterId: 'chapter-running',
      chapterIndex: 2,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge:v1:book-running:chapter-running:hash-running',
      expectedSnapshotVersion: 2,
      expectedChapterContentHash: 'hash-running',
      requestedByUserId: undefined,
    }).run;
    const completedRun = workflowRepository.createOrReuseRun({
      bookId: 'book-completed',
      chapterId: 'chapter-completed',
      chapterIndex: 3,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge:v1:book-completed:chapter-completed:hash-completed',
      expectedSnapshotVersion: 3,
      expectedChapterContentHash: 'hash-completed',
      requestedByUserId: undefined,
    }).run;
    workflowRepository.markRunning(runningRun.id);
    workflowRepository.completeRun({
      workflowRunId: completedRun.id,
      snapshotVersion: 3,
      chapterContentHash: 'hash-completed',
      result: {
        title: 'Completed',
        summary: '',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    service.onApplicationBootstrap();

    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    expect(workflowRepository.listRecoverableRuns().map((run) => run.id)).toEqual([
      queuedRun.id,
      runningRun.id,
    ]);
  });

  test('reuses the latest completed result when canonical chapter content is unchanged', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-3',
      chapterId: 'chapter-3',
      chapterIndex: 3,
      chapterTitle: 'Chapter Three',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'Alice explains freedom in a single page chapter.',
      },
    });

    const generateSpy = vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockResolvedValue(toGraphExtraction({
      title: 'ignored',
      summary: 'ignored',
      people: [
        {
          local_id: 'p1',
          name: 'Alice',
          evidence: [{ quote: 'Alice explains freedom', pageIndex: 0, pageNumber: 1 }],
        },
      ],
      ideas: [
        {
          local_id: 'i1',
          label: 'Freedom',
          kind: 'claim',
          evidence: [{ quote: 'freedom', pageIndex: 0, pageNumber: 1 }],
        },
      ],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    }));

    const firstSubmit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-3',
      chapterId: 'chapter-3',
      chapterIndex: 3,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(firstSubmit.workflowRunId).status).toBe('completed');
    });

    expect(generateSpy).toHaveBeenCalledTimes(1);

    const secondSubmit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-3',
      chapterId: 'chapter-3',
      chapterIndex: 3,
      workflowVersion: 'v1',
    });

    expect(secondSubmit.deduped).toBe(true);
    expect(secondSubmit.status).toBe('completed');
    expect(secondSubmit.workflowRunId).toBe(firstSubmit.workflowRunId);
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  test('does not leak partial chapter knowledge into the shared snapshot when a run fails mid-stream', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-fail-1',
      chapterId: 'chapter-fail-1',
      chapterIndex: 1,
      chapterTitle: 'Failure Chapter',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'Alice appears on the first page.',
      },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-fail-1',
      chapterId: 'chapter-fail-1',
      chapterIndex: 1,
      chapterTitle: 'Failure Chapter',
      pageIndex: 2,
      sourceHash: 'hash-page-2',
      pageParagraphs: {
        '0': 'The third page will fail.',
      },
    });

    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: { piece: { pageIndex: number } }) => {
        if (input.piece.pageIndex === 0) {
          return toGraphExtraction({
            title: 'ignored',
            summary: 'ignored',
            people: [
              {
                local_id: 'p1',
                name: 'Alice',
                evidence: [{ quote: 'Alice appears', pageIndex: 0, pageNumber: 1 }],
              },
            ],
            ideas: [],
            events: [],
            entities: [],
            themes: [],
            relations: [],
          });
        }
        throw new Error('synthetic extraction failure');
      },
    );

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-fail-1',
      chapterId: 'chapter-fail-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('failed');
    });
    expect(service.getWorkflowStatus(submit.workflowRunId).progress).toBeUndefined();

    expect(workflowRepository.getLatestResult('book-fail-1', 'chapter-fail-1')).toBeNull();
    expect(() => service.getWorkflowResult(submit.workflowRunId)).toThrowError(ConflictException);

    const snapshot = await workflowRepository.buildChapterSnapshot('book-fail-1', 'chapter-fail-1');
    expect(snapshot.people).toEqual([]);
    expect(snapshot.ideas).toEqual([]);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.themes).toEqual([]);
    expect(snapshot.relations).toEqual([]);
  });

  test('fails fast when cache is required and no completed result matches the chapter state', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '1';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-4',
      chapterId: 'chapter-4',
      chapterIndex: 4,
      chapterTitle: 'Chapter Four',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'This chapter has no cached extraction yet.',
      },
    });

    const generateSpy = vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece');

    expect(() => service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-4',
      chapterId: 'chapter-4',
      chapterIndex: 4,
      workflowVersion: 'v1',
    })).toThrowError(ConflictException);

    expect(generateSpy).not.toHaveBeenCalled();
  });

  test('builds page-aware prompt context and reuses page cache for identical source hashes', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-5',
      chapterId: 'chapter-5',
      chapterIndex: 5,
      chapterTitle: 'Chapter Five',
      pageIndex: 0,
      sourceHash: 'hash-0',
      pageParagraphs: { '0': 'Previous page text.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-5',
      chapterId: 'chapter-5',
      chapterIndex: 5,
      chapterTitle: 'Chapter Five',
      pageIndex: 1,
      sourceHash: 'hash-1',
      pageParagraphs: { '0': 'Current page text about Alice.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-5',
      chapterId: 'chapter-5',
      chapterIndex: 5,
      chapterTitle: 'Chapter Five',
      pageIndex: 2,
      sourceHash: 'hash-2',
      pageParagraphs: { '0': 'Next page text.' },
    });

    const prompts: string[] = [];
    const createLLMClientSpy = vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async (userPrompt: string) => {
        prompts.push(userPrompt);
        const json = JSON.stringify(toGraphExtraction({
          title: 'Chapter Five',
          summary: 'Alice appears on the current page.',
          people: [
            {
              local_id: 'p1',
              name: 'Alice',
              evidence: [{ quote: 'Alice' }],
            },
          ],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        }));
        return {
          data: (async function* () {
            yield json;
          })(),
          usage: Promise.resolve({}),
        };
      }),
    } as never);

    const first = await (service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-5',
      chapterId: 'chapter-5',
      chapterIndex: 5,
      chapterTitle: 'Chapter Five',
      chapterText: 'Previous page text.\n\nCurrent page text about Alice.\n\nNext page text.',
      chapterContentHash: 'chapter-hash-5',
      piece: {
        pageIndex: 1,
        pageNumber: 2,
        rawText: 'Current page text about Alice.',
        sourceHash: 'hash-1',
        pieceIndex: 1,
        totalPieces: 3,
        pageRefs: [{ pageIndex: 1, pageNumber: 2 }],
      },
      bookContext: bookContextService.buildBookContextBundle('book-5', 'chapter-5'),
      chapterContext: bookContextService.buildChapterContextBundle('book-5', 'chapter-5'),
      pageWindow: bookContextService.buildPageWindowContext('book-5', 'chapter-5', 1),
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });
    workflowRepository.setCachedPageExtraction({
      bookId: 'book-5',
      chapterId: 'chapter-5',
      pageIndex: 1,
      sourceHash: 'hash-1',
      chapterContentHash: 'chapter-hash-5',
      promptVersion: 'knowledge_extraction.v2.9:nonfiction',
      extraction: first,
    });
    const second = await (service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-5',
      chapterId: 'chapter-5',
      chapterIndex: 5,
      chapterTitle: 'Chapter Five',
      chapterText: 'Previous page text.\n\nCurrent page text about Alice.\n\nNext page text.',
      chapterContentHash: 'chapter-hash-5',
      piece: {
        pageIndex: 1,
        pageNumber: 2,
        rawText: 'Current page text about Alice.',
        sourceHash: 'hash-1',
        pieceIndex: 1,
        totalPieces: 3,
        pageRefs: [{ pageIndex: 1, pageNumber: 2 }],
      },
      bookContext: bookContextService.buildBookContextBundle('book-5', 'chapter-5'),
      chapterContext: bookContextService.buildChapterContextBundle('book-5', 'chapter-5'),
      pageWindow: bookContextService.buildPageWindowContext('book-5', 'chapter-5', 1),
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(second).toEqual(first);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Book context:');
    expect(prompts[0]).toContain('Current chapter context:');
    expect(prompts[0]).toContain('Page window:');
    expect(prompts[0]).toContain('Memory continuity:');
    expect(prompts[0]).toContain('Use the primary evidence pages as the only source of evidence quotes.');
    expect(prompts[0]).toContain('Every evidence item must include quote, pageIndex, and pageNumber');
    expect(createLLMClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash-lite',
      timeoutMs: 3600000,
      prefixCache: expect.objectContaining({
        cacheKey: 'chapter_context.v1:book-5:chapter-5:chapter-hash-5',
        systemPromptMode: 'request',
      }),
    }));
  });

  test('uses the fiction prompt when iOS uploads isFiction as a string metadata value', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-ios-fiction',
      chapterId: 'chapter-ios-fiction',
      chapterIndex: 1,
      chapterTitle: 'Fiction Chapter',
      pageIndex: 0,
      sourceHash: 'hash-ios-fiction',
      pageParagraphs: { '0': 'Alice stepped into the moonlit room.' },
      bookMetadata: { title: 'Fiction Book', isFiction: 'true' },
    });

    const createLLMClientSpy = vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async () => {
        const json = JSON.stringify(toGraphExtraction({
          title: 'Fiction Chapter',
          summary: 'Alice enters a room.',
          people: [],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        }));
        return {
          data: (async function* () {
            yield json;
          })(),
          usage: Promise.resolve({}),
        };
      }),
    } as never);

    await (service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-ios-fiction',
      chapterId: 'chapter-ios-fiction',
      chapterIndex: 1,
      chapterTitle: 'Fiction Chapter',
      chapterText: 'Alice stepped into the moonlit room.',
      chapterContentHash: 'chapter-hash-ios-fiction',
      piece: {
        pageIndex: 0,
        pageNumber: 1,
        rawText: 'Alice stepped into the moonlit room.',
        sourceHash: 'hash-ios-fiction',
        pieceIndex: 0,
        totalPieces: 1,
        pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      },
      bookContext: bookContextService.buildBookContextBundle('book-ios-fiction', 'chapter-ios-fiction'),
      chapterContext: bookContextService.buildChapterContextBundle('book-ios-fiction', 'chapter-ios-fiction'),
      pageWindow: bookContextService.buildPageWindowContext('book-ios-fiction', 'chapter-ios-fiction', 0),
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(createLLMClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining('Fiction Knowledge Extraction Prompt'),
    }));
  });

  test('does not reuse page cache when the chapter content hash changes', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-6',
      chapterId: 'chapter-6',
      chapterIndex: 6,
      chapterTitle: 'Chapter Six',
      pageIndex: 1,
      sourceHash: 'hash-1',
      pageParagraphs: { '0': 'Current page text about Alice.' },
    });

    const prompts: string[] = [];
    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async (userPrompt: string) => {
        prompts.push(userPrompt);
        const json = JSON.stringify(toGraphExtraction({
          title: 'Chapter Six',
          summary: 'Alice appears on the current page.',
          people: [],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        }));
        return {
          data: (async function* () {
            yield json;
          })(),
          usage: Promise.resolve({}),
        };
      }),
    } as never);

    workflowRepository.setCachedPageExtraction({
      bookId: 'book-6',
      chapterId: 'chapter-6',
      pageIndex: 1,
      sourceHash: 'hash-1',
      chapterContentHash: 'chapter-hash-old',
      promptVersion: 'knowledge_extraction.v2.9:nonfiction',
      extraction: {
        title: 'Stale',
        summary: 'stale',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    await (service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-6',
      chapterId: 'chapter-6',
      chapterIndex: 6,
      chapterTitle: 'Chapter Six',
      chapterText: 'Current page text about Alice.',
      chapterContentHash: 'chapter-hash-new',
      piece: {
        pageIndex: 1,
        pageNumber: 2,
        rawText: 'Current page text about Alice.',
        sourceHash: 'hash-1',
        pieceIndex: 0,
        totalPieces: 1,
        pageRefs: [{ pageIndex: 1, pageNumber: 2 }],
      },
      bookContext: bookContextService.buildBookContextBundle('book-6', 'chapter-6'),
      chapterContext: bookContextService.buildChapterContextBundle('book-6', 'chapter-6'),
      pageWindow: {
        previous: undefined,
        current: { pageIndex: 1, sourceHash: 'hash-1', text: 'Current page text about Alice.' },
        next: undefined,
      },
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(prompts).toHaveLength(1);
  });

  test('does not reuse nonfiction page cache for a fiction book', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-fiction-cache',
      chapterId: 'chapter-fiction-cache',
      chapterIndex: 1,
      chapterTitle: 'Fiction Cache',
      pageIndex: 0,
      sourceHash: 'same-source-hash',
      pageParagraphs: { '0': 'Alice finds a letter.' },
      bookMetadata: { isFiction: true },
    });

    workflowRepository.setCachedPageExtraction({
      bookId: 'book-fiction-cache',
      chapterId: 'chapter-fiction-cache',
      pageIndex: 0,
      sourceHash: 'same-source-hash',
      chapterContentHash: 'same-chapter-hash',
      promptVersion: 'knowledge_extraction.v2.9:nonfiction',
      extraction: {
        title: 'Stale nonfiction cache',
        summary: 'stale',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    const prompts: string[] = [];
    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async (userPrompt: string) => {
        prompts.push(userPrompt);
        const json = JSON.stringify(toGraphExtraction({
          title: 'Fiction Cache',
          summary: 'Alice finds a letter.',
          people: [],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        }));
        return {
          data: (async function* () {
            yield json;
          })(),
          usage: Promise.resolve({}),
        };
      }),
    } as never);

    const result = await (service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-fiction-cache',
      chapterId: 'chapter-fiction-cache',
      chapterIndex: 1,
      chapterTitle: 'Fiction Cache',
      chapterText: 'Alice finds a letter.',
      chapterContentHash: 'same-chapter-hash',
      piece: {
        pageIndex: 0,
        pageNumber: 1,
        rawText: 'Alice finds a letter.',
        sourceHash: 'same-source-hash',
        pieceIndex: 0,
        totalPieces: 1,
        pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      },
      bookContext: bookContextService.buildBookContextBundle('book-fiction-cache', 'chapter-fiction-cache'),
      chapterContext: bookContextService.buildChapterContextBundle('book-fiction-cache', 'chapter-fiction-cache'),
      pageWindow: bookContextService.buildPageWindowContext('book-fiction-cache', 'chapter-fiction-cache', 0),
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(result.title).toBe('Fiction Cache');
    expect(prompts).toHaveLength(1);
  });

  test('retries transient 503 errors for a piece and eventually succeeds', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-retry-503',
      chapterId: 'chapter-retry-503',
      chapterIndex: 7,
      chapterTitle: 'Retry Chapter',
      pageIndex: 1,
      sourceHash: 'retry-hash-1',
      pageParagraphs: { '0': 'Alice returns to the square.' },
    });

    const sleepSpy = vi.spyOn(service as never, 'sleep').mockResolvedValue(undefined);
    let attempts = 0;
    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(JSON.stringify({
            error: {
              message: '{\n  "error": {\n    "code": 503,\n    "message": "The service is currently unavailable.",\n    "status": "UNAVAILABLE"\n  }\n}\n',
              code: 503,
              status: 'Service Unavailable',
            },
          }));
        }
        const json = JSON.stringify(toGraphExtraction({
          title: 'Retry Chapter',
          summary: 'Alice returns.',
          people: [
            {
              local_id: 'p1',
              name: 'Alice',
              evidence: [{ quote: 'Alice returns to the square.', pageIndex: 1, pageNumber: 2 }],
            },
          ],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        }));
        return {
          data: (async function* () {
            yield json;
          })(),
          usage: Promise.resolve({}),
        };
      }),
    } as never);

    const result = await (service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-retry-503',
      chapterId: 'chapter-retry-503',
      chapterIndex: 7,
      chapterTitle: 'Retry Chapter',
      chapterText: 'Alice returns to the square.',
      chapterContentHash: 'retry-chapter-hash',
      piece: {
        pageIndex: 1,
        pageNumber: 2,
        rawText: 'Alice returns to the square.',
        sourceHash: 'retry-hash-1',
        pieceIndex: 0,
        totalPieces: 1,
        pageRefs: [{ pageIndex: 1, pageNumber: 2 }],
      },
      bookContext: bookContextService.buildBookContextBundle('book-retry-503', 'chapter-retry-503'),
      chapterContext: bookContextService.buildChapterContextBundle('book-retry-503', 'chapter-retry-503'),
      pageWindow: {
        previous: undefined,
        current: { pageIndex: 1, sourceHash: 'retry-hash-1', text: 'Alice returns to the square.' },
        next: undefined,
      },
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(result.nodes[0]).toMatchObject({
      type: 'person',
      label: 'Alice',
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        owner_kind: 'node',
        owner_id: 'p1',
        quote: 'Alice returns to the square.',
        pageIndex: 1,
        pageNumber: 2,
      }),
    ]);
    expect(attempts).toBe(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  test('does not retry non-transient piece failures', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-no-retry',
      chapterId: 'chapter-no-retry',
      chapterIndex: 8,
      chapterTitle: 'No Retry Chapter',
      pageIndex: 0,
      sourceHash: 'no-retry-hash',
      pageParagraphs: { '0': 'This should fail once.' },
    });

    const sleepSpy = vi.spyOn(service as never, 'sleep').mockResolvedValue(undefined);
    let attempts = 0;
    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async () => {
        attempts += 1;
        throw new Error('Malformed request');
      }),
    } as never);

    await expect((service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-no-retry',
      chapterId: 'chapter-no-retry',
      chapterIndex: 8,
      chapterTitle: 'No Retry Chapter',
      chapterText: 'This should fail once.',
      chapterContentHash: 'no-retry-chapter-hash',
      piece: {
        pageIndex: 0,
        pageNumber: 1,
        rawText: 'This should fail once.',
        sourceHash: 'no-retry-hash',
        pieceIndex: 0,
        totalPieces: 1,
        pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      },
      bookContext: bookContextService.buildBookContextBundle('book-no-retry', 'chapter-no-retry'),
      chapterContext: bookContextService.buildChapterContextBundle('book-no-retry', 'chapter-no-retry'),
      pageWindow: {
        previous: undefined,
        current: { pageIndex: 0, sourceHash: 'no-retry-hash', text: 'This should fail once.' },
        next: undefined,
      },
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    })).rejects.toThrow('Malformed request');

    expect(attempts).toBe(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test('restarts a knowledge extraction workflow after a transient llm failure', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-run-retry',
      chapterId: 'chapter-run-retry',
      chapterIndex: 9,
      chapterTitle: 'Workflow Retry Chapter',
      pageIndex: 0,
      sourceHash: 'workflow-retry-hash',
      pageParagraphs: { '0': 'Alice waits for the model service to recover.' },
    });

    const sleepSpy = vi.spyOn(service as never, 'sleep').mockResolvedValue(undefined);
    let attempts = 0;
    vi.spyOn(service as never, 'generateKnowledgeExtraction').mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('503 Service Unavailable: This model is currently experiencing high demand. Please try again later.');
      }
      return {
        title: 'Workflow Retry Chapter',
        summary: 'Recovered after a transient retry.',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      };
    });

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-run-retry',
      chapterId: 'chapter-run-retry',
      chapterIndex: 9,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    expect(attempts).toBe(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  test('stores piece checkpoint after failure and resumes from the next piece', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-piece-resume',
      chapterId: 'chapter-piece-resume',
      chapterIndex: 10,
      chapterTitle: 'Piece Resume Chapter',
      pageIndex: 0,
      sourceHash: 'piece-resume-0',
      pageParagraphs: { '0': 'Alice appears first.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-piece-resume',
      chapterId: 'chapter-piece-resume',
      chapterIndex: 10,
      chapterTitle: 'Piece Resume Chapter',
      pageIndex: 2,
      sourceHash: 'piece-resume-2',
      pageParagraphs: { '0': 'Bob appears second.' },
    });

    const seenPageIndexes: number[] = [];
    let secondPieceAttempts = 0;
    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: { piece: { pageIndex: number; pageNumber: number } }) => {
        seenPageIndexes.push(input.piece.pageIndex);
        if (input.piece.pageIndex === 0) {
          return toGraphExtraction({
            title: 'ignored',
            summary: 'ignored',
            people: [
              {
                local_id: 'p1',
                name: 'Alice',
                evidence: [{ quote: 'Alice appears first.', pageIndex: 0, pageNumber: 1 }],
              },
            ],
            ideas: [],
            events: [],
            entities: [],
            themes: [],
            relations: [],
          });
        }

        secondPieceAttempts += 1;
        if (secondPieceAttempts === 1) {
          throw new Error('synthetic piece failure');
        }

        return toGraphExtraction({
          title: 'ignored',
          summary: 'ignored',
          people: [
            {
              local_id: 'p2',
              name: 'Bob',
              evidence: [{ quote: 'Bob appears second.', pageIndex: 2, pageNumber: 3 }],
            },
          ],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        });
      },
    );

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-piece-resume',
      chapterId: 'chapter-piece-resume',
      chapterIndex: 10,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('failed');
    });

    expect(service.getWorkflowStatus(submit.workflowRunId).checkpoint).toMatchObject({
      totalPieces: 2,
      lastCompletedPieceIndex: 0,
      nextPieceIndex: 1,
      nextPrimaryPageIndex: 2,
      nextPrimaryPageNumber: 3,
    });

    const restart = service.restartWorkflow(submit.workflowRunId, { mode: 'resume' });
    expect(restart.status).toBe('queued');

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    expect(seenPageIndexes).toEqual([0, 2, 2]);
  });

  test('resumes from persisted piece cache when run partial results are missing', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-piece-cache-resume',
      chapterId: 'chapter-piece-cache-resume',
      chapterIndex: 12,
      chapterTitle: 'Piece Cache Resume Chapter',
      pageIndex: 0,
      sourceHash: 'piece-cache-resume-0',
      pageParagraphs: { '0': 'Alice appears first.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-piece-cache-resume',
      chapterId: 'chapter-piece-cache-resume',
      chapterIndex: 12,
      chapterTitle: 'Piece Cache Resume Chapter',
      pageIndex: 2,
      sourceHash: 'piece-cache-resume-2',
      pageParagraphs: { '0': 'Bob appears second.' },
    });

    const seenPageIndexes: number[] = [];
    let secondPieceAttempts = 0;
    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: { piece: { pageIndex: number; pageNumber: number } }) => {
        seenPageIndexes.push(input.piece.pageIndex);
        if (input.piece.pageIndex === 0) {
          return toGraphExtraction({
            title: 'ignored',
            summary: 'ignored',
            people: [
              {
                local_id: 'p1',
                name: 'Alice',
                evidence: [{ quote: 'Alice appears first.', pageIndex: 0, pageNumber: 1 }],
              },
            ],
            ideas: [],
            events: [],
            entities: [],
            themes: [],
            relations: [],
          });
        }

        secondPieceAttempts += 1;
        if (secondPieceAttempts === 1) {
          throw new Error('synthetic piece failure');
        }

        return toGraphExtraction({
          title: 'ignored',
          summary: 'ignored',
          people: [
            {
              local_id: 'p2',
              name: 'Bob',
              evidence: [{ quote: 'Bob appears second.', pageIndex: 2, pageNumber: 3 }],
            },
          ],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        });
      },
    );

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-piece-cache-resume',
      chapterId: 'chapter-piece-cache-resume',
      chapterIndex: 12,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('failed');
    });

    workflowRepository.clearPartialPieceResults(submit.workflowRunId);

    service.restartWorkflow(submit.workflowRunId, { mode: 'resume' });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    expect(seenPageIndexes).toEqual([0, 2, 2]);
  });

  test('restarts knowledge extraction from the first piece when requested', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-piece-restart',
      chapterId: 'chapter-piece-restart',
      chapterIndex: 11,
      chapterTitle: 'Piece Restart Chapter',
      pageIndex: 0,
      sourceHash: 'piece-restart-0',
      pageParagraphs: { '0': 'Alice appears first.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-piece-restart',
      chapterId: 'chapter-piece-restart',
      chapterIndex: 11,
      chapterTitle: 'Piece Restart Chapter',
      pageIndex: 2,
      sourceHash: 'piece-restart-2',
      pageParagraphs: { '0': 'Bob appears second.' },
    });

    const seenPageIndexes: number[] = [];
    let secondPieceAttempts = 0;
    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: { piece: { pageIndex: number; pageNumber: number } }) => {
        seenPageIndexes.push(input.piece.pageIndex);
        if (input.piece.pageIndex === 0) {
          return toGraphExtraction({
            title: 'ignored',
            summary: 'ignored',
            people: [
              {
                local_id: 'p1',
                name: 'Alice',
                evidence: [{ quote: 'Alice appears first.', pageIndex: 0, pageNumber: 1 }],
              },
            ],
            ideas: [],
            events: [],
            entities: [],
            themes: [],
            relations: [],
          });
        }

        secondPieceAttempts += 1;
        if (secondPieceAttempts === 1) {
          throw new Error('synthetic piece failure');
        }

        return toGraphExtraction({
          title: 'ignored',
          summary: 'ignored',
          people: [
            {
              local_id: 'p2',
              name: 'Bob',
              evidence: [{ quote: 'Bob appears second.', pageIndex: 2, pageNumber: 3 }],
            },
          ],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        });
      },
    );

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-piece-restart',
      chapterId: 'chapter-piece-restart',
      chapterIndex: 11,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('failed');
    });

    service.restartWorkflow(submit.workflowRunId, { mode: 'from_start' });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    expect(seenPageIndexes).toEqual([0, 2, 0, 2]);
  });

  test('omits progress when a running workflow becomes stale', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const queueService = new WorkflowQueueService();
    let queuedTask: (() => Promise<void>) | undefined;
    vi.spyOn(queueService, 'enqueue').mockImplementation((task) => {
      queuedTask = task as () => Promise<void>;
    });
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      queueService,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-stale-progress',
      chapterId: 'chapter-stale-progress',
      chapterIndex: 1,
      chapterTitle: 'Stale Progress',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'Alice sees stale data.',
      },
    });

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-stale-progress',
      chapterId: 'chapter-stale-progress',
      chapterIndex: 1,
      workflowVersion: 'v1',
      expectedSnapshotVersion: 1,
    });

    bookRepository.upsertPageFragment({
      bookId: 'book-stale-progress',
      chapterId: 'chapter-stale-progress',
      chapterIndex: 1,
      chapterTitle: 'Stale Progress',
      pageIndex: 1,
      sourceHash: 'hash-page-1',
      pageParagraphs: {
        '0': 'The canonical chapter changes before execution.',
      },
    });
    await queuedTask?.();

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('stale');
    });

    expect(service.getWorkflowStatus(submit.workflowRunId).progress).toBeUndefined();
  });

  test('keeps only evidence anchored to pages inside the chunk', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Chunked Chapter',
      summary: 'summary',
      people: [
        {
          local_id: 'p1',
          name: 'Alice',
          evidence: [
            { quote: 'Alice on page one', pageIndex: 0, pageNumber: 1 },
            { quote: 'Alice on page four', pageIndex: 3, pageNumber: 4 },
          ],
        },
      ],
    }, {
      chapterId: 'chapter-1',
      chapterTitle: 'Chunked Chapter',
      chapterText: 'Page one text.\n\nPage two text.',
      allowedPageRefs: [
        { pageIndex: 0, pageNumber: 1 },
        { pageIndex: 1, pageNumber: 2 },
      ],
    });

    expect(result.people[0]?.evidence).toEqual([
      { quote: 'Alice on page one', pageIndex: 0, pageNumber: 1 },
    ]);
  });

  test('infers missing page numbers when an excerpt uniquely matches one page in a multi-page chunk', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-multi-page-inference',
      chapterId: 'chapter-multi-page-inference',
      chapterIndex: 1,
      chapterTitle: 'Multi Page Inference',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: {
        '0': 'Steven Levitt opens the introduction with a challenge to conventional thinking.',
      },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-multi-page-inference',
      chapterId: 'chapter-multi-page-inference',
      chapterIndex: 1,
      chapterTitle: 'Multi Page Inference',
      pageIndex: 1,
      sourceHash: 'hash-page-1',
      pageParagraphs: {
        '0': 'Pierre Bourget appears in a discussion of naming trends.',
      },
    });

    vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async () => ({
        data: (async function* () {
          yield JSON.stringify({
            title: 'Multi Page Inference',
            summary: 'summary',
            nodes: [
              { id: 'p1', type: 'person', label: 'Pierre Bourget' },
            ],
            edges: [],
            evidence: [
              {
                id: 'ev1',
                owner_kind: 'node',
                owner_id: 'p1',
                quote: 'Pierre Bourget appears in a discussion of naming trends.',
              },
            ],
          });
        })(),
        usage: Promise.resolve({}),
      })),
    } as never);

    const result = await (service as never).generateKnowledgeExtractionForPiece({
      bookId: 'book-multi-page-inference',
      chapterId: 'chapter-multi-page-inference',
      chapterIndex: 1,
      chapterTitle: 'Multi Page Inference',
      chapterText: 'Steven Levitt opens the introduction with a challenge to conventional thinking.\n\nPierre Bourget appears in a discussion of naming trends.',
      chapterContentHash: 'chapter-hash-multi-page-inference',
      piece: {
        pageIndex: 0,
        pageNumber: 1,
        rawText: 'Steven Levitt opens the introduction with a challenge to conventional thinking.\n\nPierre Bourget appears in a discussion of naming trends.',
        sourceHash: 'hash-piece-multi-page-inference',
        pieceIndex: 0,
        totalPieces: 1,
        pageRefs: [
          { pageIndex: 0, pageNumber: 1 },
          { pageIndex: 1, pageNumber: 2 },
        ],
      },
      bookContext: bookContextService.buildBookContextBundle('book-multi-page-inference', 'chapter-multi-page-inference'),
      chapterContext: bookContextService.buildChapterContextBundle('book-multi-page-inference', 'chapter-multi-page-inference'),
      pageWindow: {
        previous: undefined,
        current: {
          pageIndex: 0,
          sourceHash: 'hash-page-0',
          text: 'Steven Levitt opens the introduction with a challenge to conventional thinking.',
        },
        next: {
          pageIndex: 1,
          sourceHash: 'hash-page-1',
          text: 'Pierre Bourget appears in a discussion of naming trends.',
        },
      },
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(result.evidence).toEqual([
      expect.objectContaining({
        owner_kind: 'node',
        owner_id: 'p1',
        quote: 'Pierre Bourget appears in a discussion of naming trends.',
        pageIndex: 1,
        pageNumber: 2,
      }),
    ]);
  });

  test('does not infer a page number when the same excerpt appears on multiple allowed pages', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Ambiguous Excerpt',
      summary: 'summary',
      people: [
        {
          local_id: 'p1',
          name: 'Alice',
          evidence: [{ quote: 'Repeated line.' }],
        },
      ],
    }, {
      chapterId: 'chapter-ambiguous-excerpt',
      chapterTitle: 'Ambiguous Excerpt',
      chapterText: 'Repeated line.\n\nRepeated line.',
      allowedPageRefs: [
        { pageIndex: 0, pageNumber: 1 },
        { pageIndex: 1, pageNumber: 2 },
      ],
      pageTextByPageIndex: new Map([
        [0, 'Repeated line.'],
        [1, 'Repeated line.'],
      ]),
    });

    expect(result.people).toEqual([]);
  });

  test('drops legacy-format knowledge items that do not carry evidence', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Evidence Required',
      summary: 'summary',
      people: [
        {
          local_id: 'p1',
          name: 'Alice',
          evidence: [{ quote: 'Alice speaks.', pageIndex: 0, pageNumber: 1 }],
        },
        {
          local_id: 'p2',
          name: 'Bob',
        },
      ],
      ideas: [
        {
          local_id: 'i1',
          label: 'A supported idea',
          kind: 'principle',
          evidence: [{ quote: 'A supported idea.', pageIndex: 0, pageNumber: 1 }],
        },
        {
          local_id: 'i2',
          label: 'An unsupported idea',
          kind: 'principle',
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
          evidence: [{ quote: 'Alice supports the idea.', pageIndex: 0, pageNumber: 1 }],
        },
        {
          local_id: 'r2',
          from_id: 'p2',
          from_type: 'person',
          to_id: 'i2',
          to_type: 'idea',
          relation_type: 'supports',
          evidence: [{ quote: 'Bob supports the idea.', pageIndex: 0, pageNumber: 1 }],
        },
        {
          local_id: 'r3',
          from_id: 'p1',
          from_type: 'person',
          to_id: 'i1',
          to_type: 'idea',
          relation_type: 'supports',
        },
      ],
    }, {
      chapterId: 'chapter-evidence-required',
      chapterTitle: 'Evidence Required',
      chapterText: 'Alice speaks. A supported idea. Alice supports the idea.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.people.map((person: { local_id: string }) => person.local_id)).toEqual(['p1']);
    expect(result.ideas.map((idea: { local_id: string }) => idea.local_id)).toEqual(['i1']);
    expect(result.relations.map((relation: { local_id: string }) => relation.local_id)).toEqual(['r1']);
  });

  test('keeps fiction ideas even when nonfiction filters would remove them', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Fiction Chapter',
      summary: 'summary',
      ideas: [
        {
          local_id: 'i1',
          label: 'Alice should abandon the family mission',
          kind: 'belief',
          evidence: [{ quote: 'She should abandon the mission', pageIndex: 0, pageNumber: 1 }],
        },
      ],
    }, {
      chapterId: 'chapter-fiction-ideas',
      chapterTitle: 'Fiction Chapter',
      chapterText: 'She should abandon the mission.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      promptVariant: 'fiction',
    });

    expect(result.ideas).toEqual([
      expect.objectContaining({
        local_id: 'i1',
        label: 'Alice should abandon the family mission',
        kind: 'belief',
      }),
    ]);
  });

  test('normalizes graph edge directions toward canonical abstract/concrete flow', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Direction Rules',
      summary: 'summary',
      nodes: [
        { id: 'i1', type: 'idea', label: 'Campaign finance incentives', kind: 'principle' },
        { id: 'e1', type: 'entity', label: 'political campaigns', entity_type: 'other' },
        { id: 'p1', type: 'entity', label: 'United States', entity_type: 'place' },
        { id: 'ev1', type: 'event', label: 'Crime wave predictions' },
        { id: 't1', type: 'theme', label: 'Hidden side of everything', strength: 0.8 },
      ],
      edges: [
        {
          id: 'r1',
          from: 'i1',
          to: 'e1',
          relation_type: 'reflects',
          description: 'The abstract claim points at the concrete example.',
        },
        {
          id: 'r2',
          from: 'i1',
          to: 'e1',
          relation_type: 'supports',
          description: 'The abstract claim points at the concrete evidence.',
        },
        {
          id: 'r3',
          from: 'i1',
          to: 'e1',
          relation_type: 'opposes',
          description: 'The abstract claim points at the concrete opposing force.',
        },
        {
          id: 'r4',
          from: 'p1',
          to: 'ev1',
          relation_type: 'happens_at',
          description: 'The place points at the event.',
        },
        {
          id: 'r5',
          from: 'i1',
          to: 't1',
          relation_type: 'illustrates',
          description: 'Low-signal abstract-to-theme edge.',
        },
      ],
      evidence: [
        { id: 'ev1', owner_kind: 'node', owner_id: 'i1', quote: 'Campaign finance incentives matter.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev2', owner_kind: 'node', owner_id: 'e1', quote: 'Political campaigns illustrate campaign finance incentives.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev3', owner_kind: 'node', owner_id: 'p1', quote: 'The example occurs in the United States.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev4', owner_kind: 'node', owner_id: 'ev1', quote: 'Crime wave predictions appear here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev5', owner_kind: 'edge', owner_id: 'r1', quote: 'Political campaigns illustrate campaign finance incentives.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev6', owner_kind: 'edge', owner_id: 'r2', quote: 'Political campaigns support campaign finance incentives.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev7', owner_kind: 'edge', owner_id: 'r3', quote: 'Political campaigns oppose campaign finance incentives.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev8', owner_kind: 'edge', owner_id: 'r4', quote: 'Crime wave predictions occur in the United States.', pageIndex: 0, pageNumber: 1 },
      ],
    }, {
      chapterId: 'chapter-direction-rules',
      chapterTitle: 'Direction Rules',
      chapterText: 'Political campaigns illustrate campaign finance incentives.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        local_id: 'r1',
        from_id: 'e1',
        to_id: 'i1',
        relation_type: 'illustrates',
      }),
      expect.objectContaining({
        local_id: 'r2',
        from_id: 'e1',
        to_id: 'i1',
        relation_type: 'supports',
      }),
      expect.objectContaining({
        local_id: 'r3',
        from_id: 'e1',
        to_id: 'i1',
        relation_type: 'opposes',
      }),
      expect.objectContaining({
        local_id: 'r4',
        from_id: 'ev1',
        to_id: 'p1',
        relation_type: 'happens_at',
      }),
    ]));
    expect(result.relations.find((relation) => relation.local_id === 'r5')).toBeUndefined();
  });

  test('drops graph-format nodes and edges that lack matching evidence coverage', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Graph Evidence Coverage',
      summary: 'summary',
      nodes: [
        { id: 'p1', type: 'person', label: 'Alice' },
        { id: 'p2', type: 'person', label: 'Bob' },
        { id: 'i1', type: 'idea', label: 'Supported idea', kind: 'principle' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'p1',
          to: 'i1',
          relation_type: 'supports',
          description: 'Alice supports the idea.',
        },
        {
          id: 'r2',
          from: 'p2',
          to: 'i1',
          relation_type: 'supports',
          description: 'Bob supports the idea.',
        },
      ],
      evidence: [
        {
          id: 'ev1',
          owner_kind: 'node',
          owner_id: 'p1',
          quote: 'Alice speaks.',
          pageIndex: 0,
          pageNumber: 1,
        },
        {
          id: 'ev2',
          owner_kind: 'node',
          owner_id: 'i1',
          quote: 'The supported idea is stated here.',
          pageIndex: 0,
          pageNumber: 1,
        },
        {
          id: 'ev3',
          owner_kind: 'edge',
          owner_id: 'r1',
          quote: 'Alice supports the idea.',
          pageIndex: 0,
          pageNumber: 1,
        },
      ],
    }, {
      chapterId: 'chapter-graph-evidence-coverage',
      chapterTitle: 'Graph Evidence Coverage',
      chapterText: 'Alice speaks. The supported idea is stated here. Alice supports the idea.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.people.map((person: { local_id: string }) => person.local_id)).toEqual(['p1']);
    expect(result.ideas.map((idea: { local_id: string }) => idea.local_id)).toEqual(['i1']);
    expect(result.relations.map((relation: { local_id: string }) => relation.local_id)).toEqual(['r1']);
  });

  test('rewrites vague graph relations into more specific semantics', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Semantic Rewrites',
      summary: 'summary',
      nodes: [
        { id: 'p1', type: 'person', label: 'Robert Heilbroner' },
        { id: 'n1', type: 'entity', label: 'The Worldly Philosophers', entity_type: 'object' },
        { id: 'i1', type: 'idea', label: 'Economics as a set of tools', kind: 'claim' },
        { id: 'e1', type: 'event', label: 'Campaign spending example' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'p1',
          to: 'n1',
          relation_type: 'related_to',
          description: 'wrote',
        },
        {
          id: 'r2',
          from: 'p1',
          to: 'i1',
          relation_type: 'related_to',
          description: 'argued that economics is a toolkit',
        },
        {
          id: 'r3',
          from: 'p1',
          to: 'i1',
          relation_type: 'related_to',
          description: 'wrote about',
        },
        {
          id: 'r4',
          from: 'i1',
          to: 'e1',
          relation_type: 'related_to',
          description: 'illustrated by the spending example',
        },
      ],
      evidence: [
        { id: 'ev1', owner_kind: 'node', owner_id: 'p1', quote: 'Robert Heilbroner wrote The Worldly Philosophers.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev2', owner_kind: 'node', owner_id: 'n1', quote: 'The Worldly Philosophers is named here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev3', owner_kind: 'node', owner_id: 'i1', quote: 'Economics is a toolkit.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev4', owner_kind: 'node', owner_id: 'e1', quote: 'The spending example appears here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev5', owner_kind: 'edge', owner_id: 'r1', quote: 'Robert Heilbroner wrote The Worldly Philosophers.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev6', owner_kind: 'edge', owner_id: 'r2', quote: 'Robert Heilbroner argued that economics is a toolkit.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev7', owner_kind: 'edge', owner_id: 'r3', quote: 'Robert Heilbroner wrote about economics.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev8', owner_kind: 'edge', owner_id: 'r4', quote: 'The spending example illustrated the point.', pageIndex: 0, pageNumber: 1 },
      ],
    }, {
      chapterId: 'chapter-semantic-rewrites',
      chapterTitle: 'Semantic Rewrites',
      chapterText: 'Robert Heilbroner wrote The Worldly Philosophers and argued that economics is a toolkit.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        local_id: 'r1',
        relation_type: 'authored',
      }),
      expect.objectContaining({
        local_id: 'r2',
        relation_type: 'argues',
      }),
      expect.objectContaining({
        local_id: 'r3',
        relation_type: 'mentions',
      }),
      expect.objectContaining({
        local_id: 'r4',
        from_id: 'e1',
        to_id: 'i1',
        relation_type: 'illustrates',
      }),
    ]));
  });

  test('normalizes surname-only people from page, chapter, and memory context plus founded-style authored relations', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const graph = (service as never).sanitizeKnowledgeExtractionGraph({
      title: 'Identity Recovery',
      summary: 'summary',
      nodes: [
        { id: 'p1', type: 'person', label: 'Forbes' },
        { id: 'p2', type: 'person', label: 'Huffington' },
        { id: 'p3', type: 'person', label: 'Golisano', aliases: ['Michael Huffington', 'Steve Forbes', 'Golisano'] },
        { id: 'n1', type: 'entity', label: 'Huffington Institute', entity_type: 'organization' },
        { id: 'i1', type: 'idea', label: 'Campaign spending and voter appeal', kind: 'principle' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'p1',
          to: 'i1',
          relation_type: 'related_to',
          description: 'argued that money cannot significantly alter voter perception',
        },
        {
          id: 'r2',
          from: 'p2',
          to: 'n1',
          relation_type: 'authored',
          description: 'created the Huffington Institute',
        },
        {
          id: 'r3',
          from: 'p3',
          to: 'i1',
          relation_type: 'related_to',
          description: 'mentioned as a wealthy candidate who spent heavily without winning',
        },
      ],
      evidence: [],
    }, {
      chapterId: 'chapter-identity-recovery',
      chapterTitle: 'Identity Recovery',
      chapterText: 'Steve Forbes debated campaign spending while Arianna Huffington and especially Thomas Golisano spent heavily in losing campaigns. Later, Messrs. Forbes, Huffington, and Golisano already knew this.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      promptVariant: 'nonfiction',
      primaryPageText: 'Messrs. Forbes, Huffington, and Golisano already knew this.',
      memoryContext: {
        people: [
          {
            local_id: 'p-memory-1',
            canonical_label: 'Arianna Huffington',
            aliases: ['Huffington'],
            seen_pages: [0],
          },
        ],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'p1',
        type: 'person',
        label: 'Steve Forbes',
        aliases: ['Forbes'],
      }),
      expect.objectContaining({
        id: 'p2',
        type: 'person',
        label: 'Arianna Huffington',
        aliases: ['Huffington'],
      }),
      expect.objectContaining({
        id: 'p3',
        type: 'person',
        label: 'Thomas Golisano',
        aliases: ['Golisano'],
      }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'r1',
        relation_type: 'argues',
      }),
      expect.objectContaining({
        id: 'r2',
        relation_type: 'founded',
      }),
      expect.objectContaining({
        id: 'r3',
        relation_type: 'mentions',
      }),
    ]));
  });

  test('normalizes titled and reversed person names and rewrites located_in event edges', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const graph = (service as never).sanitizeKnowledgeExtractionGraph({
      title: 'Name Cleanup',
      summary: 'summary',
      nodes: [
        { id: 'p1', type: 'person', label: 'President Clinton' },
        { id: 'p2', type: 'person', label: 'Heilbroner, Robert' },
        { id: 'n1', type: 'entity', label: 'Denver', entity_type: 'place' },
        { id: 'e1', type: 'event', label: 'Police and murder correlation example' },
        { id: 'n2', type: 'entity', label: 'The Worldly Philosophers', entity_type: 'other' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'n1',
          to: 'e1',
          relation_type: 'located_in',
          description: 'Denver is where the comparison is observed.',
        },
        {
          id: 'r2',
          from: 'p2',
          to: 'n2',
          relation_type: 'related_to',
          description: 'authored',
        },
      ],
      evidence: [],
    }, {
      chapterId: 'chapter-name-cleanup',
      chapterTitle: 'Name Cleanup',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      promptVariant: 'nonfiction',
      primaryPageText: 'Bill Clinton warned of chaos while Robert Heilbroner wrote The Worldly Philosophers.',
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'p1',
        label: 'Bill Clinton',
        aliases: ['President Clinton'],
      }),
      expect.objectContaining({
        id: 'p2',
        label: 'Robert Heilbroner',
        aliases: ['Heilbroner, Robert'],
      }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'r1',
        from: 'e1',
        to: 'n1',
        relation_type: 'happens_at',
      }),
      expect.objectContaining({
        id: 'r2',
        relation_type: 'authored',
      }),
    ]));
  });

  test('reclassifies authored work-like ideas into object entities', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const graph = (service as never).sanitizeKnowledgeExtractionGraph({
      title: 'Work Reclassification',
      summary: 'summary',
      nodes: [
        { id: 'p1', type: 'person', label: 'Robert Heilbroner' },
        { id: 'i1', type: 'idea', label: 'The Worldly Philosophers', kind: 'claim', description: 'A book about economists.' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'p1',
          to: 'i1',
          relation_type: 'related_to',
          description: 'wrote',
        },
      ],
      evidence: [],
    }, {
      chapterId: 'chapter-work-reclassification',
      chapterTitle: 'Work Reclassification',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      promptVariant: 'nonfiction',
      primaryPageText: 'Robert Heilbroner wrote The Worldly Philosophers.',
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'i1',
        type: 'entity',
        entity_type: 'object',
        label: 'The Worldly Philosophers',
      }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'r1',
        relation_type: 'authored',
      }),
    ]));
  });

  test('deduplicates near-duplicate nonfiction ideas and rewrites graph references', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Idea Dedupe',
      summary: 'summary',
      nodes: [
        {
          id: 'i1',
          type: 'idea',
          label: 'Correlation vs. Causation',
          kind: 'principle',
        },
        {
          id: 'i2',
          type: 'idea',
          label: 'Correlation vs. Causation in Politics',
          kind: 'claim',
        },
        {
          id: 'e1',
          type: 'event',
          label: 'Campaign spending example',
        },
      ],
      edges: [
        {
          id: 'r1',
          from: 'e1',
          to: 'i2',
          relation_type: 'reflects',
          description: 'The event illustrates the contextualized duplicate idea.',
        },
      ],
      evidence: [
        {
          id: 'ev1',
          owner_kind: 'node',
          owner_id: 'i2',
          quote: 'Money and victory are correlated.',
          pageIndex: 0,
          pageNumber: 1,
        },
        {
          id: 'ev2',
          owner_kind: 'node',
          owner_id: 'e1',
          quote: 'The election example appears on this page.',
          pageIndex: 0,
          pageNumber: 1,
        },
        {
          id: 'ev3',
          owner_kind: 'edge',
          owner_id: 'r1',
          quote: 'The event illustrates the correlation point.',
          pageIndex: 0,
          pageNumber: 1,
        },
      ],
    }, {
      chapterId: 'chapter-idea-dedupe',
      chapterTitle: 'Idea Dedupe',
      chapterText: 'Money and victory are correlated.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.ideas).toEqual([
      expect.objectContaining({
        local_id: 'i1',
        label: 'Correlation vs. Causation',
      }),
    ]);
    expect(result.relations).toEqual([
      expect.objectContaining({
        local_id: 'r1',
        from_id: 'e1',
        to_id: 'i1',
      }),
    ]);
    expect(result.ideas[0]?.evidence).toEqual([
      {
        quote: 'Money and victory are correlated.',
        pageIndex: 0,
        pageNumber: 1,
      },
    ]);
  });

  test('deduplicates same-label entities across generic and specific types and rewrites graph references', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Entity Dedupe',
      summary: 'summary',
      nodes: [
        {
          id: 'n1',
          type: 'entity',
          label: 'Real-estate agents',
          entity_type: 'other',
        },
        {
          id: 'n2',
          type: 'entity',
          label: 'Real-estate agents',
          entity_type: 'organization',
          description: 'A professional group discussed in the chapter.',
        },
        {
          id: 'e1',
          type: 'event',
          label: 'Housing market example',
        },
      ],
      edges: [
        {
          id: 'r1',
          from: 'e1',
          to: 'n1',
          relation_type: 'illustrates',
          description: 'The example illustrates real-estate agent incentives.',
        },
      ],
      evidence: [
        {
          id: 'ev1',
          owner_kind: 'node',
          owner_id: 'n1',
          quote: 'Real-estate agents benefit from more transactions.',
          pageIndex: 0,
          pageNumber: 1,
        },
        {
          id: 'ev2',
          owner_kind: 'node',
          owner_id: 'e1',
          quote: 'The housing market example appears here.',
          pageIndex: 0,
          pageNumber: 1,
        },
        {
          id: 'ev3',
          owner_kind: 'edge',
          owner_id: 'r1',
          quote: 'The example illustrates real-estate agent incentives.',
          pageIndex: 0,
          pageNumber: 1,
        },
      ],
    }, {
      chapterId: 'chapter-entity-dedupe',
      chapterTitle: 'Entity Dedupe',
      chapterText: 'Real-estate agents benefit from more transactions.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.entities).toEqual([
      expect.objectContaining({
        local_id: 'n2',
        label: 'Real-estate agents',
        type: 'organization',
        description: 'A professional group discussed in the chapter.',
        evidence: [
          {
            quote: 'Real-estate agents benefit from more transactions.',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      }),
    ]);
    expect(result.relations).toEqual([
      expect.objectContaining({
        local_id: 'r1',
        to_id: 'n2',
        to_type: 'entity',
      }),
    ]);
  });

  test('falls back to embedded graph evidence when top-level evidence is missing', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Embedded Evidence',
      summary: 'summary',
      nodes: [
        {
          id: 'p1',
          type: 'person',
          label: 'Alice',
          evidence: [
            {
              quote: 'Alice speaks at City Hall.',
              pageIndex: 0,
              pageNumber: 1,
            },
          ],
        },
        {
          id: 'i1',
          type: 'idea',
          label: 'Freedom matters',
          kind: 'claim',
          evidence: [
            {
              quote: 'Freedom matters',
              pageIndex: 0,
              pageNumber: 1,
            },
          ],
        },
      ],
      edges: [
        {
          id: 'r1',
          from: 'p1',
          to: 'i1',
          relation_type: 'argues',
          description: 'Alice argues that freedom matters.',
          evidence: [
            {
              quote: 'Alice says freedom matters.',
              pageIndex: 0,
              pageNumber: 1,
            },
          ],
        },
      ],
      evidence: [],
    }, {
      chapterId: 'chapter-embedded-evidence',
      chapterTitle: 'Embedded Evidence',
      chapterText: 'Alice speaks at City Hall. Freedom matters.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.people).toEqual([
      expect.objectContaining({
        local_id: 'p1',
        evidence: [
          {
            quote: 'Alice speaks at City Hall.',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      }),
    ]);
    expect(result.ideas).toEqual([
      expect.objectContaining({
        local_id: 'i1',
        evidence: [
          {
            quote: 'Freedom matters',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      }),
    ]);
    expect(result.relations).toEqual([
      expect.objectContaining({
        local_id: 'r1',
        evidence: [
          {
            quote: 'Alice says freedom matters.',
            pageIndex: 0,
            pageNumber: 1,
          },
        ],
      }),
    ]);
  });

  test('reclassifies abstract entity labels into ideas and drops context-only related edges', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Abstract Entity Reclassification',
      summary: 'summary',
      nodes: [
        {
          id: 'p1',
          type: 'person',
          label: 'Adam Smith',
        },
        {
          id: 'n1',
          type: 'entity',
          label: 'Classical economics',
          entity_type: 'place',
          description: 'An economic tradition associated with Adam Smith.',
        },
        {
          id: 'n2',
          type: 'entity',
          label: 'Campaign finance',
          entity_type: 'other',
        },
        {
          id: 'n3',
          type: 'entity',
          label: 'Chewing gum',
          entity_type: 'other',
        },
      ],
      edges: [
        {
          id: 'r1',
          from: 'p1',
          to: 'n1',
          relation_type: 'founded',
          description: 'Adam Smith is identified as the founder of classical economics.',
        },
        {
          id: 'r2',
          from: 'n3',
          to: 'n2',
          relation_type: 'related_to',
          description: 'The amount spent on chewing gum is used to contextualize campaign finance.',
        },
      ],
      evidence: [
        { id: 'ev1', owner_kind: 'node', owner_id: 'p1', quote: 'Adam Smith founded classical economics.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev2', owner_kind: 'node', owner_id: 'n1', quote: 'Classical economics is named here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev3', owner_kind: 'node', owner_id: 'n2', quote: 'Campaign finance is discussed here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev4', owner_kind: 'node', owner_id: 'n3', quote: 'Chewing gum is mentioned as a comparison.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev5', owner_kind: 'edge', owner_id: 'r1', quote: 'Adam Smith founded classical economics.', pageIndex: 0, pageNumber: 1 },
      ],
    }, {
      chapterId: 'chapter-abstract-entity-reclassification',
      chapterTitle: 'Abstract Entity Reclassification',
      chapterText: 'Adam Smith founded classical economics.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.ideas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        local_id: 'n1',
        label: 'Classical economics',
      }),
      expect.objectContaining({
        local_id: 'n2',
        label: 'Campaign finance',
      }),
    ]));
    expect(result.entities).toEqual([
      expect.objectContaining({
        local_id: 'n3',
        label: 'Chewing gum',
      }),
    ]);
    expect(result.relations).toEqual([
      expect.objectContaining({
        local_id: 'r1',
        from_id: 'p1',
        to_id: 'n1',
        to_type: 'idea',
        relation_type: 'founded',
      }),
    ]);
  });

  test('deduplicates contextualized correlation and causation principle variants', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Correlation Dedupe',
      summary: 'summary',
      nodes: [
        {
          id: 'i1',
          type: 'idea',
          label: 'Correlation does not imply causation',
          kind: 'principle',
        },
        {
          id: 'i2',
          type: 'idea',
          label: 'Correlation vs. Causation in elections',
          kind: 'principle',
        },
        {
          id: 'e1',
          type: 'event',
          label: 'Campaign spending example',
        },
      ],
      edges: [
        {
          id: 'r1',
          from: 'e1',
          to: 'i2',
          relation_type: 'illustrates',
          description: 'The campaign spending example illustrates the broader principle.',
        },
      ],
      evidence: [
        { id: 'ev1', owner_kind: 'node', owner_id: 'i2', quote: 'Correlation does not imply causation.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev2', owner_kind: 'node', owner_id: 'e1', quote: 'Campaign spending is an example on this page.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev3', owner_kind: 'edge', owner_id: 'r1', quote: 'The campaign spending example illustrates the broader principle.', pageIndex: 0, pageNumber: 1 },
      ],
    }, {
      chapterId: 'chapter-correlation-dedupe',
      chapterTitle: 'Correlation Dedupe',
      chapterText: 'Campaign spending is an example of correlation not implying causation.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.ideas).toEqual([
      expect.objectContaining({
        local_id: 'i1',
        label: 'Correlation does not imply causation',
      }),
    ]);
    expect(result.relations).toEqual([
      expect.objectContaining({
        local_id: 'r1',
        from_id: 'e1',
        to_id: 'i1',
        relation_type: 'illustrates',
      }),
    ]);
  });

  test('drops placeholder people and low-signal graph edges', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const graph = (service as never).sanitizeKnowledgeExtractionGraph({
      title: 'Quality Guardrails',
      summary: 'summary',
      nodes: [
        { id: 'p1', type: 'person', label: 'Candidate A' },
        { id: 'p2', type: 'person', label: 'Real-estate agent' },
        { id: 'p3', type: 'person', label: 'Adam Smith' },
        { id: 'p4', type: 'person', label: 'California auto mechanics' },
        { id: 'p5', type: 'person', label: 'Police officers' },
        { id: 'p6', type: 'person', label: 'Candidate' },
        { id: 'p7', type: 'person', label: 'Czar' },
        { id: 'p8', type: 'person', label: 'Unknown observer' },
        { id: 'i1', type: 'idea', label: 'Markets reflect incentives', kind: 'principle' },
        { id: 'e1', type: 'event', label: 'Campaign debate' },
        { id: 'n1', type: 'entity', label: 'Chewing gum', entity_type: 'other' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'p1',
          to: 'e1',
          relation_type: 'participates_in',
          description: 'Candidate A participates in the hypothetical election.',
        },
        {
          id: 'r2',
          from: 'p2',
          to: 'i1',
          relation_type: 'related_to',
          description: 'Real-estate agents are a type of expert whose incentives matter.',
        },
        {
          id: 'r3',
          from: 'n1',
          to: 'i1',
          relation_type: 'related_to',
          description: 'Chewing gum is used as a comparison to frame campaign spending.',
        },
        {
          id: 'r4',
          from: 'p3',
          to: 'i1',
          relation_type: 'related_to',
          description: 'argued that incentives drive market behavior',
        },
        {
          id: 'r5',
          from: 'n1',
          to: 'e1',
          relation_type: 'related_to',
          description: 'Chewing gum is compared to campaign spending to mock excess.',
        },
      ],
      evidence: [],
    }, {
      chapterId: 'chapter-quality-guardrails',
      chapterTitle: 'Quality Guardrails',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      promptVariant: 'nonfiction',
      primaryPageText: 'Adam Smith argued that incentives drive market behavior.',
      memoryContext: {
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
      },
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'p3',
        type: 'person',
        label: 'Adam Smith',
      }),
    ]));
    expect(graph.nodes.find((node: { id: string }) => node.id === 'p1')).toBeUndefined();
    expect(graph.nodes.find((node: { id: string }) => node.id === 'p2')).toBeUndefined();
    expect(graph.nodes.find((node: { id: string }) => node.id === 'p4')).toBeUndefined();
    expect(graph.nodes.find((node: { id: string }) => node.id === 'p5')).toBeUndefined();
    expect(graph.nodes.find((node: { id: string }) => node.id === 'p6')).toBeUndefined();
    expect(graph.nodes.find((node: { id: string }) => node.id === 'p7')).toBeUndefined();
    expect(graph.nodes.find((node: { id: string }) => node.id === 'p8')).toBeUndefined();
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: 'r4',
        relation_type: 'argues',
      }),
    ]);
  });

  test('drops residual located_in edges after event-location rewrites', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Location Noise',
      summary: 'summary',
      nodes: [
        { id: 'i1', type: 'idea', label: 'Freakonomics', kind: 'principle' },
        { id: 'n1', type: 'entity', label: 'New York City', entity_type: 'place' },
        { id: 'e1', type: 'event', label: 'Data analysis example' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'i1',
          to: 'n1',
          relation_type: 'located_in',
          description: 'An abstract idea should not be placed in a city.',
        },
        {
          id: 'r2',
          from: 'e1',
          to: 'n1',
          relation_type: 'located_in',
          description: 'The example takes place in New York City.',
        },
      ],
      evidence: [
        { id: 'ev1', owner_kind: 'node', owner_id: 'n1', quote: 'New York City is named here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev2', owner_kind: 'node', owner_id: 'e1', quote: 'The data analysis example appears here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev3', owner_kind: 'edge', owner_id: 'r2', quote: 'The example takes place in New York City.', pageIndex: 0, pageNumber: 1 },
      ],
    }, {
      chapterId: 'chapter-location-noise',
      chapterTitle: 'Location Noise',
      chapterText: 'The idea appears in New York City.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.relations).toEqual([
      expect.objectContaining({
        local_id: 'r2',
        from_id: 'e1',
        to_id: 'n1',
        relation_type: 'happens_at',
      }),
    ]);
  });

  test('drops non-event happens_at edges even when the LLM emits them directly', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const result = (service as never).sanitizeKnowledgeExtraction({
      title: 'Invalid Happens At',
      summary: 'summary',
      nodes: [
        { id: 'i1', type: 'idea', label: 'Campaign finance', kind: 'principle' },
        { id: 'n1', type: 'entity', label: 'United States', entity_type: 'place' },
        { id: 'e1', type: 'event', label: 'Election example' },
      ],
      edges: [
        {
          id: 'r1',
          from: 'n1',
          to: 'i1',
          relation_type: 'happens_at',
          description: 'A place should not point at an idea via happens_at.',
        },
        {
          id: 'r2',
          from: 'i1',
          to: 'n1',
          relation_type: 'happens_at',
          description: 'An idea should not happen at a place.',
        },
        {
          id: 'r3',
          from: 'e1',
          to: 'n1',
          relation_type: 'happens_at',
          description: 'An event can happen in the United States.',
        },
      ],
      evidence: [
        { id: 'ev1', owner_kind: 'node', owner_id: 'n1', quote: 'The United States is named here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev2', owner_kind: 'node', owner_id: 'e1', quote: 'An election example happened here.', pageIndex: 0, pageNumber: 1 },
        { id: 'ev3', owner_kind: 'edge', owner_id: 'r3', quote: 'An election example happened in the United States.', pageIndex: 0, pageNumber: 1 },
      ],
    }, {
      chapterId: 'chapter-invalid-happens-at',
      chapterTitle: 'Invalid Happens At',
      chapterText: 'An election example happened in the United States.',
      allowedPageRefs: [{ pageIndex: 0, pageNumber: 1 }],
    });

    expect(result.relations).toEqual([
      expect.objectContaining({
        local_id: 'r3',
        from_id: 'e1',
        to_id: 'n1',
        relation_type: 'happens_at',
      }),
    ]);
  });

  test('limits memory continuity to compact high-signal items', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    );

    const memory = (service as never).buildMemoryContext({
      title: 'Memory Snapshot',
      summary: 'summary',
      people: Array.from({ length: 20 }, (_, index) => ({
        local_id: `p${index}`,
        name: `Person ${index}`,
        importance: index === 19 ? 'main' : 'minor',
        evidence: [{ quote: `Person ${index}`, pageIndex: index, pageNumber: index + 1 }],
      })),
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    }, 19);

    expect(memory.people).toHaveLength(12);
    expect(memory.people[0]).toMatchObject({
      local_id: 'p19',
      canonical_label: 'Person 19',
    });
    expect(memory.people.every((item: { seen_pages: number[] }) => item.seen_pages.length <= 4)).toBe(true);
  });

  test('auto-submits quiz after knowledge extraction completes', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';
    process.env.AUTO_SUBMIT_QUIZ_WORKFLOW = '1';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const quizService = {
      submitQuizWorkflow: vi.fn(() => ({
        workflowRunId: 'quiz-run-1',
        deduped: false,
      })),
    };
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
      undefined,
      { get: vi.fn(() => quizService) } as never,
    );

    const upsert = bookRepository.upsertPageFragment({
      bookId: 'book-auto-quiz',
      chapterId: 'chapter-auto-quiz',
      chapterIndex: 7,
      chapterTitle: 'Auto Quiz',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'Alice studies the chapter.' },
    });

    vi.spyOn(service as never, 'generateKnowledgeExtraction').mockResolvedValue({
      title: 'Auto Quiz',
      summary: 'Alice studies the chapter.',
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    });

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-auto-quiz',
      chapterId: 'chapter-auto-quiz',
      chapterIndex: 7,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
      expect(quizService.submitQuizWorkflow).toHaveBeenCalledTimes(1);
    });

    expect(quizService.submitQuizWorkflow).toHaveBeenCalledWith({
      bookId: 'book-auto-quiz',
      chapterId: 'chapter-auto-quiz',
      chapterIndex: 7,
      workflowVersion: 'v1',
      expectedSnapshotVersion: upsert.book.snapshotVersion,
      expectedChapterContentHash: upsert.chapter.chapterContentHash,
    });
  });

  test('merges matching quiz pre-reading guide into latest knowledge extraction results', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const quizRepository = new QuizWorkflowRepository();
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      new BookContextService(bookRepository, workflowRepository),
      workflowRepository,
      new WorkflowQueueService(),
      quizRepository,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-preread',
      chapterId: 'chapter-preread',
      chapterIndex: 3,
      chapterTitle: 'Chapter Three',
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'Alice studies the risks before she speaks in public.' },
    });

    const book = bookRepository.getBook('book-preread');
    const chapter = bookRepository.getChapter('book-preread', 'chapter-preread');
    if (!book || !chapter) {
      throw new Error('expected canonical chapter state');
    }

    const knowledgeRun = workflowRepository.createOrReuseRun({
      bookId: 'book-preread',
      chapterId: 'chapter-preread',
      chapterIndex: 3,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge-preread',
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter.chapterContentHash,
    });
    workflowRepository.completeRun({
      workflowRunId: knowledgeRun.run.id,
      snapshotVersion: book.snapshotVersion,
      chapterContentHash: chapter.chapterContentHash,
      result: {
        title: 'Chapter Three',
        summary: 'Alice studies the risks before she speaks in public.',
        people: [],
        ideas: [],
        events: [],
        entities: [],
        themes: [],
        relations: [],
      },
    });

    const quizRun = quizRepository.createOrReuseRun({
      bookId: 'book-preread',
      chapterId: 'chapter-preread',
      chapterIndex: 3,
      workflowVersion: 'v1',
      idempotencyKey: 'quiz-preread',
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter.chapterContentHash,
      requestedByUserId: undefined,
    });
    quizRepository.completeRun({
      workflowRunId: quizRun.run.id,
      snapshotVersion: book.snapshotVersion,
      chapterContentHash: chapter.chapterContentHash,
      result: {
        teaser: 'A public decision is coming, but the chapter first teaches you how to watch it.',
        pre_reading_questions: [
          'What kind of risk is becoming visible?',
          'Which details prepare you to judge the coming choice?',
          'What should you watch for when private doubt becomes public action?',
        ],
        questions: [],
      },
    });

    const latest = service.getLatestChapterKnowledgeExtraction('book-preread', 'chapter-preread');
    expect(latest.result.teaser).toBe(
      'A public decision is coming, but the chapter first teaches you how to watch it.',
    );
    expect(latest.result.pre_reading_questions).toEqual([
      'What kind of risk is becoming visible?',
      'Which details prepare you to judge the coming choice?',
      'What should you watch for when private doubt becomes public action?',
    ]);

    const result = service.getWorkflowResult(knowledgeRun.run.id);
    expect(result.result.teaser).toBe(
      'A public decision is coming, but the chapter first teaches you how to watch it.',
    );
    expect(result.result.pre_reading_questions).toHaveLength(3);
  });

  test('does not auto-submit quiz when disabled', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';
    process.env.AUTO_SUBMIT_QUIZ_WORKFLOW = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const quizService = { submitQuizWorkflow: vi.fn() };
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
      undefined,
      { get: vi.fn(() => quizService) } as never,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-auto-disabled',
      chapterId: 'chapter-auto-disabled',
      chapterIndex: 8,
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'Alice studies the chapter.' },
    });

    vi.spyOn(service as never, 'generateKnowledgeExtraction').mockResolvedValue({
      title: 'Auto Disabled',
      summary: 'Alice studies the chapter.',
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    });

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-auto-disabled',
      chapterId: 'chapter-auto-disabled',
      chapterIndex: 8,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    expect(quizService.submitQuizWorkflow).not.toHaveBeenCalled();
  });

  test('keeps knowledge extraction completed when quiz auto-submit fails', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';
    process.env.AUTO_SUBMIT_QUIZ_WORKFLOW = '1';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const quizService = {
      submitQuizWorkflow: vi.fn(() => {
        throw new Error('synthetic quiz failure');
      }),
    };
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
      undefined,
      { get: vi.fn(() => quizService) } as never,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-auto-fail',
      chapterId: 'chapter-auto-fail',
      chapterIndex: 9,
      pageIndex: 0,
      sourceHash: 'hash-page-0',
      pageParagraphs: { '0': 'Alice studies the chapter.' },
    });

    vi.spyOn(service as never, 'generateKnowledgeExtraction').mockResolvedValue({
      title: 'Auto Fail',
      summary: 'Alice studies the chapter.',
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    });

    const submit = service.submitKnowledgeExtractionWorkflow({
      bookId: 'book-auto-fail',
      chapterId: 'chapter-auto-fail',
      chapterIndex: 9,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
      expect(quizService.submitQuizWorkflow).toHaveBeenCalledTimes(1);
    });

    expect(service.getWorkflowResult(submit.workflowRunId).result.title).toBe('Auto Fail');
  });
});
