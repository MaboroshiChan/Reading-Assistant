import { afterEach, describe, expect, test } from 'vitest';
import { createAppConfig } from '../src/config/runtime-config';

const envKeys = [
  'MODEL_ID',
  'QUIZ_WORKFLOW_MODEL_ID',
  'KNOWLEDGE_EXTRACTION_WORKFLOW_MODEL_ID',
  'CHAPTER_KEYWORDS_WORKFLOW_MODEL_ID',
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

  test('keeps legacy MODEL_ID separate from workflow-specific defaults', () => {
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.MODEL_ID = 'legacy-handler-model';

    const config = createAppConfig();

    expect(config.model).toBe('legacy-handler-model');
    expect(config.quizWorkflowModel).toBe('gemini-2.5-flash');
    expect(config.knowledgeExtractionWorkflowModel).toBe('gemini-flash-lite-latest');
    expect(config.chapterKeywordsWorkflowModel).toBe('gemini-flash-lite-latest');
  });

  test('allows workflow-specific model overrides through env vars', () => {
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
    }
    process.env.MODEL_ID = 'legacy-handler-model';
    process.env.QUIZ_WORKFLOW_MODEL_ID = 'quiz-model';
    process.env.KNOWLEDGE_EXTRACTION_WORKFLOW_MODEL_ID = 'insight-model';
    process.env.CHAPTER_KEYWORDS_WORKFLOW_MODEL_ID = 'keywords-model';

    const config = createAppConfig();

    expect(config.model).toBe('legacy-handler-model');
    expect(config.quizWorkflowModel).toBe('quiz-model');
    expect(config.knowledgeExtractionWorkflowModel).toBe('insight-model');
    expect(config.chapterKeywordsWorkflowModel).toBe('keywords-model');
  });
});
