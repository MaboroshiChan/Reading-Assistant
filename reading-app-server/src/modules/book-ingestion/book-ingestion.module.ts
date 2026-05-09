import { Module, forwardRef } from '@nestjs/common';
import { BookContextService } from './book-context.service';
import { BookIngestionController } from './book-ingestion.controller';
import { BookIngestionRepository } from './book-ingestion.repository';
import { BookIngestionService } from './book-ingestion.service';
import { KnowledgeExtractionWorkflowModule } from '../knowledge-extraction-workflow/knowledge-extraction-workflow.module';

@Module({
  imports: [forwardRef(() => KnowledgeExtractionWorkflowModule)],
  controllers: [BookIngestionController],
  providers: [BookIngestionRepository, BookIngestionService, BookContextService],
  exports: [BookIngestionRepository, BookIngestionService, BookContextService],
})
export class BookIngestionModule {}
