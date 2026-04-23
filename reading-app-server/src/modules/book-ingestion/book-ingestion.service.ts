import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  GetChapterResponseDto,
  GetPageResponseDto,
  UpsertBookPageFragmentParamsDto,
  UpsertBookPageFragmentRequestDto,
  UpsertBookPageFragmentResponseDto,
} from './book-ingestion.dto';
import { BookIngestionRepository } from './book-ingestion.repository';

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

  constructor(@Inject(BookIngestionRepository) repository: BookIngestionRepository) {
    this.repository = repository;
  }

  parseUpsertRequest(
    rawBody: string | undefined,
    params: UpsertBookPageFragmentParamsDto,
  ): UpsertBookPageFragmentRequestDto {
    if (!rawBody || rawBody.trim() === '') {
      throw new BadRequestException('Request body cannot be empty');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(parsed)) {
      throw new BadRequestException('Request body must be a JSON object');
    }

    const bookId = this.requireString(parsed.bookId, 'bookId');
    const chapterId = this.requireString(parsed.chapterId, 'chapterId');
    const sourceHash = this.requireString(parsed.sourceHash, 'sourceHash');
    const chapterIndex = coerceNonNegativeInteger(parsed.chapterIndex, 'chapterIndex');
    const pageIndex = coerceNonNegativeInteger(parsed.pageIndex, 'pageIndex');

    if (params.bookId !== bookId) {
      throw new BadRequestException('Path bookId does not match body bookId');
    }
    if (params.chapterId !== chapterId) {
      throw new BadRequestException('Path chapterId does not match body chapterId');
    }
    if (params.pageIndex !== pageIndex) {
      throw new BadRequestException('Path pageIndex does not match body pageIndex');
    }

    if (!isPlainObject(parsed.pageParagraphs) || Object.keys(parsed.pageParagraphs).length === 0) {
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
      chapterTextAvailable: result.chapter.chapterTextMaterialized.trim().length > 0,
    };
  }

  getChapter(bookId: string, chapterId: string): GetChapterResponseDto {
    const chapter = this.repository.getChapter(bookId, chapterId);
    const book = this.repository.getBook(bookId);

    if (!chapter || !book) {
      throw new NotFoundException('Chapter not found');
    }

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
      throw new NotFoundException('Page not found');
    }

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
