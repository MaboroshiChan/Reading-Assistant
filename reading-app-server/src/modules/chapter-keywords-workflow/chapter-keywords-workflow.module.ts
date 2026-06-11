import { Module } from '@nestjs/common';
import { BookIngestionModule } from '../book-ingestion/book-ingestion.module';
import { WorkflowQueueModule } from '../workflow-queue/workflow-queue.module';
import { ChapterKeywordsWorkflowController } from './chapter-keywords-workflow.controller';
import { ChapterKeywordsWorkflowRepository } from './chapter-keywords-workflow.repository';
import { ChapterKeywordsWorkflowService } from './chapter-keywords-workflow.service';

@Module({
  imports: [BookIngestionModule, WorkflowQueueModule],
  controllers: [ChapterKeywordsWorkflowController],
  providers: [ChapterKeywordsWorkflowRepository, ChapterKeywordsWorkflowService],
  exports: [ChapterKeywordsWorkflowRepository, ChapterKeywordsWorkflowService],
})
export class ChapterKeywordsWorkflowModule {}
