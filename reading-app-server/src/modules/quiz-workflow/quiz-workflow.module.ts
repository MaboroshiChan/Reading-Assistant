import { Module } from '@nestjs/common';
import { BookIngestionModule } from '../book-ingestion/book-ingestion.module';
import { QuizWorkflowController } from './quiz-workflow.controller';
import { QuizWorkflowRepository } from './quiz-workflow.repository';
import { QuizWorkflowService } from './quiz-workflow.service';

@Module({
  imports: [BookIngestionModule],
  controllers: [QuizWorkflowController],
  providers: [QuizWorkflowRepository, QuizWorkflowService],
  exports: [QuizWorkflowRepository, QuizWorkflowService],
})
export class QuizWorkflowModule {}
