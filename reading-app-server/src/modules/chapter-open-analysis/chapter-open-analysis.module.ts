import { Module } from '@nestjs/common';
import { BookIngestionModule } from '../book-ingestion/book-ingestion.module';
import { ChapterKeywordsWorkflowModule } from '../chapter-keywords-workflow/chapter-keywords-workflow.module';
import { KnowledgeExtractionWorkflowModule } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.module';
import { QuizWorkflowModule } from '../quiz-workflow/quiz-workflow.module';
import { WorkflowQueueModule } from '../workflow-queue/workflow-queue.module';
import { PreReadingWorkflowModule } from '../pre-reading-workflow/pre-reading-workflow.module';
import { ChapterOpenAnalysisController } from './chapter-open-analysis.controller';
import { ChapterOpenAnalysisRepository } from './chapter-open-analysis.repository';
import { ChapterOpenAnalysisService } from './chapter-open-analysis.service';

@Module({
  imports: [
    BookIngestionModule,
    WorkflowQueueModule,
    PreReadingWorkflowModule,
    ChapterKeywordsWorkflowModule,
    KnowledgeExtractionWorkflowModule,
    QuizWorkflowModule,
  ],
  controllers: [ChapterOpenAnalysisController],
  providers: [ChapterOpenAnalysisRepository, ChapterOpenAnalysisService],
  exports: [ChapterOpenAnalysisRepository, ChapterOpenAnalysisService],
})
export class ChapterOpenAnalysisModule {}
