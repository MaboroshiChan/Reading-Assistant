import { Module, forwardRef } from '@nestjs/common';
import { BookIngestionController } from './book-ingestion.controller';
import { BookIngestionRepository } from './book-ingestion.repository';
import { BookIngestionService } from './book-ingestion.service';
import { KnowledgeExtractionWorkflowModule } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.module';

@Module({
  imports: [forwardRef(() => KnowledgeExtractionWorkflowModule)],
  controllers: [BookIngestionController],
  providers: [BookIngestionRepository, BookIngestionService],
  exports: [BookIngestionRepository, BookIngestionService],
})
export class BookIngestionModule {}
