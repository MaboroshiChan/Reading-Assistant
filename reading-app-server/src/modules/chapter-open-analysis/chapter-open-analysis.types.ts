import type { AnalyzeChapterKeywordsData, AnalyzeKnowledgeExtractionData } from '../../../../packages/contracts/src';
import type { QuizWorkflowResultPayload } from '../quiz-workflow/quiz-workflow.types';
import type { PreReadingResultPayload } from '../pre-reading-workflow/pre-reading-workflow.types';

export type ChapterOpenAnalysisKind = 'chapter_open_analysis';

export type ChapterOpenAnalysisStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'stale';

export type ChapterOpenAnalysisTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'stale';

export interface ChapterOpenAnalysisErrorInfo {
  code: string;
  message: string;
}

export interface ChapterOpenAnalysisTaskState {
  status: ChapterOpenAnalysisTaskStatus;
  workflowRunId?: string;
  blockedBy?: 'preReading' | 'knowledgeExtraction';
  error?: ChapterOpenAnalysisErrorInfo;
}

export interface ChapterOpenAnalysisProgress {
  percent?: number;
  stage?: string;
  message?: string;
}

export interface SubmitChapterOpenAnalysisInput {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  pipelineVersion: string;
  idempotencyKey: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  clientSessionId?: string;
  trigger?: string;
}

export interface ChapterOpenAnalysisRunRecord {
  id: string;
  kind: ChapterOpenAnalysisKind;
  status: ChapterOpenAnalysisStatus;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  pipelineVersion: string;
  idempotencyKey: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  snapshotVersion?: number;
  chapterContentHash?: string;
  clientSessionId?: string;
  trigger?: string;
  preReadingWorkflowRunId?: string;
  chapterKeywordsWorkflowRunId?: string;
  knowledgeExtractionWorkflowRunId?: string;
  quizWorkflowRunId?: string;
  error?: ChapterOpenAnalysisErrorInfo;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ChapterOpenAnalysisAggregateResult {
  preReading: PreReadingResultPayload | null;
  chapterKeywords: AnalyzeChapterKeywordsData | null;
  knowledgeExtraction: AnalyzeKnowledgeExtractionData | null;
  quiz: QuizWorkflowResultPayload | null;
}
