import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import type {
  GetChapterResponseDto,
  GetPageResponseDto,
  UpsertBookPageFragmentParamsDto,
  UpsertBookPageFragmentResponseDto,
} from './book-ingestion.dto';
import { BookIngestionService } from './book-ingestion.service';

@Controller('v1/books')
export class BookIngestionController {
  private readonly bookIngestionService: BookIngestionService;

  constructor(@Inject(BookIngestionService) bookIngestionService: BookIngestionService) {
    this.bookIngestionService = bookIngestionService;
  }

  @Post(':bookId/chapters/:chapterId/pages/:pageIndex')
  upsertPageFragment(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
    @Param('pageIndex') rawPageIndex: string,
    @Body() rawBody: string | undefined,
  ): UpsertBookPageFragmentResponseDto {
    const params: UpsertBookPageFragmentParamsDto = {
      bookId,
      chapterId,
      pageIndex: this.bookIngestionService.parsePageIndex(rawPageIndex),
    };
    const request = this.bookIngestionService.parseUpsertRequest(rawBody, params);
    return this.bookIngestionService.upsertPageFragment(request);
  }

  @Get(':bookId/chapters/:chapterId')
  getChapter(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): GetChapterResponseDto {
    return this.bookIngestionService.getChapter(bookId, chapterId);
  }

  @Get(':bookId/chapters/:chapterId/pages/:pageIndex')
  getPage(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
    @Param('pageIndex') rawPageIndex: string,
  ): GetPageResponseDto {
    return this.bookIngestionService.getPage(
      bookId,
      chapterId,
      this.bookIngestionService.parsePageIndex(rawPageIndex),
    );
  }
}
