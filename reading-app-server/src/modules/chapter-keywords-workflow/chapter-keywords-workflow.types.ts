import type {
  AnalyzeChapterKeywordsData,
  ChunkKeySentence,
} from '../../../../packages/contracts/src';

export type ChapterKeywordsWorkflowKind = 'chapter_keywords';

export type ChapterKeywordsWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stale';

export type ChapterKeywordsWorkflowProducer = 'server';
export type ChapterKeywordsWorkflowQualityTier = 'server_final';
export type ChapterKeywordsWorkflowResultPayload = AnalyzeChapterKeywordsData;
export type ChapterKeywordsWorkflowRestartMode = 'resume' | 'from_start';

export interface SubmitChapterKeywordsWorkflowInput {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface ChapterKeywordsWorkflowErrorInfo {
  code: string;
  message: string;
}

export interface ChapterKeywordsWorkflowCheckpoint {
  totalChunks: number;
  lastCompletedChunkIndex: number;
  nextChunkIndex: number;
  updatedAt: string;
}

export interface ChapterKeywordsWorkflowPartialChunkResult {
  chunkIndex: number;
  keySentences: ChunkKeySentence[];
}

export interface ChapterKeywordsWorkflowRunRecord {
  id: string;
  kind: ChapterKeywordsWorkflowKind;
  status: ChapterKeywordsWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  producer: ChapterKeywordsWorkflowProducer;
  qualityTier: ChapterKeywordsWorkflowQualityTier;
  requestedByUserId?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  deduped: boolean;
  resultVersion: string;
  output?: ChapterKeywordsWorkflowResultPayload;
  error?: ChapterKeywordsWorkflowErrorInfo;
  checkpoint?: ChapterKeywordsWorkflowCheckpoint;
  partialChunkResults?: ChapterKeywordsWorkflowPartialChunkResult[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
}

export interface ChapterKeywordsWorkflowStoredResult {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: ChapterKeywordsWorkflowProducer;
  qualityTier: ChapterKeywordsWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  result: ChapterKeywordsWorkflowResultPayload;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterKeywordsWorkflowPersistedRunRecord
  extends ChapterKeywordsWorkflowRunRecord {}
