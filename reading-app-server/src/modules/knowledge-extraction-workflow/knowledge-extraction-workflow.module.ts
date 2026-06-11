import { Module, forwardRef } from '@nestjs/common';
import { BookIngestionModule } from '../book-ingestion/book-ingestion.module';
import { QuizWorkflowModule } from '../quiz-workflow/quiz-workflow.module';
import { KnowledgeExtractionWorkflowController } from './knowledge-extraction-workflow.controller';
import { KnowledgeExtractionWorkflowRepository } from './knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from './knowledge-extraction-workflow.service';

@Module({
  imports: [forwardRef(() => BookIngestionModule), forwardRef(() => QuizWorkflowModule)],
  controllers: [KnowledgeExtractionWorkflowController],
  providers: [KnowledgeExtractionWorkflowRepository, KnowledgeExtractionWorkflowService],
  exports: [KnowledgeExtractionWorkflowRepository, KnowledgeExtractionWorkflowService],
})
export class KnowledgeExtractionWorkflowModule {}
