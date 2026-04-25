import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-workflow-'));
  return new BookIngestionRepository(dataDir);
};

describe('KnowledgeExtractionWorkflowService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('processes pages in pageIndex order and merges repeated knowledge across pages', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const service = new KnowledgeExtractionWorkflowService(bookRepository, workflowRepository);

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

    const seenCalls: Array<{ pageIndex: number; memoryContext: string }> = [];
    vi.spyOn(service as never, 'generateKnowledgeExtractionForPiece').mockImplementation(
      async (input: {
        piece: { pageIndex: number };
        memoryContext: string;
      }) => {
        seenCalls.push({
          pageIndex: input.piece.pageIndex,
          memoryContext: input.memoryContext,
        });

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
                evidence: [{ quote: 'Alice begins the speech' }],
                pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
              },
            ],
            ideas: [
              {
                local_id: 'i1',
                label: 'Freedom',
                description: 'A core ideal',
                kind: 'claim',
                evidence: [{ quote: 'about freedom' }],
                pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
              },
            ],
            events: [
              {
                local_id: 'e1',
                label: 'Speech',
                description: 'Alice speaks publicly',
                participant_local_ids: ['p1'],
                evidence: [{ quote: 'begins the speech' }],
                pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
              },
            ],
            entities: [
              {
                local_id: 'n1',
                label: 'City Hall',
                type: 'place',
                evidence: [{ quote: 'at City Hall' }],
                pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
              },
            ],
            themes: [
              {
                local_id: 't1',
                label: 'Resistance',
                strength: 0.4,
                evidence: [{ quote: 'freedom' }],
                pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
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
                evidence: [{ quote: 'Alice begins the speech about freedom' }],
                pageRefs: [{ pageIndex: 0, pageNumber: 1 }],
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
              evidence: [{ quote: 'Alice continues the speech' }],
              pageRefs: [{ pageIndex: 2, pageNumber: 3 }],
            },
          ],
          ideas: [
            {
              local_id: 'i9',
              label: 'freedom',
              description: 'Still central',
              kind: 'claim',
              evidence: [{ quote: 'about freedom' }],
              pageRefs: [{ pageIndex: 2, pageNumber: 3 }],
            },
          ],
          events: [
            {
              local_id: 'e9',
              label: 'speech',
              participant_local_ids: ['p9'],
              place_hint: 'City Hall',
              evidence: [{ quote: 'continues the speech' }],
              pageRefs: [{ pageIndex: 2, pageNumber: 3 }],
            },
          ],
          entities: [
            {
              local_id: 'n9',
              label: 'city hall',
              type: 'place',
              description: 'Public building',
              evidence: [{ quote: 'City Hall' }],
              pageRefs: [{ pageIndex: 2, pageNumber: 3 }],
            },
          ],
          themes: [
            {
              local_id: 't9',
              label: 'resistance',
              strength: 0.8,
              evidence: [{ quote: 'freedom' }],
              pageRefs: [{ pageIndex: 2, pageNumber: 3 }],
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
              evidence: [{ quote: 'Alice continues the speech about freedom' }],
              pageRefs: [{ pageIndex: 2, pageNumber: 3 }],
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

    expect(seenCalls.map((call) => call.pageIndex)).toEqual([0, 2]);
    expect(seenCalls[0]?.memoryContext).toBe('[]');
    expect(seenCalls[1]?.memoryContext).toContain('"local_id": "p1"');
    expect(seenCalls[1]?.memoryContext).toContain('"label": "Alice"');

    const result = service.getWorkflowResult(submit.workflowRunId).result;
    const latest = service.getLatestChapterKnowledgeExtraction('book-1', 'chapter-1').result;
    const expectedPageRefs = [
      { pageIndex: 0, pageNumber: 1 },
      { pageIndex: 2, pageNumber: 3 },
    ];

    expect(result.title).toBe('Chapter One');
    expect(result.people).toHaveLength(1);
    expect(result.ideas).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.entities).toHaveLength(1);
    expect(result.themes).toHaveLength(1);
    expect(result.relations).toHaveLength(1);

    expect(result.people[0]).toMatchObject({
      local_id: 'p1',
      name: 'Alice',
      aliases: ['Al', 'Alice'],
      roles: ['leader', 'strategist'],
      traits: ['brave'],
      pageRefs: expectedPageRefs,
    });
    expect(result.ideas[0]).toMatchObject({
      local_id: 'i1',
      label: 'Freedom',
      pageRefs: expectedPageRefs,
    });
    expect(result.events[0]).toMatchObject({
      local_id: 'e1',
      label: 'Speech',
      participant_local_ids: ['p1'],
      pageRefs: expectedPageRefs,
    });
    expect(result.entities[0]).toMatchObject({
      local_id: 'n1',
      label: 'City Hall',
      pageRefs: expectedPageRefs,
    });
    expect(result.themes[0]).toMatchObject({
      local_id: 't1',
      label: 'Resistance',
      strength: 0.8,
      pageRefs: expectedPageRefs,
    });
    expect(result.relations[0]).toMatchObject({
      local_id: 'r1',
      from_id: 'p1',
      from_type: 'person',
      to_id: 'i1',
      to_type: 'idea',
      relation_type: 'supports',
      confidence: 0.9,
      pageRefs: expectedPageRefs,
    });
    expect(latest.people[0]?.pageRefs).toEqual(expectedPageRefs);
  });

  test('rejects workflow submission when canonical chapter text is empty', async () => {
    const bookRepository = await createBookRepository();
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const service = new KnowledgeExtractionWorkflowService(bookRepository, workflowRepository);

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
});
