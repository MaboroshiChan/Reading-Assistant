import type {
  ChapterOpenAnalysisAggregateResult,
  ChapterOpenAnalysisErrorInfo,
  ChapterOpenAnalysisProgress,
  ChapterOpenAnalysisStatus,
  ChapterOpenAnalysisTaskState,
} from './chapter-open-analysis.types';

export interface SubmitChapterOpenAnalysisRequestDto {
  chapterIndex: number;
  pipelineVersion: string;
  idempotencyKey?: string;
  expectedSnapshotVersion?: number;
  expectedChapterContentHash?: string;
  clientSessionId?: string;
  trigger?: string;
}

export interface SubmitChapterOpenAnalysisResponseDto {
  chapterAnalysisRunId: string;
  status: ChapterOpenAnalysisStatus;
  deduped: boolean;
  pipelineVersion: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  snapshotVersion?: number;
  chapterContentHash?: string;
  tasks: {
    preReading: ChapterOpenAnalysisTaskState;
    chapterKeywords: ChapterOpenAnalysisTaskState;
    knowledgeExtraction: ChapterOpenAnalysisTaskState;
    quiz: ChapterOpenAnalysisTaskState;
  };
}

export interface GetChapterOpenAnalysisStatusResponseDto {
  chapterAnalysisRunId: string;
  status: ChapterOpenAnalysisStatus;
  pipelineVersion: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  snapshotVersion?: number;
  chapterContentHash?: string;
  tasks: {
    preReading: ChapterOpenAnalysisTaskState;
    chapterKeywords: ChapterOpenAnalysisTaskState;
    knowledgeExtraction: ChapterOpenAnalysisTaskState;
    quiz: ChapterOpenAnalysisTaskState;
  };
  progress?: ChapterOpenAnalysisProgress;
  error?: ChapterOpenAnalysisErrorInfo;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface GetChapterOpenAnalysisResultResponseDto {
  chapterAnalysisRunId: string;
  status: ChapterOpenAnalysisStatus;
  pipelineVersion: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  snapshotVersion?: number;
  chapterContentHash?: string;
  data: ChapterOpenAnalysisAggregateResult;
}
