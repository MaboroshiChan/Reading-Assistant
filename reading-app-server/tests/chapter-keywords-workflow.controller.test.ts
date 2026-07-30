import { GoneException } from '@nestjs/common';
import { describe, expect, test } from 'vitest';
import { ChapterKeywordsWorkflowController } from '../src/modules/chapter-keywords-workflow/chapter-keywords-workflow.controller';

describe('ChapterKeywordsWorkflowController', () => {
  test('returns gone for disabled chapter keyword endpoints', () => {
    const controller = new ChapterKeywordsWorkflowController();

    for (const call of [
      () => controller.submitChapterKeywordsWorkflow(),
      () => controller.getWorkflowStatus(),
      () => controller.getWorkflowResult(),
      () => controller.restartWorkflow(),
      () => controller.getLatestChapterKeywords(),
    ]) {
      expect(call).toThrowError(GoneException);
      try {
        call();
      } catch (error) {
        const response = (error as GoneException).getResponse();
        expect(response).toMatchObject({
          status: 'error',
          error: {
            code: 'E.FEATURE_DISABLED',
            http: 410,
          },
        });
      }
    }
  });
});
