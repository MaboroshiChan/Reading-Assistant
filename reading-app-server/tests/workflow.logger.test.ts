import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookContextService } from '../src/modules/book-ingestion/book-context.service';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service';
import { QuizWorkflowRepository } from '../src/modules/quiz-workflow/quiz-workflow.repository';
import { QuizWorkflowService } from '../src/modules/quiz-workflow/quiz-workflow.service';
import { WorkflowQueueService } from '../src/modules/workflow-queue/workflow-queue.service';
import { flushWorkflowLogs } from '../src/modules/workflow.logger';

describe('workflow logging', () => {
  afterEach(async () => {
    delete process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE;
    vi.restoreAllMocks();
    await flushWorkflowLogs();
  });

  test('emits structured terminal logs for quiz and knowledge extraction workflows', async () => {
    process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE = '0';
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const bookRepository = new BookIngestionRepository();
    bookRepository.upsertPageFragment({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      chapterTitle: 'Chapter One',
      pageIndex: 0,
      sourceHash: 'hash-1',
      pageParagraphs: {
        '0': 'paragraph one',
        '1': 'paragraph two',
      },
    });

    const queueService = new WorkflowQueueService();
    const knowledgeRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, knowledgeRepository);
    const quizService = new QuizWorkflowService(
      bookRepository,
      bookContextService,
      knowledgeRepository,
      new QuizWorkflowRepository(),
      queueService,
    );
    const knowledgeService = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      knowledgeRepository,
      queueService,
    );

    vi.spyOn(quizService as never, 'generateQuiz').mockResolvedValue({
      questions: [
        {
          id: 'q1',
          type: 'multiple_choice',
          question: 'What happened?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswerIndex: 0,
          explanation: 'Because.',
          skill: 'Facts',
        },
      ],
    });
    vi.spyOn(knowledgeService as never, 'generateKnowledgeExtraction').mockResolvedValue({
      title: 'Chapter One',
      summary: 'Summary',
      people: [],
      ideas: [],
      events: [],
      entities: [],
      themes: [],
      relations: [],
    });

    const parsedKnowledgeRequest = knowledgeService.parseSubmitRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    }));
    const knowledgeSubmit = knowledgeService.submitKnowledgeExtractionWorkflow(parsedKnowledgeRequest);

    await vi.waitFor(() => {
      expect(knowledgeService.getWorkflowStatus(knowledgeSubmit.workflowRunId).status).toBe('completed');
    });

    const parsedQuizRequest = quizService.parseSubmitRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    }));
    const quizSubmit = quizService.submitQuizWorkflow(parsedQuizRequest);

    const dedupedQuizSubmit = quizService.submitQuizWorkflow(parsedQuizRequest);

    await vi.waitFor(() => {
      expect(quizService.getWorkflowStatus(quizSubmit.workflowRunId).status).toBe('completed');
    });

    quizService.getWorkflowResult(quizSubmit.workflowRunId);
    knowledgeService.getWorkflowResult(knowledgeSubmit.workflowRunId);
    quizService.getLatestChapterQuiz('book-1', 'chapter-1');
    knowledgeService.getLatestChapterKnowledgeExtraction('book-1', 'chapter-1');

    await flushWorkflowLogs();

    expect(dedupedQuizSubmit.workflowRunId).toBe(quizSubmit.workflowRunId);
    expect(dedupedQuizSubmit.deduped).toBe(true);
    expect(consoleInfoSpy).toHaveBeenCalled();
    const terminalLines = consoleInfoSpy.mock.calls
      .map(([line]) => line)
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
    const firstTerminalLine = terminalLines[0];
    expect(terminalLines.some((line) => line.includes('[workflow][request.parsed]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][run.queued]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][run.submitted]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][run.deduped]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][run.running]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][run.completed]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][status.read_hit]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][result.read_hit]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('[workflow][latest_result.read_hit]'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('workflowKind=quiz_generation'))).toBe(true);
    expect(terminalLines.some((line) => line.includes('workflowKind=knowledge_extraction'))).toBe(true);
    expect(
      terminalLines.some((line) =>
        line.includes('[workflow][run.deduped]')
        && line.includes(`dedupedWorkflowRunId=${quizSubmit.workflowRunId}`)
        && line.includes('bookId=book-1')
        && line.includes('chapterId=chapter-1')),
    ).toBe(true);
    expect(firstTerminalLine).toContain('[workflow]');
    expect(firstTerminalLine).toContain('workflowKind=');
    expect(firstTerminalLine.startsWith('{')).toBe(false);
  });
});
