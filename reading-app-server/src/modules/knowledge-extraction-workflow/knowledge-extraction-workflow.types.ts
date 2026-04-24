import type { AnalyzeKnowledgeExtractionData } from '../../../../packages/contracts/src';

export type KnowledgeExtractionWorkflowKind = 'knowledge_extraction';

export type KnowledgeExtractionWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stale';

export type KnowledgeExtractionWorkflowProducer = 'server';
export type KnowledgeExtractionWorkflowQualityTier = 'server_final';
export type KnowledgeExtractionWorkflowResultPayload = AnalyzeKnowledgeExtractionData;

export interface SubmitKnowledgeExtractionWorkflowInput {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface KnowledgeExtractionWorkflowErrorInfo {
  code: string;
  message: string;
}

export interface KnowledgeExtractionWorkflowRunRecord {
  id: string;
  kind: KnowledgeExtractionWorkflowKind;
  status: KnowledgeExtractionWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey: string;
  producer: KnowledgeExtractionWorkflowProducer;
  qualityTier: KnowledgeExtractionWorkflowQualityTier;
  requestedByUserId?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  deduped: boolean;
  resultVersion: string;
  output?: KnowledgeExtractionWorkflowResultPayload;
  error?: KnowledgeExtractionWorkflowErrorInfo;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
}

export interface KnowledgeExtractionWorkflowStoredResult {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: KnowledgeExtractionWorkflowProducer;
  qualityTier: KnowledgeExtractionWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  result: KnowledgeExtractionWorkflowResultPayload;
  createdAt: string;
  updatedAt: string;
}
