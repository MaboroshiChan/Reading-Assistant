import { describe, expect, test } from 'vitest';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';

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
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    });
    expect(snapshotPersist?.record.result).toMatchObject({
      title: 'Chapter One',
      summary: 'A full in-memory result.',
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    });
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
