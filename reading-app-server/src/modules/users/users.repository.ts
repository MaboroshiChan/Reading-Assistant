import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { SurrealService } from '../surrealDB/surrealdb.service';
import type {
  AnnotationRecord,
  AppUserRecord,
  CreateAnonymousUserInput,
  CreateQuizAttemptInput,
  MasteryProfileRecord,
  MasteryScopeType,
  PatchMasteryInput,
  PatchReadingProgressInput,
  QuizAttemptRecord,
  ReadingProgressRecord,
  UpsertAnnotationInput,
  UpsertUserDocumentInput,
  UserDeviceRecord,
  UserDocumentRecord,
  UserSkills,
} from './users.types';

type PersistTable =
  | 'app_user'
  | 'user_device'
  | 'user_document'
  | 'reading_progress'
  | 'mastery_profile'
  | 'quiz_attempt'
  | 'annotation';

const DEFAULT_SKILLS: UserSkills = {
  Facts: 0,
  Inference: 0,
  Tone: 0,
  Argument: 0,
};

const hashSegment = (value: string): string =>
  createHash('sha256').update(value).digest('base64url').slice(0, 32);

const randomId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '')}`;

const clampSkill = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const computeDepth = (skills: UserSkills): number =>
  Math.round((skills.Facts + skills.Inference + skills.Tone + skills.Argument) / 4);

@Injectable()
export class UsersRepository implements OnModuleInit {
  private readonly users = new Map<string, AppUserRecord>();
  private readonly devices = new Map<string, UserDeviceRecord>();
  private readonly deviceRecordIdsByDeviceId = new Map<string, string>();
  private readonly documents = new Map<string, UserDocumentRecord>();
  private readonly documentIdsByUser = new Map<string, Set<string>>();
  private readonly progresses = new Map<string, ReadingProgressRecord>();
  private readonly progressIdsByUserDocument = new Map<string, string>();
  private readonly masteryProfiles = new Map<string, MasteryProfileRecord>();
  private readonly masteryIdsByScope = new Map<string, string>();
  private readonly quizAttempts = new Map<string, QuizAttemptRecord>();
  private readonly quizAttemptIdsByUser = new Map<string, Set<string>>();
  private readonly annotations = new Map<string, AnnotationRecord>();
  private readonly annotationIdsByUser = new Map<string, Set<string>>();

  constructor(
    @Optional()
    @Inject(SurrealService)
    private readonly surrealService?: SurrealService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.surrealService) return;
    await this.ensureSchema();
    await this.loadFromStore();
  }

  async ensureSchema(): Promise<void> {
    if (!this.surrealService) return;
    await this.surrealService.query<unknown>([
      'DEFINE TABLE IF NOT EXISTS app_user SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS user_device SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS user_document SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS reading_progress SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS mastery_profile SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS quiz_attempt SCHEMALESS;',
      'DEFINE TABLE IF NOT EXISTS annotation SCHEMALESS;',
    ].join('\n'));
  }

  async loadFromStore(): Promise<void> {
    if (!this.surrealService) return;

    const [
      users,
      devices,
      documents,
      progresses,
      masteryProfiles,
      quizAttempts,
      annotations,
    ] = await Promise.all([
      this.surrealService.selectTable<AppUserRecord>('app_user'),
      this.surrealService.selectTable<UserDeviceRecord>('user_device'),
      this.surrealService.selectTable<UserDocumentRecord>('user_document'),
      this.surrealService.selectTable<ReadingProgressRecord>('reading_progress'),
      this.surrealService.selectTable<MasteryProfileRecord>('mastery_profile'),
      this.surrealService.selectTable<QuizAttemptRecord>('quiz_attempt'),
      this.surrealService.selectTable<AnnotationRecord>('annotation'),
    ]);

    this.clear();
    for (const user of users) this.indexUser(user);
    for (const device of devices) this.indexDevice(device);
    for (const document of documents) this.indexDocument(document);
    for (const progress of progresses) this.indexProgress(progress);
    for (const profile of masteryProfiles) this.indexMasteryProfile(profile);
    for (const attempt of quizAttempts) this.indexQuizAttempt(attempt);
    for (const annotation of annotations) this.indexAnnotation(annotation);
  }

  async createOrRestoreAnonymousUser(input: CreateAnonymousUserInput): Promise<{
    user: AppUserRecord;
    device: UserDeviceRecord;
    created: boolean;
  }> {
    const timestamp = new Date().toISOString();
    const existingDeviceId = this.deviceRecordIdsByDeviceId.get(input.deviceId);
    if (existingDeviceId) {
      const existingDevice = this.devices.get(existingDeviceId);
      const existingUser = existingDevice ? this.users.get(existingDevice.userId) : undefined;
      if (existingDevice && existingUser) {
        const updatedUser: AppUserRecord = {
          ...existingUser,
          displayName: input.displayName ?? existingUser.displayName,
          lastSeenAt: timestamp,
        };
        const updatedDevice: UserDeviceRecord = {
          ...existingDevice,
          client: input.client,
          lastSeenAt: timestamp,
        };
        this.indexUser(updatedUser);
        this.indexDevice(updatedDevice);
        await Promise.all([
          this.persistRecord('app_user', updatedUser.recordId, updatedUser),
          this.persistRecord('user_device', updatedDevice.recordId, updatedDevice),
        ]);
        return { user: updatedUser, device: updatedDevice, created: false };
      }
    }

    const user: AppUserRecord = {
      recordId: randomId('usr'),
      userId: randomId('usr'),
      type: 'anonymous',
      displayName: input.displayName,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    };
    const device: UserDeviceRecord = {
      recordId: this.makeDeviceRecordId(input.deviceId),
      deviceId: input.deviceId,
      userId: user.userId,
      client: input.client,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    };

    this.indexUser(user);
    this.indexDevice(device);
    await Promise.all([
      this.persistRecord('app_user', user.recordId, user),
      this.persistRecord('user_device', device.recordId, device),
    ]);
    return { user, device, created: true };
  }

  getUser(userId: string): AppUserRecord | null {
    return this.users.get(userId) ?? null;
  }

  async upsertDocument(userId: string, input: UpsertUserDocumentInput): Promise<UserDocumentRecord> {
    const timestamp = new Date().toISOString();
    const documentId = input.documentId ?? this.makeGeneratedDocumentId(userId, input);
    const recordId = this.makeUserDocumentRecordId(userId, documentId);
    const existing = this.documents.get(recordId);
    const record: UserDocumentRecord = {
      recordId,
      userId,
      documentId,
      sourceType: input.sourceType,
      title: input.title,
      author: input.author,
      url: input.url,
      contentHash: input.contentHash,
      metadata: input.metadata,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastReadAt: timestamp,
    };

    this.indexDocument(record);
    await this.persistRecord('user_document', record.recordId, record);
    return record;
  }

  listDocuments(userId: string): UserDocumentRecord[] {
    return Array.from(this.documentIdsByUser.get(userId) ?? [])
      .map((recordId) => this.documents.get(recordId))
      .filter((record): record is UserDocumentRecord => Boolean(record))
      .sort((left, right) => right.lastReadAt.localeCompare(left.lastReadAt));
  }

  getDocument(userId: string, documentId: string): UserDocumentRecord | null {
    return this.documents.get(this.makeUserDocumentRecordId(userId, documentId)) ?? null;
  }

  async patchProgress(
    userId: string,
    documentId: string,
    input: PatchReadingProgressInput,
  ): Promise<ReadingProgressRecord> {
    const timestamp = new Date().toISOString();
    const recordId = this.makeProgressRecordId(userId, documentId);
    const existing = this.progresses.get(recordId);
    const completedParagraphIds = input.completedParagraphIds === undefined
      ? existing?.completedParagraphIds ?? []
      : this.sortStrings([...new Set(input.completedParagraphIds)]);
    const record: ReadingProgressRecord = {
      recordId,
      userId,
      documentId,
      chapterId: input.chapterId ?? existing?.chapterId,
      paragraphId: input.paragraphId ?? existing?.paragraphId,
      sentenceId: input.sentenceId ?? existing?.sentenceId,
      scrollPercent: input.scrollPercent ?? existing?.scrollPercent,
      completedParagraphIds,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.indexProgress(record);
    await this.persistRecord('reading_progress', record.recordId, record);
    return record;
  }

  getProgress(userId: string, documentId: string): ReadingProgressRecord {
    const existing = this.progresses.get(this.makeProgressRecordId(userId, documentId));
    if (existing) return existing;
    const timestamp = new Date().toISOString();
    return {
      recordId: this.makeProgressRecordId(userId, documentId),
      userId,
      documentId,
      completedParagraphIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async patchMastery(userId: string, input: PatchMasteryInput): Promise<MasteryProfileRecord> {
    const timestamp = new Date().toISOString();
    const recordId = this.makeMasteryRecordId(userId, input.scopeType, input.scopeId);
    const existing = this.masteryProfiles.get(recordId);
    const currentSkills = existing?.skills ?? DEFAULT_SKILLS;
    const delta = input.delta ?? {};
    const skills: UserSkills = {
      Facts: clampSkill(currentSkills.Facts + (delta.Facts ?? 0)),
      Inference: clampSkill(currentSkills.Inference + (delta.Inference ?? 0)),
      Tone: clampSkill(currentSkills.Tone + (delta.Tone ?? 0)),
      Argument: clampSkill(currentSkills.Argument + (delta.Argument ?? 0)),
    };
    const record: MasteryProfileRecord = {
      recordId,
      userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      skills,
      exp: Math.max(0, (existing?.exp ?? 0) + (delta.exp ?? 0)),
      totalAnswers: Math.max(0, (existing?.totalAnswers ?? 0) + (delta.totalAnswers ?? 0)),
      depthOfUnderstanding: computeDepth(skills),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.indexMasteryProfile(record);
    await this.persistRecord('mastery_profile', record.recordId, record);
    return record;
  }

  listMastery(userId: string, scopeType?: MasteryScopeType, scopeId?: string): MasteryProfileRecord[] {
    return Array.from(this.masteryProfiles.values())
      .filter((profile) => profile.userId === userId)
      .filter((profile) => scopeType === undefined || profile.scopeType === scopeType)
      .filter((profile) => scopeId === undefined || profile.scopeId === scopeId)
      .sort((left, right) => {
        const scopeDelta = left.scopeType.localeCompare(right.scopeType);
        if (scopeDelta !== 0) return scopeDelta;
        return (left.scopeId ?? '').localeCompare(right.scopeId ?? '');
      });
  }

  async createQuizAttempt(userId: string, input: CreateQuizAttemptInput): Promise<QuizAttemptRecord> {
    const timestamp = new Date().toISOString();
    const attemptId = randomId('qat');
    const record: QuizAttemptRecord = {
      recordId: attemptId,
      attemptId,
      userId,
      documentId: input.documentId,
      chapterId: input.chapterId,
      score: input.score,
      total: input.total,
      answers: input.answers,
      skillBreakdown: input.skillBreakdown,
      createdAt: timestamp,
    };

    this.indexQuizAttempt(record);
    await this.persistRecord('quiz_attempt', record.recordId, record);
    if (input.skillBreakdown && this.sumSkillCounts(input.skillBreakdown) > 0) {
      await this.applyQuizSkillBreakdown(userId, input.documentId, input.chapterId, input.skillBreakdown);
    }
    return record;
  }

  listQuizAttempts(userId: string, filters: { documentId?: string; chapterId?: string }): QuizAttemptRecord[] {
    return Array.from(this.quizAttemptIdsByUser.get(userId) ?? [])
      .map((recordId) => this.quizAttempts.get(recordId))
      .filter((record): record is QuizAttemptRecord => Boolean(record))
      .filter((record) => filters.documentId === undefined || record.documentId === filters.documentId)
      .filter((record) => filters.chapterId === undefined || record.chapterId === filters.chapterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async upsertAnnotation(userId: string, input: UpsertAnnotationInput): Promise<AnnotationRecord> {
    const timestamp = new Date().toISOString();
    const annotationId = input.annotationId ?? randomId('ann');
    const recordId = this.makeAnnotationRecordId(userId, annotationId);
    const existing = this.annotations.get(recordId);
    const record: AnnotationRecord = {
      recordId,
      annotationId,
      userId,
      documentId: input.documentId,
      targetType: input.targetType,
      targetId: input.targetId,
      kind: input.kind,
      text: input.text,
      color: input.color,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.indexAnnotation(record);
    await this.persistRecord('annotation', record.recordId, record);
    return record;
  }

  listAnnotations(userId: string, filters: {
    documentId?: string;
    targetType?: string;
    kind?: string;
  }): AnnotationRecord[] {
    return Array.from(this.annotationIdsByUser.get(userId) ?? [])
      .map((recordId) => this.annotations.get(recordId))
      .filter((record): record is AnnotationRecord => Boolean(record))
      .filter((record) => filters.documentId === undefined || record.documentId === filters.documentId)
      .filter((record) => filters.targetType === undefined || record.targetType === filters.targetType)
      .filter((record) => filters.kind === undefined || record.kind === filters.kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async applyQuizSkillBreakdown(
    userId: string,
    documentId: string,
    chapterId: string | undefined,
    skillBreakdown: Partial<UserSkills>,
  ): Promise<void> {
    const correctCount = this.sumSkillCounts(skillBreakdown);
    const delta = {
      Facts: (skillBreakdown.Facts ?? 0) * 10,
      Inference: (skillBreakdown.Inference ?? 0) * 10,
      Tone: (skillBreakdown.Tone ?? 0) * 10,
      Argument: (skillBreakdown.Argument ?? 0) * 10,
      exp: correctCount * 50,
      totalAnswers: correctCount,
    };

    await this.patchMastery(userId, { scopeType: 'global', delta });
    await this.patchMastery(userId, { scopeType: 'document', scopeId: documentId, delta });
    if (chapterId) {
      await this.patchMastery(userId, { scopeType: 'chapter', scopeId: `${documentId}:${chapterId}`, delta });
    }
  }

  private sumSkillCounts(skills: Partial<UserSkills>): number {
    return (skills.Facts ?? 0) + (skills.Inference ?? 0) + (skills.Tone ?? 0) + (skills.Argument ?? 0);
  }

  private clear(): void {
    this.users.clear();
    this.devices.clear();
    this.deviceRecordIdsByDeviceId.clear();
    this.documents.clear();
    this.documentIdsByUser.clear();
    this.progresses.clear();
    this.progressIdsByUserDocument.clear();
    this.masteryProfiles.clear();
    this.masteryIdsByScope.clear();
    this.quizAttempts.clear();
    this.quizAttemptIdsByUser.clear();
    this.annotations.clear();
    this.annotationIdsByUser.clear();
  }

  private indexUser(record: AppUserRecord): void {
    this.users.set(record.userId, record);
  }

  private indexDevice(record: UserDeviceRecord): void {
    this.devices.set(record.recordId, record);
    this.deviceRecordIdsByDeviceId.set(record.deviceId, record.recordId);
  }

  private indexDocument(record: UserDocumentRecord): void {
    this.documents.set(record.recordId, record);
    this.addToSet(this.documentIdsByUser, record.userId, record.recordId);
  }

  private indexProgress(record: ReadingProgressRecord): void {
    this.progresses.set(record.recordId, record);
    this.progressIdsByUserDocument.set(`${record.userId}:${record.documentId}`, record.recordId);
  }

  private indexMasteryProfile(record: MasteryProfileRecord): void {
    this.masteryProfiles.set(record.recordId, record);
    this.masteryIdsByScope.set(this.masteryScopeKey(record.userId, record.scopeType, record.scopeId), record.recordId);
  }

  private indexQuizAttempt(record: QuizAttemptRecord): void {
    this.quizAttempts.set(record.recordId, record);
    this.addToSet(this.quizAttemptIdsByUser, record.userId, record.recordId);
  }

  private indexAnnotation(record: AnnotationRecord): void {
    this.annotations.set(record.recordId, record);
    this.addToSet(this.annotationIdsByUser, record.userId, record.recordId);
  }

  private addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
    const current = map.get(key) ?? new Set<string>();
    current.add(value);
    map.set(key, current);
  }

  private makeDeviceRecordId(deviceId: string): string {
    return `device_${hashSegment(deviceId)}`;
  }

  private makeGeneratedDocumentId(userId: string, input: UpsertUserDocumentInput): string {
    return `doc_${hashSegment([
      userId,
      input.sourceType,
      input.contentHash ?? '',
      input.url ?? '',
      input.title,
    ].join('|'))}`;
  }

  private makeUserDocumentRecordId(userId: string, documentId: string): string {
    return `user_doc_${hashSegment(`${userId}|${documentId}`)}`;
  }

  private makeProgressRecordId(userId: string, documentId: string): string {
    return `progress_${hashSegment(`${userId}|${documentId}`)}`;
  }

  private makeMasteryRecordId(userId: string, scopeType: MasteryScopeType, scopeId?: string): string {
    return `mastery_${hashSegment(this.masteryScopeKey(userId, scopeType, scopeId))}`;
  }

  private masteryScopeKey(userId: string, scopeType: MasteryScopeType, scopeId?: string): string {
    return `${userId}|${scopeType}|${scopeId ?? ''}`;
  }

  private makeAnnotationRecordId(userId: string, annotationId: string): string {
    return `annotation_${hashSegment(`${userId}|${annotationId}`)}`;
  }

  private sortStrings(values: string[]): string[] {
    return values.sort((left, right) => left.localeCompare(right));
  }

  private async persistRecord(table: PersistTable, id: string, record: object): Promise<void> {
    if (!this.surrealService) return;
    await this.surrealService.putRecord(table, id, record);
  }
}
