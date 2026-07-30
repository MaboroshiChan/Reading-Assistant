import { Controller, Get, GoneException, Post } from '@nestjs/common';
import type {
  GetChapterKeywordsWorkflowResultResponseDto,
  GetChapterKeywordsWorkflowStatusResponseDto,
  GetLatestChapterKeywordsResponseDto,
  RestartChapterKeywordsWorkflowResponseDto,
  SubmitChapterKeywordsWorkflowResponseDto,
} from './chapter-keywords-workflow.dto';

@Controller('v1')
export class ChapterKeywordsWorkflowController {
  private static readonly disabledMessage =
    'Chapter key sentence and key word generation moved to iOS local Foundation Models.';

  @Post('workflows/chapter-keywords')
  submitChapterKeywordsWorkflow(): SubmitChapterKeywordsWorkflowResponseDto {
    throw this.featureDisabled();
  }

  @Get('workflows/chapter-keywords/:workflowRunId')
  getWorkflowStatus(
  ): GetChapterKeywordsWorkflowStatusResponseDto {
    throw this.featureDisabled();
  }

  @Get('workflows/chapter-keywords/:workflowRunId/result')
  getWorkflowResult(
  ): GetChapterKeywordsWorkflowResultResponseDto {
    throw this.featureDisabled();
  }

  @Post('workflows/chapter-keywords/:workflowRunId/restart')
  restartWorkflow(
  ): RestartChapterKeywordsWorkflowResponseDto {
    throw this.featureDisabled();
  }

  @Get('books/:bookId/chapters/:chapterId/chapter-keywords')
  getLatestChapterKeywords(
  ): GetLatestChapterKeywordsResponseDto {
    throw this.featureDisabled();
  }

  private featureDisabled(): GoneException {
    return new GoneException({
      status: 'error',
      error: {
        code: 'E.FEATURE_DISABLED',
        http: 410,
        message: ChapterKeywordsWorkflowController.disabledMessage,
      },
    });
  }
}
