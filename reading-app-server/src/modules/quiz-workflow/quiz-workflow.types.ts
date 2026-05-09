export type QuizWorkflowKind = 'quiz_generation';

export type QuizWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stale';

export type QuizWorkflowProducer = 'server';
export type QuizWorkflowQualityTier = 'server_final';
export type QuizWorkflowQuestionType =
  | 'multiple_choice'
  | 'true_false_not_given'
  | 'short_answer'
  | 'fill_in_blank';
export type QuizWorkflowSkill = 'Facts' | 'Inference' | 'Tone' | 'Argument';
export type QuizWorkflowSourceUnitType = 'idea' | 'event' | 'theme' | 'person' | 'entity';

export interface QuizWorkflowPageRef {
  pageIndex: number;
  pageNumber?: number;
}

export interface QuizWorkflowQuestionBase {
  id: string;
  type: QuizWorkflowQuestionType;
  question: string;
  explanation: string;
  skill: QuizWorkflowSkill;
  sourceUnitId?: string;
  sourceUnitType?: QuizWorkflowSourceUnitType;
  sourcePageRefs?: QuizWorkflowPageRef[];
}

export interface QuizWorkflowMultipleChoiceQuestion extends QuizWorkflowQuestionBase {
  type: 'multiple_choice';
  options: [string, string, string, string];
  correctAnswerIndex: number;
}

export interface QuizWorkflowTrueFalseNotGivenQuestion extends QuizWorkflowQuestionBase {
  type: 'true_false_not_given';
  options: ['True', 'False', 'Not Given'];
  correctAnswerIndex: 0 | 1 | 2;
}

export interface QuizWorkflowShortAnswerQuestion extends QuizWorkflowQuestionBase {
  type: 'short_answer';
  acceptableAnswers: [string, ...string[]];
  answerGuidance?: string;
}

export interface QuizWorkflowFillInBlankQuestion extends QuizWorkflowQuestionBase {
  type: 'fill_in_blank';
  options: [string, string, string, string];
  correctAnswerIndex: number;
  blankHint?: string;
  acceptableAnswers?: [string, ...string[]];
}

export type QuizWorkflowQuestion =
  | QuizWorkflowMultipleChoiceQuestion
  | QuizWorkflowTrueFalseNotGivenQuestion
  | QuizWorkflowShortAnswerQuestion
  | QuizWorkflowFillInBlankQuestion;

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
