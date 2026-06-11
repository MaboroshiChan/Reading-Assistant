import type {
  PreReadingResultPayload,
  PreReadingWorkflowErrorInfo,
  PreReadingWorkflowStatus,
} from './pre-reading-workflow.types';

export interface SubmitPreReadingWorkflowRequestDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface SubmitPreReadingWorkflowResponseDto {
  workflowRunId: string;
  kind: 'pre_reading_generation';
  status: PreReadingWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  deduped: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: PreReadingWorkflowErrorInfo;
}

export interface GetPreReadingWorkflowStatusResponseDto {
  workflowRunId: string;
  kind: 'pre_reading_generation';
  status: PreReadingWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultAvailable: boolean;
  error?: PreReadingWorkflowErrorInfo;
}

export interface GetPreReadingWorkflowResultResponseDto {
  workflowRunId: string;
  kind: 'pre_reading_generation';
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  snapshotVersion: number;
  chapterContentHash: string;
  createdAt: string;
  updatedAt: string;
  result: PreReadingResultPayload;
}

export interface GetLatestChapterPreReadingResponseDto {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  snapshotVersion: number;
  chapterContentHash: string;
  updatedAt: string;
  result: PreReadingResultPayload;
}
