import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookContextService } from '../src/modules/book-ingestion/book-context.service';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { QuizWorkflowRepository } from '../src/modules/quiz-workflow/quiz-workflow.repository';
import { QuizWorkflowService } from '../src/modules/quiz-workflow/quiz-workflow.service';
import { PreReadingWorkflowRepository } from '../src/modules/pre-reading-workflow/pre-reading-workflow.repository';
import { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';
import * as llmService from '../services/llmService';

const createBookRepository = async (): Promise<BookIngestionRepository> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-workflow-'));
  return new BookIngestionRepository(dataDir);
};

const createKnowledgeResult = () => ({
  title: 'Chapter One',
  summary: 'Alice argues for freedom and delivers a public speech.',
  people: [
    {
      local_id: 'p_alice',
      name: 'Alice',
      aliases: ['Al'],
      evidence: [
        { quote: 'Alice arrives', pageIndex: 0, pageNumber: 1 },
        { quote: 'Alice speaks', pageIndex: 1, pageNumber: 2 },
      ],
    },
  ],
  ideas: [
    {
      local_id: 'i_freedom',
      label: 'Freedom',
      description: 'A central political ideal.',
      kind: 'claim' as const,
      evidence: [
        { quote: 'freedom is essential', pageIndex: 0, pageNumber: 1 },
      ],
    },
  ],
  events: [
    {
      local_id: 'e_speech',
      label: 'Public Speech',
      description: 'Alice addresses the crowd.',
      participant_local_ids: ['p_alice'],
      evidence: [
        { quote: 'Alice speaks to the crowd', pageIndex: 1, pageNumber: 2 },
      ],
    },
  ],
  entities: [
    {
      local_id: 'n_city_hall',
      label: 'City Hall',
      type: 'place' as const,
      evidence: [
        { quote: 'at City Hall', pageIndex: 1, pageNumber: 2 },
      ],
    },
  ],
  themes: [
    {
      local_id: 't_resistance',
      label: 'Resistance',
      description: 'The chapter emphasizes collective resistance.',
      strength: 0.8,
      evidence: [
        { quote: 'the resistance grows', pageIndex: 2, pageNumber: 3 },
      ],
    },
  ],
  relations: [
    {
      local_id: 'r1',
      from_id: 'p_alice',
      from_type: 'person' as const,
      to_id: 'i_freedom',
      to_type: 'idea' as const,
      relation_type: 'supports' as const,
      evidence: [
        { quote: 'Alice supports freedom', pageIndex: 0, pageNumber: 1 },
      ],
    },
    {
      local_id: 'r2',
      from_id: 'p_alice',
      from_type: 'person' as const,
      to_id: 'e_speech',
      to_type: 'event' as const,
      relation_type: 'participates_in' as const,
      evidence: [
        { quote: 'Alice delivers the speech', pageIndex: 1, pageNumber: 2 },
      ],
    },
  ],
});

describe('QuizWorkflowService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('creates a fresh quiz run after a failed or stale idempotent run', () => {
    const repository = new QuizWorkflowRepository();
    const input = {
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1' as const,
      idempotencyKey: 'quiz:v1:book-1:chapter-1:hash-1',
      expectedSnapshotVersion: 1,
      expectedChapterContentHash: 'hash-1',
      requestedByUserId: undefined,
    };

    const first = repository.createOrReuseRun(input);
    expect(first.deduped).toBe(false);

    repository.failRun(first.run.id, 'TEST_FAILURE', 'retryable failure');

    const retried = repository.createOrReuseRun(input);
    expect(retried.deduped).toBe(false);
    expect(retried.run.id).not.toBe(first.run.id);
    expect(retried.run.status).toBe('queued');

    repository.markStale(retried.run.id, 'TEST_STALE', 'stale canonical state');

    const afterStale = repository.createOrReuseRun(input);
    expect(afterStale.deduped).toBe(false);
    expect(afterStale.run.id).not.toBe(retried.run.id);
    expect(afterStale.run.status).toBe('queued');
  });

  test('rejects quiz submission when no matching knowledge extraction result exists', async () => {
    const bookRepository = await createBookRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const service = new QuizWorkflowService(
      bookRepository,
      new BookContextService(bookRepository, knowledgeRepository),
      knowledgeRepository,
      new QuizWorkflowRepository(),
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'hash-1',
      pageParagraphs: { '0': 'A chapter without extraction.' },
    });

    expect(() => service.submitQuizWorkflow({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    })).toThrowError(ConflictException);
  });

  test('derives ordered knowledge units and attaches source refs to mixed generated questions', async () => {
    const bookRepository = await createBookRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const quizRepository = new QuizWorkflowRepository();
    const preReadingRepository = new PreReadingWorkflowRepository();
    const service = new QuizWorkflowService(
      bookRepository,
      new BookContextService(bookRepository, knowledgeRepository),
      knowledgeRepository,
      quizRepository,
      new WorkflowQueueService(),
      preReadingRepository,
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'hash-0',
      pageParagraphs: { '0': 'Alice says freedom matters.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 1,
      sourceHash: 'hash-1',
      pageParagraphs: { '0': 'Alice gives a speech at City Hall.' },
    });
    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 2,
      sourceHash: 'hash-2',
      pageParagraphs: { '0': 'The resistance grows.' },
    });

    const book = bookRepository.getBook('book-1');
    const chapter = bookRepository.getChapter('book-1', 'chapter-1');
    if (!book || !chapter) {
      throw new Error('expected canonical chapter state');
    }

    const run = knowledgeRepository.createOrReuseRun({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge:chapter-1',
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter.chapterContentHash,
    });
    const knowledgeResult = createKnowledgeResult();
    knowledgeRepository.completeRun({
      workflowRunId: run.run.id,
      snapshotVersion: book.snapshotVersion,
      chapterContentHash: chapter.chapterContentHash,
      result: knowledgeResult,
    });
    const preReadingRun = preReadingRepository.createOrReuseRun({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'pre-reading:chapter-1',
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter.chapterContentHash,
    });
    preReadingRepository.completeRun({
      workflowRunId: preReadingRun.run.id,
      snapshotVersion: book.snapshotVersion,
      chapterContentHash: chapter.chapterContentHash,
      result: {
        teaser: 'Watch how freedom turns from an idea into a public test.',
        pre_reading_questions: [
          'What pressure turns an idea into action?',
          'Which public moments reveal the chapter\'s real stakes?',
          'How does the chapter ask you to judge courage or risk?',
        ],
      },
    });

    const units = (service as never).deriveKnowledgeUnits(knowledgeResult) as Array<{
      unitId: string;
      type: string;
      anchorPageIndex: number;
    }>;
    expect(units.map((unit) => unit.type)).toEqual(['idea', 'event', 'theme', 'person']);
    expect(units.map((unit) => unit.anchorPageIndex)).toEqual([0, 1, 2, 0]);

    const prompts: string[] = [];
    const createLLMClientSpy = vi.spyOn(llmService, 'createLLMClient').mockReturnValue({
      complete: vi.fn(),
      json: vi.fn(async (userPrompt: string) => {
        prompts.push(userPrompt);
        const unitsMatch = userPrompt.match(/Source knowledge units:\n```json\n([\s\S]*?)\n```/);
        const units = unitsMatch ? JSON.parse(unitsMatch[1]) as Array<{
          unitId: string;
          label: string;
          skill: string;
          targetQuestionType: string;
        }> : [];
        const json = JSON.stringify({
          questions: units.map((unit, index) => ({
            id: `q${index + 1}`,
            question: `Question about ${unit.label}?`,
            explanation: `Explanation for ${unit.label}.`,
            skill: unit.skill,
            ...(unit.targetQuestionType === 'short_answer' ? {
              type: 'short_answer',
              acceptableAnswers: [unit.label, `${unit.label} answer`],
              answerGuidance: `Mention ${unit.label}.`,
            } : unit.targetQuestionType === 'fill_in_blank' ? {
              type: 'fill_in_blank',
              question: `Complete the sentence: ____ relates to ${unit.label}.`,
              options: [unit.label, 'Distractor A', 'Distractor B', 'Distractor C'],
              correctAnswerIndex: 0,
              blankHint: 'Use the exact key term.',
            } : unit.targetQuestionType === 'true_false_not_given' ? {
              type: 'true_false_not_given',
              options: ['True', 'False', 'Not Given'],
              correctAnswerIndex: 0,
            } : {
              type: 'multiple_choice',
              options: [unit.label, 'Distractor A', 'Distractor B', 'Distractor C'],
              correctAnswerIndex: 0,
            }),
          })),
        });
        return {
          data: (async function* () {
            yield json;
          })(),
          usage: Promise.resolve({}),
        };
      }),
    } as never);

    const submit = service.submitQuizWorkflow({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    const result = service.getWorkflowResult(submit.workflowRunId).result;
    expect(result.teaser).toBe('Watch how freedom turns from an idea into a public test.');
    expect(result.pre_reading_questions).toEqual([
      'What pressure turns an idea into action?',
      'Which public moments reveal the chapter\'s real stakes?',
      'How does the chapter ask you to judge courage or risk?',
    ]);
    expect(result.questions).toHaveLength(4);
    expect(result.questions).toEqual([
      expect.objectContaining({
        type: 'multiple_choice',
        options: ['Freedom', 'Distractor A', 'Distractor B', 'Distractor C'],
        correctAnswerIndex: 0,
        sourceUnitId: 'i_freedom',
        sourceUnitType: 'idea',
        sourceInsight: {
          unitId: 'i_freedom',
          unitType: 'idea',
          label: 'Freedom',
          description: 'A central political ideal.',
          skill: 'Argument',
          aliases: undefined,
          relationHints: ['supports:person:p_alice'],
          anchorPageIndex: 0,
          anchorPageNumber: 1,
          sourcePageRefs: [{ pageIndex: 0, pageNumber: 1 }],
          sourceEvidence: [
            { quote: 'freedom is essential', pageIndex: 0, pageNumber: 1 },
          ],
        },
        sourceEvidence: [
          { quote: 'freedom is essential', pageIndex: 0, pageNumber: 1 },
        ],
        sourcePageRefs: [{ pageIndex: 0, pageNumber: 1 }],
      }),
      expect.objectContaining({
        type: 'fill_in_blank',
        options: ['Alice', 'Distractor A', 'Distractor B', 'Distractor C'],
        correctAnswerIndex: 0,
        sourceUnitId: 'p_alice',
        sourceUnitType: 'person',
        sourceInsight: {
          unitId: 'p_alice',
          unitType: 'person',
          label: 'Alice',
          description: undefined,
          skill: 'Facts',
          aliases: ['Al'],
          relationHints: ['participates_in:event:e_speech', 'supports:idea:i_freedom'],
          anchorPageIndex: 0,
          anchorPageNumber: 1,
          sourcePageRefs: [
            { pageIndex: 0, pageNumber: 1 },
            { pageIndex: 1, pageNumber: 2 },
          ],
          sourceEvidence: [
            { quote: 'Alice arrives', pageIndex: 0, pageNumber: 1 },
            { quote: 'Alice speaks', pageIndex: 1, pageNumber: 2 },
          ],
        },
        sourceEvidence: [
          { quote: 'Alice arrives', pageIndex: 0, pageNumber: 1 },
          { quote: 'Alice speaks', pageIndex: 1, pageNumber: 2 },
        ],
        sourcePageRefs: [
          { pageIndex: 0, pageNumber: 1 },
          { pageIndex: 1, pageNumber: 2 },
        ],
      }),
      expect.objectContaining({
        type: 'true_false_not_given',
        options: ['True', 'False', 'Not Given'],
        correctAnswerIndex: 0,
        sourceUnitId: 'e_speech',
        sourceUnitType: 'event',
        sourceInsight: {
          unitId: 'e_speech',
          unitType: 'event',
          label: 'Public Speech',
          description: 'Alice addresses the crowd.',
          skill: 'Inference',
          aliases: undefined,
          relationHints: ['participates_in:person:p_alice'],
          anchorPageIndex: 1,
          anchorPageNumber: 2,
          sourcePageRefs: [{ pageIndex: 1, pageNumber: 2 }],
          sourceEvidence: [
            { quote: 'Alice speaks to the crowd', pageIndex: 1, pageNumber: 2 },
          ],
        },
        sourceEvidence: [
          { quote: 'Alice speaks to the crowd', pageIndex: 1, pageNumber: 2 },
        ],
        sourcePageRefs: [{ pageIndex: 1, pageNumber: 2 }],
      }),
      expect.objectContaining({
        type: 'multiple_choice',
        options: ['Resistance', 'Distractor A', 'Distractor B', 'Distractor C'],
        correctAnswerIndex: 0,
        sourceUnitId: 't_resistance',
        sourceUnitType: 'theme',
        sourceInsight: {
          unitId: 't_resistance',
          unitType: 'theme',
          label: 'Resistance',
          description: 'The chapter emphasizes collective resistance.',
          skill: 'Tone',
          aliases: undefined,
          relationHints: undefined,
          anchorPageIndex: 2,
          anchorPageNumber: 3,
          sourcePageRefs: [{ pageIndex: 2, pageNumber: 3 }],
          sourceEvidence: [
            { quote: 'the resistance grows', pageIndex: 2, pageNumber: 3 },
          ],
        },
        sourceEvidence: [
          { quote: 'the resistance grows', pageIndex: 2, pageNumber: 3 },
        ],
        sourcePageRefs: [{ pageIndex: 2, pageNumber: 3 }],
      }),
    ]);
    expect(prompts.some((prompt) => prompt.includes('Source knowledge units:'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Current chapter summary:'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Page window:'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('targetQuestionType'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('sourceEvidence'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Generate a spoiler-light chapter pre-reading guide'))).toBe(false);
    expect(createLLMClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash-lite',
      prefixCache: expect.objectContaining({
        cacheKey: `chapter_context.v1:book-1:chapter-1:${chapter.chapterContentHash}`,
        systemPromptMode: 'request',
      }),
    }));
  });

  test('selects mixed question types when idea units would otherwise dominate', async () => {
    const bookRepository = await createBookRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const service = new QuizWorkflowService(
      bookRepository,
      new BookContextService(bookRepository, knowledgeRepository),
      knowledgeRepository,
      new QuizWorkflowRepository(),
      new WorkflowQueueService(),
    );

    const knowledgeResult = {
      ...createKnowledgeResult(),
      ideas: [
        {
          local_id: 'i_freedom',
          label: 'Freedom',
          description: 'A central political ideal.',
          kind: 'claim' as const,
          evidence: [{ quote: 'freedom is essential', pageIndex: 0, pageNumber: 1 }],
        },
        {
          local_id: 'i_justice',
          label: 'Justice',
          description: 'The crowd demands justice.',
          kind: 'claim' as const,
          evidence: [{ quote: 'justice must prevail', pageIndex: 0, pageNumber: 1 }],
        },
        {
          local_id: 'i_unity',
          label: 'Unity',
          description: 'The chapter links resistance with unity.',
          kind: 'claim' as const,
          evidence: [{ quote: 'unity strengthens resistance', pageIndex: 1, pageNumber: 2 }],
        },
      ],
    };

    const derivedUnits = (service as never).deriveKnowledgeUnits(knowledgeResult) as Array<{
      unitId: string;
      type: string;
    }>;
    expect(derivedUnits.map((unit) => unit.type)).toEqual([
      'idea',
      'idea',
      'idea',
      'event',
      'theme',
      'person',
    ]);

    const selectedUnits = (service as never).selectKnowledgeUnits(derivedUnits) as Array<{
      unitId: string;
      type: string;
    }>;
    expect(selectedUnits).toHaveLength(5);
    expect(selectedUnits.map((unit) => unit.unitId)).toEqual([
      'i_freedom',
      'i_justice',
      'i_unity',
      'e_speech',
      'p_alice',
    ]);

    const plannedUnits = (service as never).planQuestionUnits(selectedUnits) as Array<{
      unitId: string;
      targetQuestionType: string;
    }>;
    expect(plannedUnits.map((unit) => unit.targetQuestionType)).toEqual([
      'multiple_choice',
      'multiple_choice',
      'multiple_choice',
      'true_false_not_given',
      'fill_in_blank',
    ]);
  });

  test('retries quiz workflow generation after a transient llm failure', async () => {
    const bookRepository = await createBookRepository();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const quizRepository = new QuizWorkflowRepository();
    const service = new QuizWorkflowService(
      bookRepository,
      new BookContextService(bookRepository, knowledgeRepository),
      knowledgeRepository,
      quizRepository,
      new WorkflowQueueService(),
    );

    bookRepository.upsertPageFragment({
      bookId: 'book-quiz-retry',
      chapterId: 'chapter-quiz-retry',
      chapterIndex: 1,
      chapterTitle: 'Retry Quiz Chapter',
      pageIndex: 0,
      sourceHash: 'quiz-retry-hash',
      pageParagraphs: { '0': 'Alice speaks again.' },
    });

    const book = bookRepository.getBook('book-quiz-retry');
    const chapter = bookRepository.getChapter('book-quiz-retry', 'chapter-quiz-retry');
    if (!book || !chapter) {
      throw new Error('expected canonical quiz retry chapter state');
    }

    const knowledgeRun = knowledgeRepository.createOrReuseRun({
      bookId: 'book-quiz-retry',
      chapterId: 'chapter-quiz-retry',
      chapterIndex: 1,
      workflowVersion: 'v1',
      idempotencyKey: 'knowledge:quiz-retry',
      expectedSnapshotVersion: book.snapshotVersion,
      expectedChapterContentHash: chapter.chapterContentHash,
    });
    knowledgeRepository.completeRun({
      workflowRunId: knowledgeRun.run.id,
      snapshotVersion: book.snapshotVersion,
      chapterContentHash: chapter.chapterContentHash,
      result: createKnowledgeResult(),
    });

    const sleepSpy = vi.spyOn(service as never, 'sleep').mockResolvedValue(undefined);
    let attempts = 0;
    vi.spyOn(service as never, 'generateQuiz').mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('429 Too Many Requests: quota exceeded, retry in 1s');
      }
      return {
        questions: [
          {
            id: 'q-retry',
            type: 'multiple_choice',
            question: 'What does Alice support?',
            options: ['Freedom', 'Silence', 'Confusion', 'Distance'],
            correctAnswerIndex: 0,
            explanation: 'The extraction summary centers on freedom.',
            skill: 'Facts',
          },
        ],
      };
    });

    const submit = service.submitQuizWorkflow({
      bookId: 'book-quiz-retry',
      chapterId: 'chapter-quiz-retry',
      chapterIndex: 1,
      workflowVersion: 'v1',
    });

    await vi.waitFor(() => {
      expect(service.getWorkflowStatus(submit.workflowRunId).status).toBe('completed');
    });

    expect(attempts).toBe(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });
});
