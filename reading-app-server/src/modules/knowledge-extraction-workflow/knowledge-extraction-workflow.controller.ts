import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type {
  GetKnowledgeExtractionWorkflowResultResponseDto,
  GetKnowledgeExtractionWorkflowStatusResponseDto,
  GetLatestChapterKnowledgeExtractionResponseDto,
  RestartKnowledgeExtractionWorkflowResponseDto,
  SubmitKnowledgeExtractionWorkflowResponseDto,
} from './knowledge-extraction-workflow.dto';
import { KnowledgeExtractionWorkflowService } from './knowledge-extraction-workflow.service';

@Controller('v1')
export class KnowledgeExtractionWorkflowController {
  private readonly knowledgeExtractionWorkflowService: KnowledgeExtractionWorkflowService;

  constructor(
    @Inject(KnowledgeExtractionWorkflowService)
    knowledgeExtractionWorkflowService: KnowledgeExtractionWorkflowService,
  ) {
    this.knowledgeExtractionWorkflowService = knowledgeExtractionWorkflowService;
  }

  @Post('workflows/knowledge-extraction')
  submitKnowledgeExtractionWorkflow(
    @Body() rawBody: string | undefined,
  ): SubmitKnowledgeExtractionWorkflowResponseDto {
    const request = this.knowledgeExtractionWorkflowService.parseSubmitRequest(rawBody);
    return this.knowledgeExtractionWorkflowService.submitKnowledgeExtractionWorkflow(request);
  }

  @Get('workflows/knowledge-extraction/:workflowRunId')
  getWorkflowStatus(
    @Param('workflowRunId') workflowRunId: string,
  ): GetKnowledgeExtractionWorkflowStatusResponseDto {
    return this.knowledgeExtractionWorkflowService.getWorkflowStatus(workflowRunId);
  }

  @Get('workflows/knowledge-extraction/:workflowRunId/result')
  async getWorkflowResult(
    @Param('workflowRunId') workflowRunId: string,
  ): Promise<GetKnowledgeExtractionWorkflowResultResponseDto> {
    return this.knowledgeExtractionWorkflowService.getWorkflowResult(workflowRunId);
  }

  @Post('workflows/knowledge-extraction/:workflowRunId/restart')
  restartWorkflow(
    @Param('workflowRunId') workflowRunId: string,
    @Body() rawBody: string | undefined,
  ): RestartKnowledgeExtractionWorkflowResponseDto {
    const request = this.knowledgeExtractionWorkflowService.parseRestartRequest(rawBody);
    return this.knowledgeExtractionWorkflowService.restartWorkflow(workflowRunId, request);
  }

  @Get('books/:bookId/chapters/:chapterId/knowledge-extraction')
  async getLatestChapterKnowledgeExtraction(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): Promise<GetLatestChapterKnowledgeExtractionResponseDto> {
    return this.knowledgeExtractionWorkflowService.getLatestChapterKnowledgeExtraction(bookId, chapterId);
  }
}
