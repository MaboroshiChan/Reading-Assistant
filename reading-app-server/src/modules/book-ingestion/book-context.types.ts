export interface BookContextChapterRef {
  chapterId: string;
  chapterIndex: number;
  title?: string;
}

export interface BookContextChapterSummary extends BookContextChapterRef {
  summary: string;
}

export interface ChapterPageRef {
  pageIndex: number;
  pageNumber: number;
  sourceHash: string;
}

export interface PageWindowEntry extends ChapterPageRef {
  text: string;
}

export interface BookContextBundle {
  bookId: string;
  snapshotVersion: number;
  title?: string;
  author?: string;
  language?: string;
  chapters: BookContextChapterRef[];
  priorChapterSummaries: BookContextChapterSummary[];
  currentChapterPages: ChapterPageRef[];
}

export interface ChapterContextBundle {
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  chapterSummary?: string;
  pages: ChapterPageRef[];
}

export interface PageWindowContext {
  radius: 1;
  previous?: PageWindowEntry;
  current: PageWindowEntry;
  next?: PageWindowEntry;
}
