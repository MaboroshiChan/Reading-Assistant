export type PreReadingWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stale';

export interface PreReadingResultPayload {
  teaser?: string;
  pre_reading_questions?: string[];
}

export interface SubmitPreReadingWorkflowInput {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface PreReadingWorkflowErrorInfo {
  code: string;
  message: string;
}

export interface PreReadingWorkflowRunRecord {
  id: string;
  kind: 'pre_reading_generation';
  status: PreReadingWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  resultVersion: string;
  output?: PreReadingResultPayload;
  error?: PreReadingWorkflowErrorInfo;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PreReadingWorkflowStoredResult {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  snapshotVersion: number;
  chapterContentHash: string;
  result: PreReadingResultPayload;
  createdAt: string;
  updatedAt: string;
}
