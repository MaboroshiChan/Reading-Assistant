import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type {
  GetChapterOpenAnalysisResultResponseDto,
  GetChapterOpenAnalysisStatusResponseDto,
  SubmitChapterOpenAnalysisResponseDto,
} from './chapter-open-analysis.dto';
import { ChapterOpenAnalysisService } from './chapter-open-analysis.service';

@Controller('v1')
export class ChapterOpenAnalysisController {
  constructor(
    @Inject(ChapterOpenAnalysisService)
    private readonly chapterOpenAnalysisService: ChapterOpenAnalysisService,
  ) {}

  @Post('books/:bookId/chapters/:chapterId/open-analysis')
  submitChapterOpenAnalysis(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
    @Body() rawBody: string | undefined,
  ): SubmitChapterOpenAnalysisResponseDto {
    const request = this.chapterOpenAnalysisService.parseSubmitRequest(bookId, chapterId, rawBody);
    return this.chapterOpenAnalysisService.submitChapterOpenAnalysis(request);
  }

  @Get('books/:bookId/chapters/:chapterId/open-analysis')
  getChapterOpenAnalysisStatus(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): GetChapterOpenAnalysisStatusResponseDto {
    return this.chapterOpenAnalysisService.getChapterOpenAnalysisStatus(bookId, chapterId);
  }

  @Get('books/:bookId/chapters/:chapterId/open-analysis/result')
  getChapterOpenAnalysisResult(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): GetChapterOpenAnalysisResultResponseDto {
    return this.chapterOpenAnalysisService.getChapterOpenAnalysisResult(bookId, chapterId);
  }
}
