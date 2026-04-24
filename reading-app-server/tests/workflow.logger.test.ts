import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BookIngestionRepository } from '../src/modules/book-ingestion/book-ingestion.repository';
import { KnowledgeExtractionWorkflowRepository } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository';
import { KnowledgeExtractionWorkflowService } from '../src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service';
import { QuizWorkflowRepository } from '../src/modules/quiz-workflow/quiz-workflow.repository';
import { QuizWorkflowService } from '../src/modules/quiz-workflow/quiz-workflow.service';
import { flushWorkflowLogs } from '../src/modules/workflow.logger';

describe('workflow logging', () => {
  afterEach(async () => {
    delete process.env.WORKFLOW_LOG_FILE;
    vi.restoreAllMocks();
    await flushWorkflowLogs();
  });

  test('persists structured logs for quiz and knowledge extraction workflows', async () => {
    const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-log-'));
    const logFile = path.join(logDir, 'workflows.log');
    process.env.WORKFLOW_LOG_FILE = logFile;
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

    const quizService = new QuizWorkflowService(bookRepository, new QuizWorkflowRepository());
    const knowledgeService = new KnowledgeExtractionWorkflowService(
      bookRepository,
      new KnowledgeExtractionWorkflowRepository(),
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

    const parsedQuizRequest = quizService.parseSubmitRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    }));
    const quizSubmit = quizService.submitQuizWorkflow(parsedQuizRequest);

    const dedupedQuizSubmit = quizService.submitQuizWorkflow(parsedQuizRequest);

    const parsedKnowledgeRequest = knowledgeService.parseSubmitRequest(JSON.stringify({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      workflowVersion: 'v1',
    }));
    const knowledgeSubmit = knowledgeService.submitKnowledgeExtractionWorkflow(parsedKnowledgeRequest);

    await vi.waitFor(() => {
      expect(quizService.getWorkflowStatus(quizSubmit.workflowRunId).status).toBe('completed');
      expect(knowledgeService.getWorkflowStatus(knowledgeSubmit.workflowRunId).status).toBe('completed');
    });

    quizService.getWorkflowResult(quizSubmit.workflowRunId);
    knowledgeService.getWorkflowResult(knowledgeSubmit.workflowRunId);
    quizService.getLatestChapterQuiz('book-1', 'chapter-1');
    knowledgeService.getLatestChapterKnowledgeExtraction('book-1', 'chapter-1');

    await flushWorkflowLogs();

    const content = await fs.readFile(logFile, 'utf8');
    const lines = content.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    const events = lines.map((line) => line.event);

    expect(events).toContain('request.parsed');
    expect(events).toContain('run.queued');
    expect(events).toContain('run.submitted');
    expect(events).toContain('run.deduped');
    expect(events).toContain('run.running');
    expect(events).toContain('run.completed');
    expect(events).toContain('status.read_hit');
    expect(events).toContain('result.read_hit');
    expect(events).toContain('latest_result.read_hit');

    const queuedKinds = lines
      .filter((line) => line.event === 'run.queued')
      .map((line) => line.workflowKind);
    expect(queuedKinds).toContain('quiz_generation');
    expect(queuedKinds).toContain('knowledge_extraction');

    const dedupedEntry = lines.find(
      (line) => line.event === 'run.deduped' && line.workflowKind === 'quiz_generation',
    );
    expect(dedupedEntry).toMatchObject({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      dedupedWorkflowRunId: quizSubmit.workflowRunId,
    });

    expect(dedupedQuizSubmit.workflowRunId).toBe(quizSubmit.workflowRunId);
    expect(dedupedQuizSubmit.deduped).toBe(true);
    expect(consoleInfoSpy).toHaveBeenCalled();
    const firstTerminalLine = consoleInfoSpy.mock.calls[0]?.[0];
    expect(firstTerminalLine).toContain('[workflow]');
    expect(firstTerminalLine).toContain('workflowKind=');
    expect(firstTerminalLine.startsWith('{')).toBe(false);
  });
});
