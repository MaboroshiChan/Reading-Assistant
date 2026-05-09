import type {
  AnnotationKind,
  MasteryScopeType,
  UserClient,
  UserSkills,
} from './users.types';

export interface CreateAnonymousUserRequestDto {
  deviceId: string;
  client: UserClient;
  displayName?: string;
}

export interface AnonymousUserResponseDto {
  userId: string;
  deviceId: string;
  type: 'anonymous';
  createdAt: string;
  lastSeenAt: string;
}

export interface UpsertUserDocumentRequestDto {
  documentId?: string;
  sourceType: string;
  title: string;
  author?: string;
  url?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface PatchReadingProgressRequestDto {
  chapterId?: string;
  paragraphId?: string;
  sentenceId?: string;
  scrollPercent?: number;
  completedParagraphIds?: string[];
}

export interface PatchMasteryRequestDto {
  scopeType: MasteryScopeType;
  scopeId?: string;
  delta?: Partial<UserSkills> & {
    exp?: number;
    totalAnswers?: number;
  };
}

export interface CreateQuizAttemptRequestDto {
  documentId: string;
  chapterId?: string;
  score: number;
  total: number;
  answers: unknown[];
  skillBreakdown?: Partial<UserSkills>;
}

export interface UpsertAnnotationRequestDto {
  annotationId?: string;
  documentId: string;
  targetType: string;
  targetId: string;
  kind: AnnotationKind;
  text?: string;
  color?: string;
}
