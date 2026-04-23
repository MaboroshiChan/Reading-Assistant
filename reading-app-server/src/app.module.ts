import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { appConfig } from './config/runtime-config';
import { MessageController } from './message/message.controller';
import { MessageHttpService } from './message/message-http.service';
import { BookIngestionModule } from './modules/book-ingestion/book-ingestion.module';
import { QuizWorkflowModule } from './modules/quiz-workflow/quiz-workflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [appConfig],
    }),
    BookIngestionModule,
    QuizWorkflowModule,
  ],
  controllers: [HealthController, MessageController],
  providers: [MessageHttpService],
})
export class AppModule {}
