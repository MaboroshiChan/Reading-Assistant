import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service';
import { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-workflow-'));
  return new BookIngestionRepository(dataDir);
};

describe('KnowledgeExtractionWorkflowService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE;
  });

  test('processes pages in pageIndex order and merges repeated knowledge across pages', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(bookRepository, workflowRepository, queueService);

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
    const upsertSpy = vi.spyOn(workflowRepository, 'upsertPageExtraction');
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
    expect(upsertSpy).toHaveBeenCalledTimes(2);

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
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(bookRepository, workflowRepository, queueService);

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

  test('reuses the latest completed result when canonical chapter content is unchanged', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(bookRepository, workflowRepository, queueService);

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

  test('fails fast when cache is required and no completed result matches the chapter state', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '1';

    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const queueService = new WorkflowQueueService();
    const service = new KnowledgeExtractionWorkflowService(bookRepository, workflowRepository, queueService);

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
});
