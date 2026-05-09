import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { appConfig } from './config/runtime-config';
import { MessageController } from './message/message.controller';
import { MessageService } from './message/message.service';
import { BookIngestionModule } from './modules/book-ingestion/book-ingestion.module';
import { KnowledgeExtractionWorkflowModule } from './modules/knowledge-extraction-workflow/knowledge-extraction-workflow.module';
import { QuizWorkflowModule } from './modules/quiz-workflow/quiz-workflow.module';
import { WorkflowQueueModule } from './modules/workflow-queue/workflow-queue.module';
import { SurrealModule } from './modules/surrealDB/surrealdb.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [appConfig],
    }),
    BookIngestionModule,
    WorkflowQueueModule,
    KnowledgeExtractionWorkflowModule,
    QuizWorkflowModule,
    UsersModule,
    SurrealModule,
  ],
  controllers: [HealthController, MessageController],
  providers: [MessageService],
})
export class AppModule {}
