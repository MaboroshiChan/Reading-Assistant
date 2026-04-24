import type {
  QuizWorkflowErrorInfo,
  QuizWorkflowQualityTier,
  QuizWorkflowResultPayload,
  QuizWorkflowStatus,
} from './quiz-workflow.types';

export interface SubmitQuizWorkflowRequestDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface SubmitQuizWorkflowResponseDto {
  workflowRunId: string;
  kind: 'quiz_generation';
  status: QuizWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  producer: 'server';
  qualityTier: QuizWorkflowQualityTier;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  deduped: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: QuizWorkflowErrorInfo;
}

export interface GetQuizWorkflowStatusResponseDto {
  workflowRunId: string;
  kind: 'quiz_generation';
  status: QuizWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  producer: 'server';
  qualityTier: QuizWorkflowQualityTier;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultAvailable: boolean;
  error?: QuizWorkflowErrorInfo;
}

export interface GetQuizWorkflowResultResponseDto {
  workflowRunId: string;
  kind: 'quiz_generation';
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: 'server';
  qualityTier: QuizWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  createdAt: string;
  updatedAt: string;
  result: QuizWorkflowResultPayload;
}

export interface GetLatestChapterQuizResponseDto {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: 'server';
  qualityTier: QuizWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  updatedAt: string;
  result: QuizWorkflowResultPayload;
}
