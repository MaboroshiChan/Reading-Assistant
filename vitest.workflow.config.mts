import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'reading-app-server/tests/book-context.service.test.ts',
      'reading-app-server/tests/knowledge-extraction-workflow.service.test.ts',
      'reading-app-server/tests/quiz-workflow.service.test.ts',
      'reading-app-server/tests/message.service.test.ts',
      'reading-app-server/tests/workflow.logger.test.ts',
      'reading-app-server/tests/prompt-path.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'build'],
  },
});
