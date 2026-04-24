import type {
  KnowledgeExtractionWorkflowErrorInfo,
  KnowledgeExtractionWorkflowQualityTier,
  KnowledgeExtractionWorkflowResultPayload,
  KnowledgeExtractionWorkflowStatus,
} from './knowledge-extraction-workflow.types';

export interface SubmitKnowledgeExtractionWorkflowRequestDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  idempotencyKey?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  requestedByUserId?: string;
}

export interface SubmitKnowledgeExtractionWorkflowResponseDto {
  workflowRunId: string;
  kind: 'knowledge_extraction';
  status: KnowledgeExtractionWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  producer: 'server';
  qualityTier: KnowledgeExtractionWorkflowQualityTier;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  deduped: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: KnowledgeExtractionWorkflowErrorInfo;
}

export interface GetKnowledgeExtractionWorkflowStatusResponseDto {
  workflowRunId: string;
  kind: 'knowledge_extraction';
  status: KnowledgeExtractionWorkflowStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  producer: 'server';
  qualityTier: KnowledgeExtractionWorkflowQualityTier;
  resultVersion: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultAvailable: boolean;
  error?: KnowledgeExtractionWorkflowErrorInfo;
}

export interface GetKnowledgeExtractionWorkflowResultResponseDto {
  workflowRunId: string;
  kind: 'knowledge_extraction';
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: 'server';
  qualityTier: KnowledgeExtractionWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  createdAt: string;
  updatedAt: string;
  result: KnowledgeExtractionWorkflowResultPayload;
}

export interface GetLatestChapterKnowledgeExtractionResponseDto {
  workflowRunId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  workflowVersion: string;
  resultVersion: string;
  producer: 'server';
  qualityTier: KnowledgeExtractionWorkflowQualityTier;
  snapshotVersion: number;
  chapterContentHash: string;
  updatedAt: string;
  result: KnowledgeExtractionWorkflowResultPayload;
}
