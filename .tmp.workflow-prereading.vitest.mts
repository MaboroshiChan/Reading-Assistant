import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'reading-app-server/tests/quiz-workflow.service.test.ts',
      'reading-app-server/tests/knowledge-extraction-workflow.service.test.ts',
      'reading-app-server/tests/runtime-config.test.ts',
      'reading-app-server/tests/chapter-keywords-llm.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'build'],
  },
});
