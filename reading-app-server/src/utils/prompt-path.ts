import { existsSync } from 'node:fs';
import path from 'node:path';

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

export const resolvePromptPath = (fileName: string): string => {
  const envPromptDir = process.env.PROMPTS_DIR?.trim();
  const candidates = unique([
    envPromptDir ? path.resolve(envPromptDir, fileName) : '',
    path.resolve(process.cwd(), 'reading-app-server', 'prompts', 'v1', fileName),
    path.resolve(process.cwd(), 'prompts', 'v1', fileName),
    path.resolve(__dirname, '..', '..', 'prompts', 'v1', fileName),
    path.resolve(__dirname, '..', '..', '..', '..', 'prompts', 'v1', fileName),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'reading-app-server', 'prompts', 'v1', fileName),
  ]).filter((candidate) => candidate.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? path.resolve(process.cwd(), 'reading-app-server', 'prompts', 'v1', fileName);
};
