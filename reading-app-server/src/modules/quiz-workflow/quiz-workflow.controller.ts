import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type {
  GetLatestChapterQuizResponseDto,
  GetQuizWorkflowResultResponseDto,
  GetQuizWorkflowStatusResponseDto,
  SubmitQuizWorkflowResponseDto,
} from './quiz-workflow.dto';
import { QuizWorkflowService } from './quiz-workflow.service';

@Controller('v1')
export class QuizWorkflowController {
  private readonly quizWorkflowService: QuizWorkflowService;

  constructor(@Inject(QuizWorkflowService) quizWorkflowService: QuizWorkflowService) {
    this.quizWorkflowService = quizWorkflowService;
  }

  @Post('workflows/quiz')
  submitQuizWorkflow(
    @Body() rawBody: string | undefined,
  ): SubmitQuizWorkflowResponseDto {
    const request = this.quizWorkflowService.parseSubmitRequest(rawBody);
    return this.quizWorkflowService.submitQuizWorkflow(request);
  }

  @Get('workflows/quiz/:workflowRunId')
  getWorkflowStatus(
    @Param('workflowRunId') workflowRunId: string,
  ): GetQuizWorkflowStatusResponseDto {
    return this.quizWorkflowService.getWorkflowStatus(workflowRunId);
  }

  @Get('workflows/quiz/:workflowRunId/result')
  getWorkflowResult(
    @Param('workflowRunId') workflowRunId: string,
  ): GetQuizWorkflowResultResponseDto {
    return this.quizWorkflowService.getWorkflowResult(workflowRunId);
  }

  @Get('books/:bookId/chapters/:chapterId/quiz')
  getLatestChapterQuiz(
    @Param('bookId') bookId: string,
    @Param('chapterId') chapterId: string,
  ): GetLatestChapterQuizResponseDto {
    return this.quizWorkflowService.getLatestChapterQuiz(bookId, chapterId);
  }
}
