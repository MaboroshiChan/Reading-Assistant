export interface CanonicalPageRecord {
  pageIndex: number;
  sourceHash: string;
  pageParagraphs: Record<string, string>;
  pageTextMaterialized: string;
  paragraphHashes: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalChapterRecord {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  ownerUserId?: string;
  pages: Map<number, CanonicalPageRecord>;
  chapterTextMaterialized: string;
  chapterContentHash: string;
  updatedAt: string;
}

export interface CanonicalBookRecord {
  bookId: string;
  ownerUserId?: string;
  bookMetadata?: Record<string, unknown>;
  snapshotVersion: number;
  updatedAt: string;
  chapters: Map<string, CanonicalChapterRecord>;
}

export interface UpsertPageFragmentInput {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  pageIndex: number;
  sourceHash: string;
  pageParagraphs: Record<string, string>;
  bookMetadata?: Record<string, unknown>;
}

export interface UpsertPageFragmentResult {
  book: CanonicalBookRecord;
  chapter: CanonicalChapterRecord;
  page: CanonicalPageRecord;
  deduped: boolean;
}
