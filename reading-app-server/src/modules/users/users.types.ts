export type UserClient = 'ios' | 'web' | 'extension';
export type UserType = 'anonymous';
export type MasteryScopeType = 'global' | 'document' | 'chapter';
export type AnnotationKind = 'note' | 'bookmark' | 'highlight';

export interface UserSkills {
  Facts: number;
  Inference: number;
  Tone: number;
  Argument: number;
}

export interface AppUserRecord {
  recordId: string;
  userId: string;
  type: UserType;
  displayName?: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface UserDeviceRecord {
  recordId: string;
  deviceId: string;
  userId: string;
  client: UserClient;
  createdAt: string;
  lastSeenAt: string;
}

export interface UserDocumentRecord {
  recordId: string;
  userId: string;
  documentId: string;
  sourceType: string;
  title: string;
  author?: string;
  url?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastReadAt: string;
}

export interface ReadingProgressRecord {
  recordId: string;
  userId: string;
  documentId: string;
  chapterId?: string;
  paragraphId?: string;
  sentenceId?: string;
  scrollPercent?: number;
  completedParagraphIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MasteryProfileRecord {
  recordId: string;
  userId: string;
  scopeType: MasteryScopeType;
  scopeId?: string;
  skills: UserSkills;
  exp: number;
  totalAnswers: number;
  depthOfUnderstanding: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuizAttemptRecord {
  recordId: string;
  attemptId: string;
  userId: string;
  documentId: string;
  chapterId?: string;
  score: number;
  total: number;
  answers: unknown[];
  skillBreakdown?: Partial<UserSkills>;
  createdAt: string;
}

export interface AnnotationRecord {
  recordId: string;
  annotationId: string;
  userId: string;
  documentId: string;
  targetType: string;
  targetId: string;
  kind: AnnotationKind;
  text?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnonymousUserInput {
  deviceId: string;
  client: UserClient;
  displayName?: string;
}

export interface UpsertUserDocumentInput {
  documentId?: string;
  sourceType: string;
  title: string;
  author?: string;
  url?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface PatchReadingProgressInput {
  chapterId?: string;
  paragraphId?: string;
  sentenceId?: string;
  scrollPercent?: number;
  completedParagraphIds?: string[];
}

export interface PatchMasteryInput {
  scopeType: MasteryScopeType;
  scopeId?: string;
  delta?: Partial<UserSkills> & {
    exp?: number;
    totalAnswers?: number;
  };
}

export interface CreateQuizAttemptInput {
  documentId: string;
  chapterId?: string;
  score: number;
  total: number;
  answers: unknown[];
  skillBreakdown?: Partial<UserSkills>;
}

export interface UpsertAnnotationInput {
  annotationId?: string;
  documentId: string;
  targetType: string;
  targetId: string;
  kind: AnnotationKind;
  text?: string;
  color?: string;
}
