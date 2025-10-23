// vitest.config.mts at repo root
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'reading-app/tests/**/*.test.ts',
      'reading-app/test/**/*.test.ts',
      'reading-app-server/tests/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'build'],
    globalSetup: ['./vitest.globalSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
