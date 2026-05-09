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

      for (const chapter of chapters) {
        const response = this.knowledgeExtractionWorkflowService?.submitKnowledgeExtractionWorkflow({
          bookId: book.bookId,
          chapterId: chapter.chapterId,
          chapterIndex: chapter.chapterIndex,
          workflowVersion: 'v1',
          expectedSnapshotVersion: book.snapshotVersion,
          expectedChapterContentHash: chapter.chapterContentHash,
        });

        bookIngestionLog('knowledge_extraction_workflow.auto_submitted', {
          bookId: book.bookId,
          chapterId: chapter.chapterId,
          chapterIndex: chapter.chapterIndex,
          snapshotVersion: book.snapshotVersion,
          chapterContentHash: chapter.chapterContentHash,
          workflowRunId: response?.workflowRunId,
          deduped: response?.deduped,
        });
      }
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
