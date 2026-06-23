import type {
  AnalyzeKnowledgeExtractionData,
  AnalyzeKnowledgeExtractionGraphData,
  KnowledgePageRef,
} from '../../../../packages/contracts/src';

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

export interface KnowledgeExtractionWorkflowPersistedSummary {
  title: string;
  summary: string;
}

export type KnowledgeExtractionWorkflowPersistedResult =
  | KnowledgeExtractionWorkflowResultPayload
  | KnowledgeExtractionWorkflowPersistedSummary;

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

export interface KnowledgeExtractionWorkflowProgress {
  percent: number;
  stage?: string;
  message?: string;
}

export type KnowledgeExtractionWorkflowRestartMode = 'resume' | 'from_start';

export interface KnowledgeExtractionWorkflowCheckpoint {
  totalPieces: number;
  lastCompletedPieceIndex: number;
  nextPieceIndex: number;
  nextPrimaryPageIndex?: number;
  nextPrimaryPageNumber?: number;
  updatedAt: string;
}

export interface KnowledgeExtractionWorkflowPartialPieceResult {
  pieceIndex: number;
  pageIndex: number;
  pageNumber: number;
  sourceHash: string;
  pageRefs: KnowledgePageRef[];
  extraction: AnalyzeKnowledgeExtractionGraphData;
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
  progress?: KnowledgeExtractionWorkflowProgress;
  checkpoint?: KnowledgeExtractionWorkflowCheckpoint;
  partialPieceResults?: KnowledgeExtractionWorkflowPartialPieceResult[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
}

export interface KnowledgeExtractionWorkflowPersistedRunRecord
  extends Omit<KnowledgeExtractionWorkflowRunRecord, 'output'> {
  output?: KnowledgeExtractionWorkflowPersistedResult;
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

export interface KnowledgeExtractionWorkflowPersistedStoredResult
  extends Omit<KnowledgeExtractionWorkflowStoredResult, 'result'> {
  result: KnowledgeExtractionWorkflowPersistedResult;
}

export interface PageExtractionCacheRecord {
  cacheKey: string;
  bookId: string;
  chapterId: string;
  pageIndex: number;
  sourceHash: string;
  chapterContentHash: string;
  promptVersion: string;
  status: 'cached';
  nodeCount?: number;
  edgeCount?: number;
  evidenceCount?: number;
  responseHash?: string;
  createdAt: string;
  updatedAt: string;
  extraction?: AnalyzeKnowledgeExtractionGraphData;
}

export interface PageExtractionCacheValue {
  record: PageExtractionCacheRecord;
  extraction: AnalyzeKnowledgeExtractionGraphData;
}
