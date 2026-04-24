export type QuizWorkflowKind = 'quiz_generation';

export type QuizWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stale';

export type QuizWorkflowProducer = 'server';
export type QuizWorkflowQualityTier = 'server_final';
export type QuizWorkflowQuestionType = 'multiple_choice';
export type QuizWorkflowSkill = 'Facts' | 'Inference' | 'Tone' | 'Argument';

export interface QuizWorkflowQuestion {
  id: string;
  type: QuizWorkflowQuestionType;
  question: string;
  options: [string, string, string, string];
  correctAnswerIndex: number;
  explanation: string;
  skill: QuizWorkflowSkill;
}

export interface QuizWorkflowResultPayload {
  questions: QuizWorkflowQuestion[];
}

export interface SubmitQuizWorkflowInput {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface QuizWorkflowErrorInfo {
  code: string;
  message: string;
}

export interface QuizWorkflowRunRecord {
  id: string;
  kind: QuizWorkflowKind;
  status: QuizWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  producer: QuizWorkflowProducer;
  qualityTier: QuizWorkflowQualityTier;
  requestedByUserId?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  deduped: boolean;
  resultVersion: string;
  output?: QuizWorkflowResultPayload;
  error?: QuizWorkflowErrorInfo;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface QuizWorkflowStoredResult {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: QuizWorkflowProducer;
  qualityTier: QuizWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  result: QuizWorkflowResultPayload;
  createdAt: string;
  updatedAt: string;
}
