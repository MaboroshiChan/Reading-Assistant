import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type {
  GetKnowledgeExtractionWorkflowResultResponseDto,
  GetKnowledgeExtractionWorkflowStatusResponseDto,
  GetLatestChapterKnowledgeExtractionResponseDto,
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
  getWorkflowResult(
    @Param('workflowRunId') workflowRunId: string,
  ): GetKnowledgeExtractionWorkflowResultResponseDto {
    return this.knowledgeExtractionWorkflowService.getWorkflowResult(workflowRunId);
  }

  @Get('books/:bookId/chapters/:chapterId/knowledge-extraction')
  getLatestChapterKnowledgeExtraction(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): GetLatestChapterKnowledgeExtractionResponseDto {
    return this.knowledgeExtractionWorkflowService.getLatestChapterKnowledgeExtraction(bookId, chapterId);
  }
}
