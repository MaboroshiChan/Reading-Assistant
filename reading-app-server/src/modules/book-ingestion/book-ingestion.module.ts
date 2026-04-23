import { Module } from '@nestjs/common';
import { BookIngestionController } from './book-ingestion.controller';
import { BookIngestionRepository } from './book-ingestion.repository';
import { BookIngestionService } from './book-ingestion.service';

@Module({
  controllers: [BookIngestionController],
  providers: [BookIngestionRepository, BookIngestionService],
  exports: [BookIngestionRepository, BookIngestionService],
})
export class BookIngestionModule {}
