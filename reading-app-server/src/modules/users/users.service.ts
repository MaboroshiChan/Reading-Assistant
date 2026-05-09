import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AnonymousUserResponseDto,
  CreateAnonymousUserRequestDto,
  CreateQuizAttemptRequestDto,
  PatchMasteryRequestDto,
  PatchReadingProgressRequestDto,
  UpsertAnnotationRequestDto,
  UpsertUserDocumentRequestDto,
} from './users.dto';
import { UsersRepository } from './users.repository';
import type {
  AnnotationKind,
  AnnotationRecord,
  AppUserRecord,
  MasteryProfileRecord,
  MasteryScopeType,
  QuizAttemptRecord,
  ReadingProgressRecord,
  UserClient,
  UserDocumentRecord,
  UserSkills,
} from './users.types';

const VALID_CLIENTS = new Set<UserClient>(['ios', 'web', 'extension']);
const VALID_SCOPE_TYPES = new Set<MasteryScopeType>(['global', 'document', 'chapter']);
const VALID_ANNOTATION_KINDS = new Set<AnnotationKind>(['note', 'bookmark', 'highlight']);
const SKILL_KEYS: Array<keyof UserSkills> = ['Facts', 'Inference', 'Tone', 'Argument'];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository)
    private readonly usersRepository: UsersRepository,
  ) {}

  parseCreateAnonymousUserRequest(rawBody: string | undefined): CreateAnonymousUserRequestDto {
    const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
    const client = this.requireEnum(parsed.client, 'client', VALID_CLIENTS);
    return {
      deviceId: this.requireString(parsed.deviceId, 'deviceId'),
      client,
      displayName: this.optionalString(parsed.displayName, 'displayName'),
    };
  }

  async createOrRestoreAnonymousUser(input: CreateAnonymousUserRequestDto): Promise<AnonymousUserResponseDto> {
    const result = await this.usersRepository.createOrRestoreAnonymousUser(input);
    return {
      userId: result.user.userId,
      deviceId: result.device.deviceId,
      type: result.user.type,
      createdAt: result.user.createdAt,
      lastSeenAt: result.user.lastSeenAt,
    };
  }

  getUser(userId: string): AppUserRecord {
    return this.requireUser(userId);
  }

  parseUpsertDocumentRequest(rawBody: string | undefined): UpsertUserDocumentRequestDto {
    const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
    return {
      documentId: this.optionalString(parsed.documentId, 'documentId'),
      sourceType: this.requireString(parsed.sourceType, 'sourceType'),
      title: this.requireString(parsed.title, 'title'),
      author: this.optionalString(parsed.author, 'author'),
      url: this.optionalString(parsed.url, 'url'),
      contentHash: this.optionalString(parsed.contentHash, 'contentHash'),
      metadata: this.optionalObject(parsed.metadata, 'metadata'),
    };
  }

  async upsertDocument(userId: string, input: UpsertUserDocumentRequestDto): Promise<UserDocumentRecord> {
    this.requireUser(userId);
    return this.usersRepository.upsertDocument(userId, input);
  }

  listDocuments(userId: string): UserDocumentRecord[] {
    this.requireUser(userId);
    return this.usersRepository.listDocuments(userId);
  }

  parsePatchProgressRequest(rawBody: string | undefined): PatchReadingProgressRequestDto {
    const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
    return {
      chapterId: this.optionalString(parsed.chapterId, 'chapterId'),
      paragraphId: this.optionalString(parsed.paragraphId, 'paragraphId'),
      sentenceId: this.optionalString(parsed.sentenceId, 'sentenceId'),
      scrollPercent: this.optionalPercent(parsed.scrollPercent, 'scrollPercent'),
      completedParagraphIds: this.optionalStringArray(parsed.completedParagraphIds, 'completedParagraphIds'),
    };
  }

  async patchProgress(
    userId: string,
    documentId: string,
    input: PatchReadingProgressRequestDto,
  ): Promise<ReadingProgressRecord> {
    this.requireUser(userId);
    this.requireDocument(userId, documentId);
    return this.usersRepository.patchProgress(userId, documentId, input);
  }

  getProgress(userId: string, documentId: string): ReadingProgressRecord {
    this.requireUser(userId);
    this.requireDocument(userId, documentId);
    return this.usersRepository.getProgress(userId, documentId);
  }

  parsePatchMasteryRequest(rawBody: string | undefined): PatchMasteryRequestDto {
    const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
    const scopeType = this.requireEnum(parsed.scopeType, 'scopeType', VALID_SCOPE_TYPES);
    const scopeId = this.optionalString(parsed.scopeId, 'scopeId');
    if (scopeType !== 'global' && !scopeId) {
      throw new BadRequestException('scopeId is required for document and chapter mastery scopes');
    }

    let delta: PatchMasteryRequestDto['delta'];
    if (parsed.delta !== undefined) {
      if (!isPlainObject(parsed.delta)) {
        throw new BadRequestException('delta must be a JSON object when provided');
      }
      delta = {};
      for (const key of SKILL_KEYS) {
        const value = parsed.delta[key];
        if (value !== undefined) delta[key] = this.requireNumber(value, `delta.${key}`);
      }
      if (parsed.delta.exp !== undefined) delta.exp = this.requireNumber(parsed.delta.exp, 'delta.exp');
      if (parsed.delta.totalAnswers !== undefined) {
        delta.totalAnswers = this.requireNumber(parsed.delta.totalAnswers, 'delta.totalAnswers');
      }
    }

    return { scopeType, scopeId, delta };
  }

  async patchMastery(userId: string, input: PatchMasteryRequestDto): Promise<MasteryProfileRecord> {
    this.requireUser(userId);
    return this.usersRepository.patchMastery(userId, input);
  }

  listMastery(userId: string, rawScopeType?: string, rawScopeId?: string): MasteryProfileRecord[] {
    this.requireUser(userId);
    const scopeType = rawScopeType === undefined || rawScopeType.trim() === ''
      ? undefined
      : this.requireEnum(rawScopeType, 'scopeType', VALID_SCOPE_TYPES);
    const scopeId = rawScopeId === undefined || rawScopeId.trim() === '' ? undefined : rawScopeId;
    return this.usersRepository.listMastery(userId, scopeType, scopeId);
  }

  parseCreateQuizAttemptRequest(rawBody: string | undefined): CreateQuizAttemptRequestDto {
    const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
    const score = this.requireNumber(parsed.score, 'score');
    const total = this.requireNumber(parsed.total, 'total');
    if (!Number.isInteger(score) || score < 0) {
      throw new BadRequestException('score must be a non-negative integer');
    }
    if (!Number.isInteger(total) || total < 0) {
      throw new BadRequestException('total must be a non-negative integer');
    }
    if (score > total) {
      throw new BadRequestException('score cannot be greater than total');
    }
    if (!Array.isArray(parsed.answers)) {
      throw new BadRequestException('answers must be an array');
    }

    return {
      documentId: this.requireString(parsed.documentId, 'documentId'),
      chapterId: this.optionalString(parsed.chapterId, 'chapterId'),
      score,
      total,
      answers: parsed.answers,
      skillBreakdown: this.optionalSkillBreakdown(parsed.skillBreakdown),
    };
  }

  async createQuizAttempt(userId: string, input: CreateQuizAttemptRequestDto): Promise<QuizAttemptRecord> {
    this.requireUser(userId);
    this.requireDocument(userId, input.documentId);
    return this.usersRepository.createQuizAttempt(userId, input);
  }

  listQuizAttempts(userId: string, documentId?: string, chapterId?: string): QuizAttemptRecord[] {
    this.requireUser(userId);
    return this.usersRepository.listQuizAttempts(userId, {
      documentId: documentId && documentId.trim() !== '' ? documentId : undefined,
      chapterId: chapterId && chapterId.trim() !== '' ? chapterId : undefined,
    });
  }

  parseUpsertAnnotationRequest(rawBody: string | undefined): UpsertAnnotationRequestDto {
    const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
    return {
      annotationId: this.optionalString(parsed.annotationId, 'annotationId'),
      documentId: this.requireString(parsed.documentId, 'documentId'),
      targetType: this.requireString(parsed.targetType, 'targetType'),
      targetId: this.requireString(parsed.targetId, 'targetId'),
      kind: this.requireEnum(parsed.kind, 'kind', VALID_ANNOTATION_KINDS),
      text: this.optionalString(parsed.text, 'text'),
      color: this.optionalString(parsed.color, 'color'),
    };
  }

  async upsertAnnotation(userId: string, input: UpsertAnnotationRequestDto): Promise<AnnotationRecord> {
    this.requireUser(userId);
    this.requireDocument(userId, input.documentId);
    return this.usersRepository.upsertAnnotation(userId, input);
  }

  listAnnotations(
    userId: string,
    filters: { documentId?: string; targetType?: string; kind?: string },
  ): AnnotationRecord[] {
    this.requireUser(userId);
    return this.usersRepository.listAnnotations(userId, {
      documentId: filters.documentId && filters.documentId.trim() !== '' ? filters.documentId : undefined,
      targetType: filters.targetType && filters.targetType.trim() !== '' ? filters.targetType : undefined,
      kind: filters.kind && filters.kind.trim() !== '' ? filters.kind : undefined,
    });
  }

  private requireUser(userId: string): AppUserRecord {
    const user = this.usersRepository.getUser(userId);
    if (!user) {
      throw new NotFoundException(`User not found: ${userId}`);
    }
    return user;
  }

  private requireDocument(userId: string, documentId: string): UserDocumentRecord {
    const document = this.usersRepository.getDocument(userId, documentId);
    if (!document) {
      throw new NotFoundException(`Document not found for user: ${documentId}`);
    }
    return document;
  }

  private parseBody(rawBody: string | undefined, emptyMessage: string): Record<string, unknown> {
    if (!rawBody || rawBody.trim() === '') {
      throw new BadRequestException(emptyMessage);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(parsed)) {
      throw new BadRequestException('Request body must be a JSON object');
    }
    return parsed;
  }

  private requireString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  }

  private optionalString(value: unknown, fieldName: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    return this.requireString(value, fieldName);
  }

  private optionalObject(value: unknown, fieldName: string): Record<string, unknown> | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isPlainObject(value)) {
      throw new BadRequestException(`${fieldName} must be a JSON object when provided`);
    }
    return { ...value };
  }

  private requireEnum<T extends string>(value: unknown, fieldName: string, allowed: Set<T>): T {
    const text = this.requireString(value, fieldName);
    if (!allowed.has(text as T)) {
      throw new BadRequestException(`${fieldName} must be one of: ${Array.from(allowed).join(', ')}`);
    }
    return text as T;
  }

  private requireNumber(value: unknown, fieldName: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`${fieldName} must be a finite number`);
    }
    return value;
  }

  private optionalPercent(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    const numberValue = this.requireNumber(value, fieldName);
    if (numberValue < 0 || numberValue > 100) {
      throw new BadRequestException(`${fieldName} must be between 0 and 100`);
    }
    return numberValue;
  }

  private optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an array`);
    }
    return value.map((entry, index) => this.requireString(entry, `${fieldName}.${index}`));
  }

  private optionalSkillBreakdown(value: unknown): Partial<UserSkills> | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isPlainObject(value)) {
      throw new BadRequestException('skillBreakdown must be a JSON object when provided');
    }
    const result: Partial<UserSkills> = {};
    for (const key of SKILL_KEYS) {
      if (value[key] === undefined) continue;
      const numberValue = this.requireNumber(value[key], `skillBreakdown.${key}`);
      if (!Number.isInteger(numberValue) || numberValue < 0) {
        throw new BadRequestException(`skillBreakdown.${key} must be a non-negative integer`);
      }
      result[key] = numberValue;
    }
    return result;
  }
}
