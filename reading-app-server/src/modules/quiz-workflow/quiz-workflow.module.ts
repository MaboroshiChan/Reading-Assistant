import { Module } from '@nestjs/common';
import { BookIngestionModule } from '../book-ingestion/book-ingestion.module';
import { KnowledgeExtractionWorkflowModule } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.module';
import { QuizWorkflowController } from './quiz-workflow.controller';
import { QuizWorkflowRepository } from './quiz-workflow.repository';
import { QuizWorkflowService } from './quiz-workflow.service';

@Module({
  imports: [BookIngestionModule, KnowledgeExtractionWorkflowModule],
  controllers: [QuizWorkflowController],
  providers: [QuizWorkflowRepository, QuizWorkflowService],
  exports: [QuizWorkflowRepository, QuizWorkflowService],
})
export class QuizWorkflowModule {}
