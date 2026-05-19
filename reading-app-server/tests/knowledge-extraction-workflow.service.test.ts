import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookContextService } from '../src/modules/book-ingestion/book-context.service';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service';
import { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';
import * as llmService from '../services/llmService';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-workflow-'));
  return new BookIngestionRepository(dataDir);
};

describe('KnowledgeExtractionWorkflowService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE;
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
    const pageCacheSpy = vi.spyOn(workflowRepository, 'setCachedPageExtraction');
    const replaceSpy = vi.spyOn(workflowRepository, 'replaceChapterExtraction');
    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: {
        piece: { pageIndex: number };
      }) => {
        seenPageIndexes.push(input.piece.pageIndex);

        if (input.piece.pageIndex === 0) {
          return {
            title: 'ignored',
            summary: 'ignored',
            people: [
              {
                local_id: 'p1',
                name: 'Alice',
                aliases: ['Al'],
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
          };
        }

        return {
          title: 'ignored again',
          summary: 'ignored again',
          people: [
            {
              local_id: 'p9',
              name: 'alice',
              aliases: ['Alice'],
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
        };
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
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    const result = service.getWorkflowResult(submit.workflowRunId).result;
    const latest = service.getLatestChapterKnowledgeExtraction('book-1', 'chapter-1').result;
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

    const generateSpy = vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockResolvedValue({
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
    });

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
      pageIndex: 1,
      sourceHash: 'hash-page-1',
      pageParagraphs: {
        '0': 'The second page will fail.',
      },
    });

    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: { piece: { pageIndex: number } }) => {
        if (input.piece.pageIndex === 0) {
          return {
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
          };
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
        const json = JSON.stringify({
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
        });
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
      promptVersion: 'knowledge_extraction.v2.3',
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
    expect(prompts[0]).toContain('Use the primary evidence page as the only source of evidence quotes.');
    expect(createLLMClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      prefixCache: expect.objectContaining({
        cacheKey: 'chapter_context.v1:book-5:chapter-5:chapter-hash-5',
        systemPromptMode: 'request',
      }),
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
        const json = JSON.stringify({
          title: 'Chapter Six',
          summary: 'Alice appears on the current page.',
          people: [],
          ideas: [],
          events: [],
          entities: [],
          themes: [],
          relations: [],
        });
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
      promptVersion: 'knowledge_extraction.v2.3',
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
