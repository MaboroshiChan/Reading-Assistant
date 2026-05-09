import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { BookIngestionRepository } from './book-ingestion.repository';
import type {
  BookContextBundle,
  BookContextChapterRef,
  BookContextChapterSummary,
  ChapterContextBundle,
  ChapterPageRef,
  PageWindowContext,
  PageWindowEntry,
} from './book-context.types';
import { KnowledgeExtractionWorkflowRepository } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.repository';

const asOptionalTrimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

@Injectable()
export class BookContextService {
  private readonly repository: BookIngestionRepository;
  private readonly knowledgeExtractionWorkflowRepository?: KnowledgeExtractionWorkflowRepository;

  constructor(
    @Inject(BookIngestionRepository) repository: BookIngestionRepository,
    @Optional()
    @Inject(forwardRef(() => KnowledgeExtractionWorkflowRepository))
    knowledgeExtractionWorkflowRepository?: KnowledgeExtractionWorkflowRepository,
  ) {
    this.repository = repository;
    this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
  }

  buildBookContextBundle(bookId: string, currentChapterId: string): BookContextBundle | null {
    const book = this.repository.getBook(bookId);
    const currentChapter = this.repository.getChapter(bookId, currentChapterId);
    if (!book || !currentChapter) return null;

    const sortedChapters = Array.from(book.chapters.values()).sort((left, right) => {
      const delta = left.chapterIndex - right.chapterIndex;
      if (delta !== 0) return delta;
      return left.chapterId.localeCompare(right.chapterId);
    });

    const metadata = book.bookMetadata ?? {};
    const chapters = sortedChapters.map<BookContextChapterRef>((chapter) => ({
      chapterId: chapter.chapterId,
      chapterIndex: chapter.chapterIndex,
      title: chapter.chapterTitle,
    }));
    const priorChapterSummaries = sortedChapters
      .filter((chapter) => this.isBeforeCurrentChapter(chapter.chapterIndex, chapter.chapterId, currentChapter))
      .map<BookContextChapterSummary | null>((chapter) => {
        const summary = this.knowledgeExtractionWorkflowRepository
          ?.getLatestResult(bookId, chapter.chapterId)
          ?.result.summary
          ?.trim();
        if (!summary) return null;
        return {
          chapterId: chapter.chapterId,
          chapterIndex: chapter.chapterIndex,
          title: chapter.chapterTitle,
          summary,
        };
      })
      .filter((entry): entry is BookContextChapterSummary => entry !== null);

    return {
      bookId,
      snapshotVersion: book.snapshotVersion,
      title: asOptionalTrimmedString(metadata.title),
      author: asOptionalTrimmedString(metadata.author),
      language: asOptionalTrimmedString(metadata.language),
      chapters,
      priorChapterSummaries,
      currentChapterPages: this.toChapterPageRefs(bookId, currentChapterId),
    };
  }

  buildChapterContextBundle(bookId: string, chapterId: string): ChapterContextBundle | null {
    const chapter = this.repository.getChapter(bookId, chapterId);
    if (!chapter) return null;

    const chapterSummary = this.knowledgeExtractionWorkflowRepository
      ?.getLatestResult(bookId, chapterId)
      ?.result.summary
      ?.trim();

    return {
      chapterId,
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      chapterSummary: chapterSummary || undefined,
      pages: this.toChapterPageRefs(bookId, chapterId),
    };
  }

  buildPageWindowContext(bookId: string, chapterId: string, pageIndex: number): PageWindowContext | null {
    const chapter = this.repository.getChapter(bookId, chapterId);
    const currentPage = this.repository.getPage(bookId, chapterId, pageIndex);
    if (!chapter || !currentPage) return null;

    const previousPage = this.repository.getPage(bookId, chapterId, pageIndex - 1);
    const nextPage = this.repository.getPage(bookId, chapterId, pageIndex + 1);

    return {
      radius: 1,
      previous: previousPage ? this.toPageWindowEntry(pageIndex - 1, previousPage.sourceHash, previousPage.pageTextMaterialized) : undefined,
      current: this.toPageWindowEntry(pageIndex, currentPage.sourceHash, currentPage.pageTextMaterialized),
      next: nextPage ? this.toPageWindowEntry(pageIndex + 1, nextPage.sourceHash, nextPage.pageTextMaterialized) : undefined,
    };
  }

  private toChapterPageRefs(bookId: string, chapterId: string): ChapterPageRef[] {
    const chapter = this.repository.getChapter(bookId, chapterId);
    if (!chapter) return [];
    return Array.from(chapter.pages.values())
      .sort((left, right) => left.pageIndex - right.pageIndex)
      .map((page) => ({
        pageIndex: page.pageIndex,
        pageNumber: page.pageIndex + 1,
        sourceHash: page.sourceHash,
      }));
  }

  private toPageWindowEntry(pageIndex: number, sourceHash: string, text: string): PageWindowEntry {
    return {
      pageIndex,
      pageNumber: pageIndex + 1,
      sourceHash,
      text,
    };
  }

  private isBeforeCurrentChapter(
    chapterIndex: number,
    chapterId: string,
    currentChapter: { chapterIndex: number; chapterId: string },
  ): boolean {
    if (chapterIndex !== currentChapter.chapterIndex) {
      return chapterIndex < currentChapter.chapterIndex;
    }
    return chapterId.localeCompare(currentChapter.chapterId) < 0;
  }
}
