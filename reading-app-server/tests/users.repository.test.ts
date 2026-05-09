import { describe, expect, test } from 'vitest';
import { UsersRepository } from '../src/modules/users/users.repository';

describe('UsersRepository', () => {
  test('restores the same anonymous user for the same device id', async () => {
    const repository = new UsersRepository();

    const first = await repository.createOrRestoreAnonymousUser({
      deviceId: 'device-1',
      client: 'ios',
    });
    const second = await repository.createOrRestoreAnonymousUser({
      deviceId: 'device-1',
      client: 'ios',
      displayName: 'Reader',
    });
    const third = await repository.createOrRestoreAnonymousUser({
      deviceId: 'device-2',
      client: 'ios',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.user.userId).toBe(first.user.userId);
    expect(second.user.displayName).toBe('Reader');
    expect(third.user.userId).not.toBe(first.user.userId);
  });

  test('updates mastery with capped skills and derived depth', async () => {
    const repository = new UsersRepository();
    const { user } = await repository.createOrRestoreAnonymousUser({
      deviceId: 'device-1',
      client: 'ios',
    });

    const profile = await repository.patchMastery(user.userId, {
      scopeType: 'global',
      delta: {
        Facts: 120,
        Inference: 30,
        Tone: 20,
        Argument: 10,
        exp: 150,
        totalAnswers: 3,
      },
    });

    expect(profile.skills).toEqual({
      Facts: 100,
      Inference: 30,
      Tone: 20,
      Argument: 10,
    });
    expect(profile.depthOfUnderstanding).toBe(40);
    expect(profile.exp).toBe(150);
    expect(profile.totalAnswers).toBe(3);
  });

  test('queries quiz attempts and upserts annotations', async () => {
    const repository = new UsersRepository();
    const { user } = await repository.createOrRestoreAnonymousUser({
      deviceId: 'device-1',
      client: 'web',
    });
    await repository.upsertDocument(user.userId, {
      documentId: 'doc-1',
      sourceType: 'article',
      title: 'Article One',
    });

    await repository.createQuizAttempt(user.userId, {
      documentId: 'doc-1',
      chapterId: 'ch-1',
      score: 2,
      total: 3,
      answers: [{ questionId: 'q1', correct: true }],
      skillBreakdown: { Facts: 1, Inference: 1 },
    });

    const attempts = repository.listQuizAttempts(user.userId, {
      documentId: 'doc-1',
      chapterId: 'ch-1',
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].score).toBe(2);
    expect(repository.listMastery(user.userId, 'global')[0].exp).toBe(100);

    const firstAnnotation = await repository.upsertAnnotation(user.userId, {
      annotationId: 'ann-1',
      documentId: 'doc-1',
      targetType: 'sentence',
      targetId: 's1',
      kind: 'note',
      text: 'First note',
    });
    const updatedAnnotation = await repository.upsertAnnotation(user.userId, {
      annotationId: 'ann-1',
      documentId: 'doc-1',
      targetType: 'sentence',
      targetId: 's1',
      kind: 'note',
      text: 'Updated note',
    });

    expect(updatedAnnotation.recordId).toBe(firstAnnotation.recordId);
    expect(updatedAnnotation.createdAt).toBe(firstAnnotation.createdAt);
    expect(repository.listAnnotations(user.userId, { documentId: 'doc-1', kind: 'note' })).toMatchObject([
      { annotationId: 'ann-1', text: 'Updated note' },
    ]);
  });

  test('defines schema and loads persisted records from SurrealDB', async () => {
    const persisted: Record<string, Array<Record<string, unknown>>> = {
      app_user: [],
      user_device: [],
      user_document: [],
      reading_progress: [],
      mastery_profile: [],
      quiz_attempt: [],
      annotation: [],
    };
    const queries: string[] = [];
    const surrealStub = {
      query: async (sql: string) => {
        queries.push(sql);
        return [];
      },
      selectTable: async (table: string) => persisted[table] ?? [],
      putRecord: async (table: string, _id: string, record: Record<string, unknown>) => {
        persisted[table].push(record);
      },
    };

    const writer = new UsersRepository(surrealStub as never);
    await writer.onModuleInit();
    const created = await writer.createOrRestoreAnonymousUser({
      deviceId: 'device-1',
      client: 'extension',
    });
    await writer.upsertDocument(created.user.userId, {
      documentId: 'doc-1',
      sourceType: 'article',
      title: 'Article One',
    });

    const reader = new UsersRepository(surrealStub as never);
    await reader.onModuleInit();

    expect(queries[0]).toContain('DEFINE TABLE IF NOT EXISTS app_user SCHEMALESS;');
    expect(queries[0]).toContain('DEFINE TABLE IF NOT EXISTS annotation SCHEMALESS;');
    expect(reader.getUser(created.user.userId)).toMatchObject({ userId: created.user.userId });
    expect(reader.listDocuments(created.user.userId)).toMatchObject([
      { documentId: 'doc-1', title: 'Article One' },
    ]);
  });
});
