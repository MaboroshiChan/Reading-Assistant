import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import type {
  GetChapterResponseDto,
  GetPageResponseDto,
  UpsertBookPageFragmentParamsDto,
  UpsertBookPageFragmentRequestDto,
  UpsertBookPageFragmentResponseDto,
} from './book-ingestion.dto';
import { bookIngestionLog } from './book-ingestion.logger';
import { BookIngestionRepository } from './book-ingestion.repository';
import { config } from '../../config/runtime-config';
import { KnowledgeExtractionWorkflowService } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.service';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const coerceNonNegativeInteger = (value: unknown, fieldName: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${fieldName} must be a non-negative integer`);
  }
  return value;
};

@Injectable()
export class BookIngestionService {
  private readonly repository: BookIngestionRepository;
  private readonly knowledgeExtractionWorkflowService?: KnowledgeExtractionWorkflowService;

  constructor(
    @Inject(BookIngestionRepository) repository: BookIngestionRepository,
    @Optional()
    @Inject(forwardRef(() => KnowledgeExtractionWorkflowService))
    knowledgeExtractionWorkflowService?: KnowledgeExtractionWorkflowService,
  ) {
    this.repository = repository;
    this.knowledgeExtractionWorkflowService = knowledgeExtractionWorkflowService;
  }

  parseUpsertRequest(
    rawBody: string | undefined,
    params: UpsertBookPageFragmentParamsDto,
  ): UpsertBookPageFragmentRequestDto {
    if (!rawBody || rawBody.trim() === '') {
      bookIngestionLog('request.parse_failed', {
        reason: 'empty_body',
        bookId: params.bookId,
        chapterId: params.chapterId,
        pageIndex: params.pageIndex,
      });
      throw new BadRequestException('Request body cannot be empty');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      bookIngestionLog('request.parse_failed', {
        reason: 'invalid_json',
        bookId: params.bookId,
        chapterId: params.chapterId,
        pageIndex: params.pageIndex,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(parsed)) {
      bookIngestionLog('request.parse_failed', {
        reason: 'non_object_body',
        bookId: params.bookId,
        chapterId: params.chapterId,
        pageIndex: params.pageIndex,
      });
      throw new BadRequestException('Request body must be a JSON object');
    }

    const bookId = this.requireString(parsed.bookId, 'bookId');
    const chapterId = this.requireString(parsed.chapterId, 'chapterId');
    const sourceHash = this.requireString(parsed.sourceHash, 'sourceHash');
    const chapterIndex = coerceNonNegativeInteger(parsed.chapterIndex, 'chapterIndex');
    const pageIndex = coerceNonNegativeInteger(parsed.pageIndex, 'pageIndex');

    if (params.bookId !== bookId) {
      bookIngestionLog('request.parse_failed', {
        reason: 'book_id_mismatch',
        pathBookId: params.bookId,
        bodyBookId: bookId,
        chapterId,
        pageIndex,
      });
      throw new BadRequestException('Path bookId does not match body bookId');
    }
    if (params.chapterId !== chapterId) {
      bookIngestionLog('request.parse_failed', {
        reason: 'chapter_id_mismatch',
        bookId,
        pathChapterId: params.chapterId,
        bodyChapterId: chapterId,
        pageIndex,
      });
      throw new BadRequestException('Path chapterId does not match body chapterId');
    }
    if (params.pageIndex !== pageIndex) {
      bookIngestionLog('request.parse_failed', {
        reason: 'page_index_mismatch',
        bookId,
        chapterId,
        pathPageIndex: params.pageIndex,
        bodyPageIndex: pageIndex,
      });
      throw new BadRequestException('Path pageIndex does not match body pageIndex');
    }

    if (!isPlainObject(parsed.pageParagraphs) || Object.keys(parsed.pageParagraphs).length === 0) {
      bookIngestionLog('request.parse_failed', {
        reason: 'invalid_page_paragraphs',
        bookId,
        chapterId,
        pageIndex,
      });
      throw new BadRequestException('pageParagraphs must be a non-empty object');
    }

    const pageParagraphs = Object.fromEntries(
      Object.entries(parsed.pageParagraphs).map(([key, value]) => {
        if (!isNonEmptyString(value)) {
          throw new BadRequestException(`pageParagraphs.${key} must be a non-empty string`);
        }
        return [key, value];
      }),
    );

    let bookMetadata: Record<string, unknown> | undefined;
    if (parsed.bookMetadata !== undefined) {
      if (!isPlainObject(parsed.bookMetadata)) {
        throw new BadRequestException('bookMetadata must be a JSON object when provided');
      }
      bookMetadata = { ...parsed.bookMetadata };
    }

    const chapterTitle = parsed.chapterTitle === undefined
      ? undefined
      : this.requireOptionalString(parsed.chapterTitle, 'chapterTitle');

    bookIngestionLog('request.parsed', {
      bookId,
      chapterId,
      chapterIndex,
      chapterTitle,
      pageIndex,
      sourceHash,
      paragraphCount: Object.keys(pageParagraphs).length,
      hasBookMetadata: bookMetadata !== undefined,
    });

    return {
      bookId,
      chapterId,
      chapterIndex,
      chapterTitle,
      pageIndex,
      sourceHash,
      pageParagraphs,
      bookMetadata,
    };
  }

  upsertPageFragment(
    input: UpsertBookPageFragmentRequestDto,
  ): UpsertBookPageFragmentResponseDto {
    const result = this.repository.upsertPageFragment(input);
    const chapterTextAvailable = result.chapter.chapterTextMaterialized.trim().length > 0;

    bookIngestionLog('page.upsert_completed', {
      bookId: result.book.bookId,
      chapterId: result.chapter.chapterId,
      chapterIndex: result.chapter.chapterIndex,
      pageIndex: result.page.pageIndex,
      sourceHash: result.page.sourceHash,
      deduped: result.deduped,
      snapshotVersion: result.book.snapshotVersion,
      pageCountInChapter: result.chapter.pages.size,
      chapterContentHash: result.chapter.chapterContentHash,
      chapterTextAvailable,
      pageTextLength: result.page.pageTextMaterialized.length,
    });

    if (
      config.autoSubmitKnowledgeExtractionWorkflow
      && !result.deduped
      && chapterTextAvailable
      && this.knowledgeExtractionWorkflowService
    ) {
      void this.submitKnowledgeExtractionWorkflowAfterIngestion(result);
    }

    return {
      bookId: result.book.bookId,
      chapterId: result.chapter.chapterId,
      chapterIndex: result.chapter.chapterIndex,
      pageIndex: result.page.pageIndex,
      sourceHash: result.page.sourceHash,
      deduped: result.deduped,
      snapshotVersion: result.book.snapshotVersion,
      chapterContentHash: result.chapter.chapterContentHash,
      pageCountInChapter: result.chapter.pages.size,
      chapterTextAvailable,
    };
  }

  private async submitKnowledgeExtractionWorkflowAfterIngestion(
    result: ReturnType<BookIngestionRepository['upsertPageFragment']>,
  ): Promise<void> {
    try {
      const response = this.knowledgeExtractionWorkflowService?.submitKnowledgeExtractionWorkflow({
        bookId: result.book.bookId,
        chapterId: result.chapter.chapterId,
        chapterIndex: result.chapter.chapterIndex,
        workflowVersion: 'v1',
        expectedSnapshotVersion: result.book.snapshotVersion,
        expectedChapterContentHash: result.chapter.chapterContentHash,
      });

      bookIngestionLog('knowledge_extraction_workflow.auto_submitted', {
        bookId: result.book.bookId,
        chapterId: result.chapter.chapterId,
        chapterIndex: result.chapter.chapterIndex,
        pageIndex: result.page.pageIndex,
        snapshotVersion: result.book.snapshotVersion,
        chapterContentHash: result.chapter.chapterContentHash,
        workflowRunId: response?.workflowRunId,
        deduped: response?.deduped,
      });
    } catch (error) {
      bookIngestionLog('knowledge_extraction_workflow.auto_submit_failed', {
        bookId: result.book.bookId,
        chapterId: result.chapter.chapterId,
        chapterIndex: result.chapter.chapterIndex,
        pageIndex: result.page.pageIndex,
        snapshotVersion: result.book.snapshotVersion,
        chapterContentHash: result.chapter.chapterContentHash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getChapter(bookId: string, chapterId: string): GetChapterResponseDto {
    const chapter = this.repository.getChapter(bookId, chapterId);
    const book = this.repository.getBook(bookId);

    if (!chapter || !book) {
      bookIngestionLog('chapter.read_miss', {
        bookId,
        chapterId,
      });
      throw new NotFoundException('Chapter not found');
    }

    bookIngestionLog('chapter.read_hit', {
      bookId,
      chapterId,
      chapterIndex: chapter.chapterIndex,
      snapshotVersion: book.snapshotVersion,
      pageCount: chapter.pages.size,
      chapterContentHash: chapter.chapterContentHash,
    });

    return {
      bookId,
      chapterId,
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      snapshotVersion: book.snapshotVersion,
      pageCount: chapter.pages.size,
      chapterContentHash: chapter.chapterContentHash,
      chapterTextAvailable: chapter.chapterTextMaterialized.trim().length > 0,
      updatedAt: chapter.updatedAt,
    };
  }

  getPage(bookId: string, chapterId: string, pageIndex: number): GetPageResponseDto {
    const chapter = this.repository.getChapter(bookId, chapterId);
    const page = this.repository.getPage(bookId, chapterId, pageIndex);
    const book = this.repository.getBook(bookId);

    if (!chapter || !page || !book) {
      bookIngestionLog('page.read_miss', {
        bookId,
        chapterId,
        pageIndex,
      });
      throw new NotFoundException('Page not found');
    }

    bookIngestionLog('page.read_hit', {
      bookId,
      chapterId,
      chapterIndex: chapter.chapterIndex,
      pageIndex,
      sourceHash: page.sourceHash,
      snapshotVersion: book.snapshotVersion,
      paragraphCount: Object.keys(page.pageParagraphs).length,
    });

    return {
      bookId,
      chapterId,
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      pageIndex,
      sourceHash: page.sourceHash,
      pageParagraphs: { ...page.pageParagraphs },
      pageTextMaterialized: page.pageTextMaterialized,
      paragraphHashes: { ...page.paragraphHashes },
      snapshotVersion: book.snapshotVersion,
      updatedAt: page.updatedAt,
    };
  }

  parsePageIndex(rawPageIndex: string): number {
    const parsed = Number(rawPageIndex);
    if (!Number.isInteger(parsed) || parsed < 0) {
      bookIngestionLog('request.parse_failed', {
        reason: 'invalid_page_index_param',
        rawPageIndex,
      });
      throw new BadRequestException('pageIndex must be a non-negative integer');
    }
    return parsed;
  }

  private requireString(value: unknown, fieldName: string): string {
    if (!isNonEmptyString(value)) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  }

  private requireOptionalString(value: unknown, fieldName: string): string {
    if (!isNonEmptyString(value)) {
      throw new BadRequestException(`${fieldName} must be a non-empty string when provided`);
    }
    return value.trim();
  }
}
