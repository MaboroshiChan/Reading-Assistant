import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { BookIngestionService } from '../src/modules/book-ingestion/book-ingestion.service';
import { flushBookIngestionLogs } from '../src/modules/book-ingestion/book-ingestion.logger';

describe('book ingestion logging', () => {
  afterEach(async () => {
    delete process.env.BOOK_INGESTION_LOG_STDOUT;
    vi.restoreAllMocks();
    await flushBookIngestionLogs();
  });

  test('emits structured stdout logs for parse, upsert, materialize, and read operations', async () => {
    process.env.BOOK_INGESTION_LOG_STDOUT = '1';
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const service = new BookIngestionService(new BookIngestionRepository());

    const request = service.parseUpsertRequest(
      JSON.stringify({
        bookId: 'book-1',
        chapterId: 'chapter-1',
        chapterIndex: 2,
        chapterTitle: 'Chapter Two',
        pageIndex: 1,
        sourceHash: 'hash-1',
        pageParagraphs: {
          '0': 'paragraph one',
          '1': 'paragraph two',
        },
      }),
      {
        bookId: 'book-1',
        chapterId: 'chapter-1',
        pageIndex: 1,
      },
    );

    service.upsertPageFragment(request);
    service.getChapter('book-1', 'chapter-1');
    service.getPage('book-1', 'chapter-1', 1);

    await flushBookIngestionLogs();

    const lines = stdoutWriteSpy.mock.calls
      .map(([line]) => line)
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const events = lines.map((line) => line.event);

    expect(events).toContain('request.parsed');
    expect(events).toContain('book.created');
    expect(events).toContain('chapter.created');
    expect(events).toContain('chapter.materialized');
    expect(events).toContain('page.persisted');
    expect(events).toContain('page.upsert_completed');
    expect(events).toContain('chapter.read_hit');
    expect(events).toContain('page.read_hit');

    const persistedEntry = lines.find((line) => line.event === 'page.persisted');
    expect(persistedEntry).toMatchObject({
      scope: 'book-ingestion',
      bookId: 'book-1',
      chapterId: 'chapter-1',
      pageIndex: 1,
      sourceHash: 'hash-1',
      paragraphCount: 2,
    });

    expect(stdoutWriteSpy).toHaveBeenCalled();
  });
});
