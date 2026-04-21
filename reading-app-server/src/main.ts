import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from './config/runtime-config';

export const createApp = async (): Promise<INestApplication> => {
  const server = express();
  server.use(express.text({ type: '*/*', limit: '10mb' }));

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
  });

  app.enableCors({
    origin: '*',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-request-id',
      'Idempotency-Key',
      'X-App-Client',
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  return app;
};

export const bootstrap = async (): Promise<void> => {
  const app = await createApp();
  await app.listen(config.port);
  const mode = config.useMockLLM ? 'MOCK_LLM' : 'LIVE_LLM';
  console.log(`server on :${config.port} (${mode})`);
};

if (require.main === module) {
  void bootstrap();
}
