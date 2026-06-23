import { afterEach, describe, expect, test } from 'vitest';
import { createAppConfig } from '../src/config/runtime-config';

const envKeys = [
  'LLM_PROVIDER',
  'MODEL_ID',
  'QUIZ_WORKFLOW_MODEL_ID',
  'KNOWLEDGE_EXTRACTION_WORKFLOW_MODEL_ID',
  'CHAPTER_KEYWORDS_WORKFLOW_MODEL_ID',
  'KNOWLEDGE_EXTRACTION_WORKFLOW_TIMEOUT_MS',
] as const;

const savedEnv = new Map<string, string | undefined>();

describe('runtime config workflow model routing', () => {
  afterEach(() => {
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    savedEnv.clear();
  });

  test('defaults all LLM calls to Gemini Flash-Lite', () => {
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    const config = createAppConfig();

    expect(config.llmProvider).toBe('gemini');
    expect(config.model).toBe('gemini-2.5-flash-lite');
    expect(config.quizWorkflowModel).toBe('gemini-2.5-flash-lite');
    expect(config.knowledgeExtractionWorkflowModel).toBe('gemini-2.5-flash-lite');
    expect(config.chapterKeywordsWorkflowModel).toBe('gemini-2.5-flash-lite');
    expect(config.knowledgeExtractionWorkflowTimeoutMs).toBe(3600000);
  });

  test('keeps legacy MODEL_ID separate from workflow-specific defaults', () => {
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.MODEL_ID = 'legacy-handler-model';

    const config = createAppConfig();

    expect(config.llmProvider).toBe('gemini');
    expect(config.model).toBe('legacy-handler-model');
    expect(config.quizWorkflowModel).toBe('gemini-2.5-flash-lite');
    expect(config.knowledgeExtractionWorkflowModel).toBe('gemini-2.5-flash-lite');
    expect(config.chapterKeywordsWorkflowModel).toBe('gemini-2.5-flash-lite');
    expect(config.knowledgeExtractionWorkflowTimeoutMs).toBe(3600000);
  });

  test('allows workflow-specific model overrides through env vars', () => {
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
    }
    process.env.MODEL_ID = 'legacy-handler-model';
    process.env.QUIZ_WORKFLOW_MODEL_ID = 'quiz-model';
    process.env.KNOWLEDGE_EXTRACTION_WORKFLOW_MODEL_ID = 'insight-model';
    process.env.CHAPTER_KEYWORDS_WORKFLOW_MODEL_ID = 'keywords-model';
    process.env.KNOWLEDGE_EXTRACTION_WORKFLOW_TIMEOUT_MS = '90000';

    const config = createAppConfig();

    expect(config.llmProvider).toBe('gemini');
    expect(config.model).toBe('legacy-handler-model');
    expect(config.quizWorkflowModel).toBe('quiz-model');
    expect(config.knowledgeExtractionWorkflowModel).toBe('insight-model');
    expect(config.chapterKeywordsWorkflowModel).toBe('keywords-model');
    expect(config.knowledgeExtractionWorkflowTimeoutMs).toBe(90000);
  });

  test('keeps OpenRouter model defaults available when explicitly selected', () => {
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.LLM_PROVIDER = 'openrouter';

    const config = createAppConfig();

    expect(config.llmProvider).toBe('openrouter');
    expect(config.model).toBe('qwen/qwen3-32b');
    expect(config.quizWorkflowModel).toBe('qwen/qwen3-32b');
    expect(config.knowledgeExtractionWorkflowModel).toBe('qwen/qwen3-32b');
    expect(config.chapterKeywordsWorkflowModel).toBe('qwen/qwen3-32b');
    expect(config.knowledgeExtractionWorkflowTimeoutMs).toBe(3600000);
  });
});
