import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { registerAs } from '@nestjs/config';

export interface Config {
  port: number;
  model: string;
  quizWorkflowModel: string;
  knowledgeExtractionWorkflowModel: string;
  chapterKeywordsWorkflowModel: string;
  timeoutMs: number;
  knowledgeExtractionWorkflowTimeoutMs: number;
  cacheMax: number;
  cacheTtlMs: number;
  debugMode: boolean;
  thinking: boolean;
  temperature: number;
  autoSubmitKnowledgeExtractionWorkflow: boolean;
  autoSubmitQuizWorkflow: boolean;
  requireKnowledgeExtractionCache: boolean;
  knowledgeExtractionReadThroughSurreal: boolean;
  llmProvider: 'gemini' | 'openrouter';
  surrealUrl: string;
  surrealNamespace: string;
  surrealDatabase: string;
  surrealUser: string;
  surrealPass: string;
}

const loadEnvFiles = (): void => {
  if (process.env.RAILWAY_ENVIRONMENT_ID) {
    return;
  }

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

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_OPENROUTER_MODEL = 'qwen/qwen3-32b';

const getLlmProvider = (): Config['llmProvider'] =>
  process.env.LLM_PROVIDER === 'openrouter' ? 'openrouter' : 'gemini';

const defaultModelForProvider = (): string =>
  getLlmProvider() === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_GEMINI_MODEL;

export const createAppConfig = (): Config => ({
  port: Number(process.env.PORT ?? 8787),
  model: process.env.MODEL_ID ?? defaultModelForProvider(),
  quizWorkflowModel: process.env.QUIZ_WORKFLOW_MODEL_ID ?? defaultModelForProvider(),
  knowledgeExtractionWorkflowModel: process.env.KNOWLEDGE_EXTRACTION_WORKFLOW_MODEL_ID ?? defaultModelForProvider(),
  // Deprecated: chapter keyword/key sentence generation moved to iOS local Foundation Models.
  // This remains readable for legacy tooling only and is not used by active runtime paths.
  chapterKeywordsWorkflowModel: process.env.CHAPTER_KEYWORDS_WORKFLOW_MODEL_ID ?? defaultModelForProvider(),
  timeoutMs: 50_000,
  knowledgeExtractionWorkflowTimeoutMs: Number(process.env.KNOWLEDGE_EXTRACTION_WORKFLOW_TIMEOUT_MS ?? 3_600_000),
  cacheMax: 500,
  cacheTtlMs: 7 * 24 * 3600_000,
  debugMode: process.env.LLM_DEBUG === '1' || process.env.DEBUG_LLM === '1',
  thinking: false,
  temperature: 0.1,
  autoSubmitKnowledgeExtractionWorkflow: process.env.AUTO_SUBMIT_KNOWLEDGE_EXTRACTION_WORKFLOW === '1',
  autoSubmitQuizWorkflow: process.env.AUTO_SUBMIT_QUIZ_WORKFLOW !== '0',
  requireKnowledgeExtractionCache: process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE === '1',
  knowledgeExtractionReadThroughSurreal: process.env.KNOWLEDGE_EXTRACTION_READ_THROUGH_SURREAL === '1',
  llmProvider: getLlmProvider(),
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

export function getOpenRouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY ?? '';
}
