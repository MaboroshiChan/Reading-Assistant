import { Module, forwardRef } from '@nestjs/common';
import { BookIngestionModule } from '../book-ingestion/book-ingestion.module';
import { WorkflowQueueModule } from '../workflow-queue/workflow-queue.module';
import { PreReadingWorkflowController } from './pre-reading-workflow.controller';
import { PreReadingWorkflowRepository } from './pre-reading-workflow.repository';
import { PreReadingWorkflowService } from './pre-reading-workflow.service';

@Module({
  imports: [forwardRef(() => BookIngestionModule), WorkflowQueueModule],
  controllers: [PreReadingWorkflowController],
  providers: [PreReadingWorkflowRepository, PreReadingWorkflowService],
  exports: [PreReadingWorkflowRepository, PreReadingWorkflowService],
})
export class PreReadingWorkflowModule {}
