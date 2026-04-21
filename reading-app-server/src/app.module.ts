import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { appConfig } from './config/runtime-config';
import { MessageController } from './message/message.controller';
import { MessageHttpService } from './message/message-http.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [appConfig],
    }),
  ],
  controllers: [HealthController, MessageController],
  providers: [MessageHttpService],
})
export class AppModule {}
