import { afterEach, describe, expect, test, vi } from 'vitest';
import { SurrealService } from '../src/modules/surrealDB/surrealdb.service';

const ENV_KEYS = ['SURREAL_URL', 'SURREAL_NS', 'SURREAL_DB', 'SURREAL_USER', 'SURREAL_PASS'] as const;

const setSurrealEnv = (): void => {
  process.env.SURREAL_URL = 'http://127.0.0.1:8000';
  process.env.SURREAL_NS = 'Lumen';
  process.env.SURREAL_DB = 'test';
  process.env.SURREAL_USER = 'root';
  process.env.SURREAL_PASS = 'root';
};

describe('SurrealService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  test('throws when required Surreal configuration is missing', async () => {
    for (const key of ENV_KEYS) {
      process.env[key] = '';
    }
    const service = new SurrealService();

    await expect(service.onModuleInit()).rejects.toThrow(
      'Missing SurrealDB configuration: SURREAL_URL, SURREAL_NS, SURREAL_DB, SURREAL_USER, SURREAL_PASS',
    );
  });

  test('throws when the SurrealDB healthcheck fails', async () => {
    setSurrealEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    const service = new SurrealService();

    await expect(service.onModuleInit()).rejects.toThrow('SurrealDB healthcheck failed with HTTP 503');
  });

  test('queries and writes through the HTTP API after initialization', async () => {
    setSurrealEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            status: 'OK',
            result: [{ recordId: 'person_abc', name: 'Alice' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new SurrealService();
    await service.onModuleInit();

    const rows = await service.selectTable<{ recordId: string; name: string }>('person');
    await service.putRecord('person', 'person_abc', { recordId: 'person_abc', name: 'Alice' });

    expect(rows).toEqual([{ recordId: 'person_abc', name: 'Alice' }]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/sql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'text/plain',
          'Surreal-NS': 'Lumen',
          'Surreal-DB': 'test',
        }),
        body: 'SELECT * FROM person;',
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:8000/key/person/person_abc',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Surreal-NS': 'Lumen',
          'Surreal-DB': 'test',
        }),
        body: JSON.stringify({ recordId: 'person_abc', name: 'Alice' }),
      }),
    );
  });

  test('strips Surreal id metadata before writing plain records', async () => {
    setSurrealEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new SurrealService();
    await service.onModuleInit();
    await service.putRecord('person', 'person_abc', {
      id: 'person:person_abc',
      recordId: 'person_abc',
      name: 'Alice',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/key/person/person_abc',
      expect.objectContaining({
        body: JSON.stringify({ recordId: 'person_abc', name: 'Alice' }),
      }),
    );
  });

  test('writes relation records through RELATE statements', async () => {
    setSurrealEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { status: 'OK', result: [] },
          { status: 'OK', result: [{ id: 'appears_in:edge_1' }] },
        ],
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new SurrealService();
    await service.onModuleInit();
    await service.putRelationRecord(
      'appears_in',
      'edge_1',
      'person:person_abc',
      'chapter:chapter_abc',
      {
        id: 'appears_in:edge_1',
        recordId: 'edge_1',
        in: 'person:person_abc',
        out: 'chapter:chapter_abc',
        chapterRecordId: 'chapter_abc',
      },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/sql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'text/plain',
          'Surreal-NS': 'Lumen',
          'Surreal-DB': 'test',
        }),
        body: [
          'DELETE ONLY appears_in:edge_1;',
          'RELATE person:person_abc->appears_in:edge_1->chapter:chapter_abc CONTENT {"recordId":"edge_1","chapterRecordId":"chapter_abc"};',
        ].join('\n'),
      }),
    );
  });
});
