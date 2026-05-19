import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { registerAs } from '@nestjs/config';

export interface Config {
  port: number;
  model: string;
  timeoutMs: number;
  cacheMax: number;
  cacheTtlMs: number;
  debugMode: boolean;
  thinking: boolean;
  temperature: number;
  autoSubmitKnowledgeExtractionWorkflow: boolean;
  autoSubmitQuizWorkflow: boolean;
  requireKnowledgeExtractionCache: boolean;
  surrealUrl: string;
  surrealNamespace: string;
  surrealDatabase: string;
  surrealUser: string;
  surrealPass: string;
}

const loadEnvFiles = (): void => {
  const envPaths = [
    process.env.NODE_ENV === 'test'
      ? path.resolve(process.cwd(), 'reading-app-server/.env.test')
      : null,
    path.resolve(process.cwd(), 'reading-app-server/.env'),
    path.resolve(process.cwd(), '.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
};

loadEnvFiles();

export const createAppConfig = (): Config => ({
  port: Number(process.env.PORT ?? 8787),
  model: process.env.MODEL_ID ?? 'gemini-2.5-flash',
  timeoutMs: 50_000,
  cacheMax: 500,
  cacheTtlMs: 7 * 24 * 3600_000,
  debugMode: process.env.LLM_DEBUG === '1' || process.env.DEBUG_LLM === '1',
  thinking: false,
  temperature: 0.1,
  autoSubmitKnowledgeExtractionWorkflow: process.env.AUTO_SUBMIT_KNOWLEDGE_EXTRACTION_WORKFLOW === '1',
  autoSubmitQuizWorkflow: process.env.AUTO_SUBMIT_QUIZ_WORKFLOW !== '0',
  requireKnowledgeExtractionCache: process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE === '1',
  surrealUrl: process.env.SURREAL_URL ?? '',
  surrealNamespace: process.env.SURREAL_NS ?? '',
  surrealDatabase: process.env.SURREAL_DB ?? '',
  surrealUser: process.env.SURREAL_USER ?? '',
  surrealPass: process.env.SURREAL_PASS ?? '',
});

export const appConfig = registerAs('app', createAppConfig);

// Keep a stable object interface for existing handlers while still reading current env state.
export const config: Config = new Proxy({} as Config, {
  get(_target, property) {
    const current = createAppConfig();
    return current[property as keyof Config];
  },
}) as Config;

export function getOpenAIApiKey(): string {
  return process.env.GEMINI_API_KEY ?? '';
}
