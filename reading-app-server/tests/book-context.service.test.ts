import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { BookContextService } from '../src/modules/book-ingestion/book-context.service';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'book-context-'));
  return new BookIngestionRepository(dataDir);
};

const emptyKnowledge = (summary: string) => ({
  title: 'ignored',
  summary,
  people: [],
  ideas: [],
  events: [],
  entities: [],
  themes: [],
  relations: [],
});

describe('BookContextService', () => {
  test('builds sorted chapter/page context and prior summaries', async () => {
    const repository = await createBookRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const service = new BookContextService(repository, knowledgeRepository);

    repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pageIndex: 1,
      sourceHash: 'hash-2-1',
      pageParagraphs: { '0': 'second chapter page two' },
      bookMetadata: { title: 'Example Book', author: 'Author', language: 'en' },
    });
    repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pageIndex: 0,
      sourceHash: 'hash-2-0',
      pageParagraphs: { '0': 'second chapter page one' },
    });
    repository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'hash-1-0',
      pageParagraphs: { '0': 'first chapter page one' },
    });

    const book = repository.getBook('book-1');
    const chapter1 = repository.getChapter('book-1', 'chapter-1');
    const chapter2 = repository.getChapter('book-1', 'chapter-2');
    if (!book || !chapter1 || !chapter2) {
      throw new Error('expected canonical book state');
    }

    const run = knowledgeRepository.createOrReuseRun({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'k1',
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter1.chapterContentHash,
    });
    knowledgeRepository.completeRun({
      workflowRunId: run.run.id,
      snapshotVersion: book.snapshotVersion,
      chapterContentHash: chapter1.chapterContentHash,
      result: emptyKnowledge('Chapter one summary'),
    });

    const bundle = service.buildBookContextBundle('book-1', 'chapter-2');
    const chapterContext = service.buildChapterContextBundle('book-1', 'chapter-2');
    const pageWindow = service.buildPageWindowContext('book-1', 'chapter-2', 1);

    expect(bundle).toMatchObject({
      bookId: 'book-1',
      title: 'Example Book',
      author: 'Author',
      language: 'en',
      chapters: [
        { chapterId: 'chapter-1', chapterIndex: 1, title: 'Chapter One' },
        { chapterId: 'chapter-2', chapterIndex: 2, title: 'Chapter Two' },
      ],
      priorChapterSummaries: [
        { chapterId: 'chapter-1', chapterIndex: 1, title: 'Chapter One', summary: 'Chapter one summary' },
      ],
      currentChapterPages: [
        { pageIndex: 0, pageNumber: 1, sourceHash: 'hash-2-0' },
        { pageIndex: 1, pageNumber: 2, sourceHash: 'hash-2-1' },
      ],
    });
    expect(chapterContext).toMatchObject({
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pages: [
        { pageIndex: 0, pageNumber: 1, sourceHash: 'hash-2-0' },
        { pageIndex: 1, pageNumber: 2, sourceHash: 'hash-2-1' },
      ],
    });
    expect(pageWindow).toMatchObject({
      radius: 1,
      previous: { pageIndex: 0, pageNumber: 1, sourceHash: 'hash-2-0', text: 'second chapter page one' },
      current: { pageIndex: 1, pageNumber: 2, sourceHash: 'hash-2-1', text: 'second chapter page two' },
    });
  });

  test('builds context even when prior chapter summaries are missing', async () => {
    const repository = await createBookRepository();
    const service = new BookContextService(repository, new KnowledgeExtractionWorkflowRepository());

    repository.upsertPageFragment({
      bookId: 'book-2',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'hash-1',
      pageParagraphs: { '0': 'page one' },
    });
    repository.upsertPageFragment({
      bookId: 'book-2',
      chapterId: 'chapter-2',
      chapterIndex: 2,
      chapterTitle: 'Chapter Two',
      pageIndex: 0,
      sourceHash: 'hash-2',
      pageParagraphs: { '0': 'page two' },
    });

    const bundle = service.buildBookContextBundle('book-2', 'chapter-2');

    expect(bundle?.priorChapterSummaries).toEqual([]);
    expect(bundle?.chapters).toHaveLength(2);
    expect(bundle?.currentChapterPages).toEqual([
      { pageIndex: 0, pageNumber: 1, sourceHash: 'hash-2' },
    ]);
  });
});
