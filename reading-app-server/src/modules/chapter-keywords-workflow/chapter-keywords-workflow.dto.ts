import type {
  ChapterKeywordsWorkflowCheckpoint,
  ChapterKeywordsWorkflowErrorInfo,
  ChapterKeywordsWorkflowQualityTier,
  ChapterKeywordsWorkflowRestartMode,
  ChapterKeywordsWorkflowResultPayload,
  ChapterKeywordsWorkflowStatus,
} from './chapter-keywords-workflow.types';

export interface SubmitChapterKeywordsWorkflowRequestDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface SubmitChapterKeywordsWorkflowResponseDto {
  workflowRunId: string;
  kind: 'chapter_keywords';
  status: ChapterKeywordsWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  producer: 'server';
  qualityTier: ChapterKeywordsWorkflowQualityTier;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  deduped: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: ChapterKeywordsWorkflowErrorInfo;
}

export interface GetChapterKeywordsWorkflowStatusResponseDto {
  workflowRunId: string;
  kind: 'chapter_keywords';
  status: ChapterKeywordsWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  producer: 'server';
  qualityTier: ChapterKeywordsWorkflowQualityTier;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultAvailable: boolean;
  error?: ChapterKeywordsWorkflowErrorInfo;
  checkpoint?: ChapterKeywordsWorkflowCheckpoint;
}

export interface RestartChapterKeywordsWorkflowRequestDto {
  mode?: ChapterKeywordsWorkflowRestartMode;
}

export interface RestartChapterKeywordsWorkflowResponseDto
  extends GetChapterKeywordsWorkflowStatusResponseDto {
  restartMode: ChapterKeywordsWorkflowRestartMode;
}

export interface GetChapterKeywordsWorkflowResultResponseDto {
  workflowRunId: string;
  kind: 'chapter_keywords';
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: 'server';
  qualityTier: ChapterKeywordsWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  createdAt: string;
  updatedAt: string;
  result: ChapterKeywordsWorkflowResultPayload;
}

export interface GetLatestChapterKeywordsResponseDto {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: 'server';
  qualityTier: ChapterKeywordsWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  updatedAt: string;
  result: ChapterKeywordsWorkflowResultPayload;
}
