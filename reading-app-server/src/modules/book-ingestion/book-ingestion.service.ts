import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import type {
  GetBookModelResponseDto,
} from './book-model.dto';
import type {
  GetChapterResponseDto,
  GetPageResponseDto,
  UpsertBookChapterBatchPageDto,
  UpsertBookChapterBatchRequestDto,
  UpsertBookChapterBatchResponseDto,
  UpsertBookPageFragmentParamsDto,
  UpsertBookPageFragmentRequestDto,
  UpsertBookPageFragmentResponseDto,
} from './book-ingestion.dto';
import { bookIngestionLog } from './book-ingestion.logger';
import { BookIngestionRepository } from './book-ingestion.repository';
import { config } from '../../config/runtime-config';
import { KnowledgeExtractionWorkflowRepository } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.service';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

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
  private readonly knowledgeExtractionWorkflowRepository?: KnowledgeExtractionWorkflowRepository;

  constructor(
    @Inject(BookIngestionRepository) repository: BookIngestionRepository,
    @Optional()
    @Inject(forwardRef(() => KnowledgeExtractionWorkflowService))
    knowledgeExtractionWorkflowService?: KnowledgeExtractionWorkflowService,
    @Optional()
    @Inject(forwardRef(() => KnowledgeExtractionWorkflowRepository))
    knowledgeExtractionWorkflowRepository?: KnowledgeExtractionWorkflowRepository,
  ) {
    this.repository = repository;
    this.knowledgeExtractionWorkflowService = knowledgeExtractionWorkflowService;
    this.knowledgeExtractionWorkflowRepository = knowledgeExtractionWorkflowRepository;
  }

  parseUpsertRequest(
    rawBody: string | undefined,
    params: UpsertBookPageFragmentParamsDto,
  ): UpsertBookPageFragmentRequestDto {
    const parsed = this.parseJsonObjectBody(rawBody, {
      bookId: params.bookId,
      chapterId: params.chapterId,
      pageIndex: params.pageIndex,
    });

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
    const bookIngestionCompleted = parsed.bookIngestionCompleted === undefined
      ? undefined
      : this.requireBoolean(parsed.bookIngestionCompleted, 'bookIngestionCompleted');

    bookIngestionLog('request.parsed', {
      bookId,
      chapterId,
      chapterIndex,
      chapterTitle,
      pageIndex,
      sourceHash,
      paragraphCount: Object.keys(pageParagraphs).length,
      hasBookMetadata: bookMetadata !== undefined,
      bookIngestionCompleted,
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
      bookIngestionCompleted,
    };
  }

  parseBatchUpsertRequest(
    rawBody: string | undefined,
    params: Pick<UpsertBookPageFragmentParamsDto, 'bookId' | 'chapterId'>,
  ): UpsertBookChapterBatchRequestDto {
    const parsed = this.parseJsonObjectBody(rawBody, {
      bookId: params.bookId,
      chapterId: params.chapterId,
    });

    const bookId = this.requireString(parsed.bookId, 'bookId');
    const chapterId = this.requireString(parsed.chapterId, 'chapterId');
    const chapterIndex = coerceNonNegativeInteger(parsed.chapterIndex, 'chapterIndex');

    if (params.bookId !== bookId) {
      bookIngestionLog('batch.request.parse_failed', {
        reason: 'book_id_mismatch',
        pathBookId: params.bookId,
        bodyBookId: bookId,
        chapterId,
      });
      throw new BadRequestException('Path bookId does not match body bookId');
    }
    if (params.chapterId !== chapterId) {
      bookIngestionLog('batch.request.parse_failed', {
        reason: 'chapter_id_mismatch',
        bookId,
        pathChapterId: params.chapterId,
        bodyChapterId: chapterId,
      });
      throw new BadRequestException('Path chapterId does not match body chapterId');
    }
    if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
      bookIngestionLog('batch.request.parse_failed', {
        reason: 'invalid_pages',
        bookId,
        chapterId,
      });
      throw new BadRequestException('pages must be a non-empty array');
    }

    const pages = parsed.pages.map((page, index) => this.parseBatchPage(page, index));

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
    const chapterIngestionCompleted = parsed.chapterIngestionCompleted === undefined
      ? undefined
      : this.requireBoolean(parsed.chapterIngestionCompleted, 'chapterIngestionCompleted');
    const bookIngestionCompleted = parsed.bookIngestionCompleted === undefined
      ? undefined
      : this.requireBoolean(parsed.bookIngestionCompleted, 'bookIngestionCompleted');

    bookIngestionLog('batch.request.parsed', {
      bookId,
      chapterId,
      chapterIndex,
      chapterTitle,
      pageCount: pages.length,
      pageIndices: pages.map((page) => page.pageIndex),
      hasBookMetadata: bookMetadata !== undefined,
      chapterIngestionCompleted,
      bookIngestionCompleted,
    });

    return {
      bookId,
      chapterId,
      chapterIndex,
      chapterTitle,
      pages,
      bookMetadata,
      chapterIngestionCompleted,
      bookIngestionCompleted,
    };
  }

  upsertPageFragment(
    input: UpsertBookPageFragmentRequestDto,
  ): UpsertBookPageFragmentResponseDto {
    return this.upsertPageFragmentInternal(input, true);
  }

  upsertChapterBatch(
    input: UpsertBookChapterBatchRequestDto,
  ): UpsertBookChapterBatchResponseDto {
    const orderedPages = [...input.pages].sort((left, right) => left.pageIndex - right.pageIndex);
    let lastResponse: UpsertBookPageFragmentResponseDto | null = null;
    let anyChanged = false;

    for (const page of orderedPages) {
      lastResponse = this.upsertPageFragmentInternal({
        bookId: input.bookId,
        chapterId: input.chapterId,
        chapterIndex: input.chapterIndex,
        chapterTitle: input.chapterTitle,
        pageIndex: page.pageIndex,
        sourceHash: page.sourceHash,
        pageParagraphs: page.pageParagraphs,
        bookMetadata: input.bookMetadata,
      }, false);
      anyChanged ||= !lastResponse.deduped;
    }

    if (!lastResponse) {
      throw new BadRequestException('pages must be a non-empty array');
    }

    if (
      config.autoSubmitKnowledgeExtractionWorkflow
      && anyChanged
      && lastResponse.chapterTextAvailable
      && input.bookIngestionCompleted === true
      && this.knowledgeExtractionWorkflowService
    ) {
      void this.submitKnowledgeExtractionWorkflowAfterBookIngestion(lastResponse.bookId);
    }

    bookIngestionLog('batch.upsert_completed', {
      bookId: lastResponse.bookId,
      chapterId: lastResponse.chapterId,
      chapterIndex: lastResponse.chapterIndex,
      pageCount: orderedPages.length,
      pageIndices: orderedPages.map((page) => page.pageIndex),
      deduped: !anyChanged,
      snapshotVersion: lastResponse.snapshotVersion,
      pageCountInChapter: lastResponse.pageCountInChapter,
      chapterContentHash: lastResponse.chapterContentHash,
      chapterTextAvailable: lastResponse.chapterTextAvailable,
      bookIngestionCompleted: input.bookIngestionCompleted === true,
    });

    return {
      bookId: lastResponse.bookId,
      chapterId: lastResponse.chapterId,
      chapterIndex: lastResponse.chapterIndex,
      deduped: !anyChanged,
      snapshotVersion: lastResponse.snapshotVersion,
      chapterContentHash: lastResponse.chapterContentHash,
      pageCountInChapter: lastResponse.pageCountInChapter,
      chapterTextAvailable: lastResponse.chapterTextAvailable,
    };
  }

  private upsertPageFragmentInternal(
    input: UpsertBookPageFragmentRequestDto,
    allowAutoSubmit: boolean,
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
      allowAutoSubmit
      &&
      config.autoSubmitKnowledgeExtractionWorkflow
      && !result.deduped
      && chapterTextAvailable
      && input.bookIngestionCompleted === true
      && this.knowledgeExtractionWorkflowService
    ) {
      void this.submitKnowledgeExtractionWorkflowAfterBookIngestion(result.book.bookId);
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

  private async submitKnowledgeExtractionWorkflowAfterBookIngestion(bookId: string): Promise<void> {
    try {
      const book = this.repository.getBook(bookId);
      if (!book) {
        return;
      }

      const chapters = Array.from(book.chapters.values())
        .filter((chapter) => chapter.chapterTextMaterialized.trim().length > 0)
        .sort((left, right) => {
          const chapterDelta = left.chapterIndex - right.chapterIndex;
          if (chapterDelta !== 0) return chapterDelta;
          return left.chapterId.localeCompare(right.chapterId);
        });

      bookIngestionLog('knowledge_extraction_workflow.auto_submit_started', {
        bookId: book.bookId,
        snapshotVersion: book.snapshotVersion,
        chapterCount: chapters.length,
      });

      let submittedCount = 0;
      let failedCount = 0;
      for (const chapter of chapters) {
        try {
          const response = this.knowledgeExtractionWorkflowService?.submitKnowledgeExtractionWorkflow({
            bookId: book.bookId,
            chapterId: chapter.chapterId,
            chapterIndex: chapter.chapterIndex,
            workflowVersion: 'v1',
            expectedSnapshotVersion: book.snapshotVersion,
            expectedChapterContentHash: chapter.chapterContentHash,
          });
          submittedCount += 1;

          bookIngestionLog('knowledge_extraction_workflow.auto_submitted', {
            bookId: book.bookId,
            chapterId: chapter.chapterId,
            chapterIndex: chapter.chapterIndex,
            snapshotVersion: book.snapshotVersion,
            chapterContentHash: chapter.chapterContentHash,
            workflowRunId: response?.workflowRunId,
            deduped: response?.deduped,
          });
        } catch (error) {
          failedCount += 1;
          bookIngestionLog('knowledge_extraction_workflow.auto_submit_chapter_failed', {
            bookId: book.bookId,
            chapterId: chapter.chapterId,
            chapterIndex: chapter.chapterIndex,
            snapshotVersion: book.snapshotVersion,
            chapterContentHash: chapter.chapterContentHash,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      bookIngestionLog('knowledge_extraction_workflow.auto_submit_finished', {
        bookId: book.bookId,
        snapshotVersion: book.snapshotVersion,
        chapterCount: chapters.length,
        submittedCount,
        failedCount,
      });
    } catch (error) {
      bookIngestionLog('knowledge_extraction_workflow.auto_submit_failed', {
        bookId,
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

  async getBookModel(bookId: string): Promise<GetBookModelResponseDto> {
    const book = this.repository.getBook(bookId);
    if (!book) {
      bookIngestionLog('book_model.read_miss', { bookId });
      throw new NotFoundException('Book not found');
    }

    const chapters = Array.from(book.chapters.values())
      .sort((left, right) => {
        const chapterDelta = left.chapterIndex - right.chapterIndex;
        if (chapterDelta !== 0) return chapterDelta;
        return left.chapterId.localeCompare(right.chapterId);
      });

    const chapterSnapshots = await Promise.all(chapters.map(async (chapter) => {
      const latestResult = this.knowledgeExtractionWorkflowRepository?.getLatestResult(bookId, chapter.chapterId);
      const snapshot = (
        latestResult
        && latestResult.snapshotVersion === book.snapshotVersion
        && latestResult.chapterContentHash === chapter.chapterContentHash
      )
        ? latestResult.result
        : this.knowledgeExtractionWorkflowRepository
          ? await this.knowledgeExtractionWorkflowRepository.buildChapterSnapshot(bookId, chapter.chapterId)
          : {
            title: chapter.chapterTitle ?? `Chapter ${chapter.chapterIndex}`,
            summary: '',
            people: [],
            ideas: [],
            events: [],
            entities: [],
            themes: [],
            relations: [],
          };

      return {
        chapterId: chapter.chapterId,
        chapterIndex: chapter.chapterIndex,
        snapshotVersion: book.snapshotVersion,
        chapterContentHash: chapter.chapterContentHash,
        title: chapter.chapterTitle ?? snapshot.title,
        summary: snapshot.summary || undefined,
        people: snapshot.people.map((person) => ({
          localId: person.local_id,
          name: person.name,
          aliases: person.aliases ?? [],
          description: person.description,
          roles: person.roles ?? [],
          traits: person.traits ?? [],
          evidence: (person.evidence ?? []).map((evidence) => ({
            chapterIndex: chapter.chapterIndex,
            chapterId: chapter.chapterId,
            pageIndex: evidence.pageIndex,
            pageNumber: evidence.pageNumber,
            quote: evidence.quote,
          })),
        })),
        ideas: snapshot.ideas.map((idea) => ({
          localId: idea.local_id,
          label: idea.label,
          description: idea.description,
          kind: idea.kind,
          evidence: (idea.evidence ?? []).map((evidence) => ({
            chapterIndex: chapter.chapterIndex,
            chapterId: chapter.chapterId,
            pageIndex: evidence.pageIndex,
            pageNumber: evidence.pageNumber,
            quote: evidence.quote,
          })),
        })),
        events: snapshot.events.map((event) => ({
          localId: event.local_id,
          label: event.label,
          description: event.description,
          participantLocalIds: event.participant_local_ids ?? [],
          timeHint: event.time_hint,
          placeHint: event.place_hint,
          evidence: (event.evidence ?? []).map((evidence) => ({
            chapterIndex: chapter.chapterIndex,
            chapterId: chapter.chapterId,
            pageIndex: evidence.pageIndex,
            pageNumber: evidence.pageNumber,
            quote: evidence.quote,
          })),
        })),
        entities: snapshot.entities.map((entity) => ({
          localId: entity.local_id,
          label: entity.label,
          type: entity.type,
          description: entity.description,
          evidence: (entity.evidence ?? []).map((evidence) => ({
            chapterIndex: chapter.chapterIndex,
            chapterId: chapter.chapterId,
            pageIndex: evidence.pageIndex,
            pageNumber: evidence.pageNumber,
            quote: evidence.quote,
          })),
        })),
        themes: snapshot.themes.map((theme) => ({
          localId: theme.local_id,
          label: theme.label,
          strength: theme.strength,
          description: theme.description,
          evidence: (theme.evidence ?? []).map((evidence) => ({
            chapterIndex: chapter.chapterIndex,
            chapterId: chapter.chapterId,
            pageIndex: evidence.pageIndex,
            pageNumber: evidence.pageNumber,
            quote: evidence.quote,
          })),
        })),
        relations: snapshot.relations.map((relation) => ({
          localId: relation.local_id,
          fromId: relation.from_id,
          fromType: relation.from_type,
          toId: relation.to_id,
          toType: relation.to_type,
          relationType: relation.relation_type,
          description: relation.description,
          confidence: relation.confidence,
          evidence: (relation.evidence ?? []).map((evidence) => ({
            chapterIndex: chapter.chapterIndex,
            chapterId: chapter.chapterId,
            pageIndex: evidence.pageIndex,
            pageNumber: evidence.pageNumber,
            quote: evidence.quote,
          })),
        })),
        createdAt: chapter.createdAt,
      };
    }));

    const keyInformation = this.knowledgeExtractionWorkflowRepository?.buildBookKeyInformation(bookId) ?? {
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
      arcs: [],
      ideaFlows: [],
      links: [],
    };

    const metadata = book.bookMetadata ?? {};
    const title = typeof metadata.title === 'string' && metadata.title.trim()
      ? metadata.title.trim()
      : undefined;
    const author = typeof metadata.author === 'string' && metadata.author.trim()
      ? metadata.author.trim()
      : undefined;
    const language = typeof metadata.language === 'string' && metadata.language.trim()
      ? metadata.language.trim()
      : undefined;

    bookIngestionLog('book_model.read_hit', {
      bookId,
      snapshotVersion: book.snapshotVersion,
      chapterCount: chapterSnapshots.length,
      globalPeopleCount: keyInformation.people.length,
      globalIdeaCount: keyInformation.ideas.length,
      globalEventCount: keyInformation.events.length,
      globalEntityCount: keyInformation.entities.length,
      globalThemeCount: keyInformation.themes.length,
      globalRelationCount: keyInformation.relations.length,
    });

    return {
      bookId,
      meta: {
        title,
        author,
        language,
        totalChapters: chapterSnapshots.length,
        createdAt: book.createdAt,
        updatedAt: book.updatedAt,
      },
      chapters: chapterSnapshots,
      keyInformation,
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

  private parseJsonObjectBody(
    rawBody: string | undefined,
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!rawBody || rawBody.trim() === '') {
      bookIngestionLog('request.parse_failed', {
        reason: 'empty_body',
        ...context,
      });
      throw new BadRequestException('Request body cannot be empty');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      bookIngestionLog('request.parse_failed', {
        reason: 'invalid_json',
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(parsed)) {
      bookIngestionLog('request.parse_failed', {
        reason: 'non_object_body',
        ...context,
      });
      throw new BadRequestException('Request body must be a JSON object');
    }

    return parsed;
  }

  private parseBatchPage(value: unknown, index: number): UpsertBookChapterBatchPageDto {
    if (!isPlainObject(value)) {
      throw new BadRequestException(`pages.${index} must be an object`);
    }

    const pageIndex = coerceNonNegativeInteger(value.pageIndex, `pages.${index}.pageIndex`);
    const sourceHash = this.requireString(value.sourceHash, `pages.${index}.sourceHash`);

    if (!isPlainObject(value.pageParagraphs) || Object.keys(value.pageParagraphs).length === 0) {
      throw new BadRequestException(`pages.${index}.pageParagraphs must be a non-empty object`);
    }

    const pageParagraphs = Object.fromEntries(
      Object.entries(value.pageParagraphs).map(([key, paragraphValue]) => {
        if (!isNonEmptyString(paragraphValue)) {
          throw new BadRequestException(`pages.${index}.pageParagraphs.${key} must be a non-empty string`);
        }
        return [key, paragraphValue];
      }),
    );

    return {
      pageIndex,
      sourceHash,
      pageParagraphs,
    };
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

  private requireBoolean(value: unknown, fieldName: string): boolean {
    if (!isBoolean(value)) {
      throw new BadRequestException(`${fieldName} must be a boolean when provided`);
    }
    return value;
  }
}
