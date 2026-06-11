import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type {
  GetChapterKeywordsWorkflowResultResponseDto,
  GetChapterKeywordsWorkflowStatusResponseDto,
  GetLatestChapterKeywordsResponseDto,
  SubmitChapterKeywordsWorkflowResponseDto,
} from './chapter-keywords-workflow.dto';
import { ChapterKeywordsWorkflowService } from './chapter-keywords-workflow.service';

@Controller('v1')
export class ChapterKeywordsWorkflowController {
  private readonly chapterKeywordsWorkflowService: ChapterKeywordsWorkflowService;

  constructor(
    @Inject(ChapterKeywordsWorkflowService)
    chapterKeywordsWorkflowService: ChapterKeywordsWorkflowService,
  ) {
    this.chapterKeywordsWorkflowService = chapterKeywordsWorkflowService;
  }

  @Post('workflows/chapter-keywords')
  submitChapterKeywordsWorkflow(
    @Body() rawBody: string | undefined,
  ): SubmitChapterKeywordsWorkflowResponseDto {
    const request = this.chapterKeywordsWorkflowService.parseSubmitRequest(rawBody);
    return this.chapterKeywordsWorkflowService.submitChapterKeywordsWorkflow(request);
  }

  @Get('workflows/chapter-keywords/:workflowRunId')
  getWorkflowStatus(
    @Param('workflowRunId') workflowRunId: string,
  ): GetChapterKeywordsWorkflowStatusResponseDto {
    return this.chapterKeywordsWorkflowService.getWorkflowStatus(workflowRunId);
  }

  @Get('workflows/chapter-keywords/:workflowRunId/result')
  getWorkflowResult(
    @Param('workflowRunId') workflowRunId: string,
  ): GetChapterKeywordsWorkflowResultResponseDto {
    return this.chapterKeywordsWorkflowService.getWorkflowResult(workflowRunId);
  }

  @Get('books/:bookId/chapters/:chapterId/chapter-keywords')
  getLatestChapterKeywords(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): GetLatestChapterKeywordsResponseDto {
    return this.chapterKeywordsWorkflowService.getLatestChapterKeywords(bookId, chapterId);
  }
}
