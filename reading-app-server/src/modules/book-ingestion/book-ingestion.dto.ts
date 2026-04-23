export interface UpsertBookPageFragmentParamsDto {
  bookId: string;
  chapterId: string;
  pageIndex: number;
}

export interface UpsertBookPageFragmentRequestDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  pageIndex: number;
  sourceHash: string;
  pageParagraphs: Record<string, string>;
  bookMetadata?: Record<string, unknown>;
}

export interface UpsertBookPageFragmentResponseDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  pageIndex: number;
  sourceHash: string;
  deduped: boolean;
  snapshotVersion: number;
  chapterContentHash: string;
  pageCountInChapter: number;
  chapterTextAvailable: boolean;
}

export interface GetChapterResponseDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  snapshotVersion: number;
  pageCount: number;
  chapterContentHash: string;
  chapterTextAvailable: boolean;
  updatedAt: string;
}

export interface GetPageResponseDto {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  pageIndex: number;
  sourceHash: string;
  pageParagraphs: Record<string, string>;
  pageTextMaterialized: string;
  paragraphHashes: Record<string, string>;
  snapshotVersion: number;
  updatedAt: string;
}
