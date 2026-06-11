import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type {
  GetLatestChapterPreReadingResponseDto,
  GetPreReadingWorkflowResultResponseDto,
  GetPreReadingWorkflowStatusResponseDto,
  SubmitPreReadingWorkflowResponseDto,
} from './pre-reading-workflow.dto';
import { PreReadingWorkflowService } from './pre-reading-workflow.service';

@Controller('v1')
export class PreReadingWorkflowController {
  constructor(
    @Inject(PreReadingWorkflowService)
    private readonly service: PreReadingWorkflowService,
  ) {}

  @Post('workflows/pre-reading')
  submit(@Body() rawBody: string | undefined): SubmitPreReadingWorkflowResponseDto {
    return this.service.submitPreReadingWorkflow(this.service.parseSubmitRequest(rawBody));
  }

  @Get('workflows/pre-reading/:workflowRunId')
  getStatus(
    @Param('workflowRunId') workflowRunId: string,
  ): GetPreReadingWorkflowStatusResponseDto {
    return this.service.getWorkflowStatus(workflowRunId);
  }

  @Get('workflows/pre-reading/:workflowRunId/result')
  getResult(
    @Param('workflowRunId') workflowRunId: string,
  ): GetPreReadingWorkflowResultResponseDto {
    return this.service.getWorkflowResult(workflowRunId);
  }

  @Get('books/:bookId/chapters/:chapterId/pre-reading')
  getLatest(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): GetLatestChapterPreReadingResponseDto {
    return this.service.getLatestChapterPreReading(bookId, chapterId);
  }
}
