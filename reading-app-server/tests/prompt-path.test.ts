import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolvePromptPath } from '../src/utils/prompt-path';

describe('resolvePromptPath', () => {
  test('finds versioned prompts under reading-app-server/prompts/v1', () => {
    const resolved = resolvePromptPath('knowledge_extraction.txt');

    expect(resolved).toBe(path.resolve(
      process.cwd(),
      'reading-app-server',
      'prompts',
      'v1',
      'knowledge_extraction.txt',
    ));
  });
});
