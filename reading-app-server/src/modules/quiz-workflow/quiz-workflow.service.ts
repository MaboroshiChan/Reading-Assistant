import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BookIngestionRepository } from '../book-ingestion/book-ingestion.repository';
import type {
  GetLatestChapterQuizResponseDto,
  GetQuizWorkflowResultResponseDto,
  GetQuizWorkflowStatusResponseDto,
  SubmitQuizWorkflowRequestDto,
  SubmitQuizWorkflowResponseDto,
} from './quiz-workflow.dto';
import { QuizWorkflowRepository } from './quiz-workflow.repository';
import type {
  QuizWorkflowQuestion,
  QuizWorkflowResultPayload,
  QuizWorkflowRunRecord,
  SubmitQuizWorkflowInput,
} from './quiz-workflow.types';
import { config } from '../../config/runtime-config';
import { createLLMClient, extractJsonFromText } from '../../../services/llmService';

const PROMPT_VERSION = 'quiz.v1.0';
const PROMPT_PATH = path.join(__dirname, '..', '..', '..', '..', 'prompts', 'v1', 'quiz.txt');

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

let cachedQuizSystemPrompt: string | null = null;

@Injectable()
export class QuizWorkflowService {
  private readonly bookIngestionRepository: BookIngestionRepository;
  private readonly quizWorkflowRepository: QuizWorkflowRepository;

  constructor(
    @Inject(BookIngestionRepository) bookIngestionRepository: BookIngestionRepository,
    @Inject(QuizWorkflowRepository) quizWorkflowRepository: QuizWorkflowRepository,
  ) {
    this.bookIngestionRepository = bookIngestionRepository;
    this.quizWorkflowRepository = quizWorkflowRepository;
  }

  parseSubmitRequest(rawBody: string | undefined): SubmitQuizWorkflowRequestDto {
    if (!rawBody || rawBody.trim() === '') {
      throw new BadRequestException('Request body cannot be empty');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      throw new BadRequestException(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(parsed)) {
      throw new BadRequestException('Request body must be a JSON object');
    }

    const workflowVersion = parsed.workflowVersion === undefined
      ? 'v1'
      : this.requireString(parsed.workflowVersion, 'workflowVersion');

    return {
      bookId: this.requireString(parsed.bookId, 'bookId'),
      chapterId: this.requireString(parsed.chapterId, 'chapterId'),
      chapterIndex: this.requireNonNegativeInteger(parsed.chapterIndex, 'chapterIndex'),
      workflowVersion,
      idempotencyKey: parsed.idempotencyKey === undefined
        ? undefined
        : this.requireString(parsed.idempotencyKey, 'idempotencyKey'),
      expectedSnapshotVersion: parsed.expectedSnapshotVersion === undefined
        ? undefined
        : this.requireNonNegativeInteger(parsed.expectedSnapshotVersion, 'expectedSnapshotVersion'),
      expectedChapterContentHash: parsed.expectedChapterContentHash === undefined
        ? undefined
        : this.requireString(parsed.expectedChapterContentHash, 'expectedChapterContentHash'),
      requestedByUserId: parsed.requestedByUserId === undefined
        ? undefined
        : this.requireString(parsed.requestedByUserId, 'requestedByUserId'),
    };
  }

  submitQuizWorkflow(request: SubmitQuizWorkflowRequestDto): SubmitQuizWorkflowResponseDto {
    const book = this.bookIngestionRepository.getBook(request.bookId);
    const chapter = this.bookIngestionRepository.getChapter(request.bookId, request.chapterId);

    if (!book || !chapter) {
      throw new NotFoundException('Chapter not found in canonical ingestion state');
    }

    if (chapter.chapterIndex !== request.chapterIndex) {
      throw new ConflictException('chapterIndex does not match canonical chapter state');
    }

    if (
      request.expectedSnapshotVersion !== undefined
      && request.expectedSnapshotVersion !== book.snapshotVersion
    ) {
      throw new ConflictException('expectedSnapshotVersion does not match canonical book state');
    }

    if (
      request.expectedChapterContentHash !== undefined
      && request.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      throw new ConflictException('expectedChapterContentHash does not match canonical chapter state');
    }

    if (chapter.chapterTextMaterialized.trim().length === 0) {
      throw new ConflictException('Canonical chapter text is empty; ingest pages before submitting quiz workflow');
    }

    const input: SubmitQuizWorkflowInput = {
      ...request,
      idempotencyKey: request.idempotencyKey ?? this.buildDefaultIdempotencyKey(
        request.bookId,
        request.chapterId,
        request.workflowVersion,
        chapter.chapterContentHash,
      ),
      expectedSnapshotVersion: request.expectedSnapshotVersion ?? book.snapshotVersion,
      expectedChapterContentHash: request.expectedChapterContentHash ?? chapter.chapterContentHash,
    };

    const { run, deduped } = this.quizWorkflowRepository.createOrReuseRun(input);
    if (!deduped) {
      void this.executeRun(run.id);
    }

    const canonicalRun = deduped ? this.quizWorkflowRepository.getRun(run.id) ?? run : run;
    return this.toSubmitResponse(canonicalRun, deduped);
  }

  getWorkflowStatus(workflowRunId: string): GetQuizWorkflowStatusResponseDto {
    const run = this.requireRun(workflowRunId);
    return this.toStatusResponse(run);
  }

  getWorkflowResult(workflowRunId: string): GetQuizWorkflowResultResponseDto {
    const run = this.requireRun(workflowRunId);
    if (
      run.status !== 'completed'
      || !run.output
      || run.snapshotVersion === undefined
      || !run.chapterContentHash
    ) {
      throw new ConflictException('Quiz workflow result is not available yet');
    }

    return {
      workflowRunId: run.id,
      kind: run.kind,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      resultVersion: run.resultVersion,
      producer: run.producer,
      qualityTier: run.qualityTier,
      snapshotVersion: run.snapshotVersion,
      chapterContentHash: run.chapterContentHash,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      result: run.output,
    };
  }

  getLatestChapterQuiz(bookId: string, chapterId: string): GetLatestChapterQuizResponseDto {
    const result = this.quizWorkflowRepository.getLatestResult(bookId, chapterId);
    if (!result) {
      throw new NotFoundException('No completed quiz workflow result found for chapter');
    }

    return {
      workflowRunId: result.workflowRunId,
      bookId: result.bookId,
      chapterId: result.chapterId,
      chapterIndex: result.chapterIndex,
      workflowVersion: result.workflowVersion,
      resultVersion: result.resultVersion,
      producer: result.producer,
      qualityTier: result.qualityTier,
      snapshotVersion: result.snapshotVersion,
      chapterContentHash: result.chapterContentHash,
      updatedAt: result.updatedAt,
      result: result.result,
    };
  }

  private async executeRun(workflowRunId: string): Promise<void> {
    const runningRun = this.quizWorkflowRepository.markRunning(workflowRunId);
    if (!runningRun) return;

    const book = this.bookIngestionRepository.getBook(runningRun.bookId);
    const chapter = this.bookIngestionRepository.getChapter(runningRun.bookId, runningRun.chapterId);

    if (!book || !chapter) {
      this.quizWorkflowRepository.failRun(
        workflowRunId,
        'QUIZ_CHAPTER_NOT_FOUND',
        'Canonical chapter state was not found during workflow execution.',
      );
      return;
    }

    if (
      runningRun.expectedSnapshotVersion !== undefined
      && runningRun.expectedSnapshotVersion !== book.snapshotVersion
    ) {
      this.quizWorkflowRepository.markStale(
        workflowRunId,
        'QUIZ_CANONICAL_BOOK_STALE',
        'Canonical book snapshot changed before quiz workflow execution completed.',
      );
      return;
    }

    if (
      runningRun.expectedChapterContentHash !== undefined
      && runningRun.expectedChapterContentHash !== chapter.chapterContentHash
    ) {
      this.quizWorkflowRepository.markStale(
        workflowRunId,
        'QUIZ_CANONICAL_CHAPTER_STALE',
        'Canonical chapter content changed before quiz workflow execution completed.',
      );
      return;
    }

    if (chapter.chapterTextMaterialized.trim().length === 0) {
      this.quizWorkflowRepository.failRun(
        workflowRunId,
        'QUIZ_EMPTY_CHAPTER_TEXT',
        'Canonical chapter text is empty; unable to generate quiz.',
      );
      return;
    }

    try {
      const result = await this.generateQuiz({
        bookId: runningRun.bookId,
        chapterId: runningRun.chapterId,
        chapterTitle: chapter.chapterTitle,
        chapterText: chapter.chapterTextMaterialized,
      });

      this.quizWorkflowRepository.completeRun({
        workflowRunId,
        snapshotVersion: book.snapshotVersion,
        chapterContentHash: chapter.chapterContentHash,
        result,
      });
    } catch (error) {
      this.quizWorkflowRepository.failRun(
        workflowRunId,
        'QUIZ_GENERATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async generateQuiz(input: {
    bookId: string;
    chapterId: string;
    chapterTitle?: string;
    chapterText: string;
  }): Promise<QuizWorkflowResultPayload> {
    const [systemPrompt, userPrompt] = await Promise.all([
      this.loadPrompt(),
      Promise.resolve(this.buildPrompt(input)),
    ]);
    const llmClient = createLLMClient({ systemPrompt });
    const response = await llmClient.json(userPrompt);

    let text = '';
    for await (const chunk of response.data) {
      text += chunk;
    }

    const parsed = extractJsonFromText(text);
    const questions = this.coerceQuizQuestions(parsed);
    if (questions.length === 0) {
      throw new Error('Quiz LLM response did not contain any valid questions');
    }

    return { questions };
  }

  private buildPrompt(input: {
    bookId: string;
    chapterId: string;
    chapterTitle?: string;
    chapterText: string;
  }): string {
    const sections = [
      `Book ID: ${input.bookId}`,
      `Chapter ID: ${input.chapterId}`,
      `Chapter Title: ${input.chapterTitle ?? ''}`,
      `Prompt Version: ${PROMPT_VERSION}`,
      '',
      'Chapter text:',
      '```text',
      input.chapterText,
      '```',
      '',
      'Respond with JSON only. Do not wrap the JSON in markdown fences.',
    ];
    return sections.join('\n');
  }

  private async loadPrompt(): Promise<string> {
    if (cachedQuizSystemPrompt) return cachedQuizSystemPrompt;
    cachedQuizSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedQuizSystemPrompt;
  }

  private coerceQuizQuestions(value: unknown): QuizWorkflowQuestion[] {
    if (!isPlainObject(value) || !Array.isArray(value.questions)) return [];

    const questions = value.questions
      .map((question, index) => this.coerceQuizQuestion(question, index))
      .filter((question): question is QuizWorkflowQuestion => question !== null);

    const unique = new Map<string, QuizWorkflowQuestion>();
    for (const question of questions) {
      if (!unique.has(question.id)) {
        unique.set(question.id, question);
      }
    }

    return Array.from(unique.values());
  }

  private coerceQuizQuestion(value: unknown, index: number): QuizWorkflowQuestion | null {
    if (!isPlainObject(value)) return null;

    const options = Array.isArray(value.options)
      ? value.options.map(asString).filter((entry): entry is string => typeof entry === 'string')
      : [];
    if (options.length !== 4) return null;

    const correctAnswerIndex = asNumber(value.correctAnswerIndex);
    if (correctAnswerIndex === undefined || !Number.isInteger(correctAnswerIndex)) return null;
    if (correctAnswerIndex < 0 || correctAnswerIndex > 3) return null;

    const question = asString(value.question);
    const explanation = asString(value.explanation);
    if (!question || !explanation) return null;

    return {
      id: asString(value.id) ?? `q${index + 1}`,
      type: 'multiple_choice',
      question,
      options: [options[0], options[1], options[2], options[3]],
      correctAnswerIndex,
      explanation,
      skill: this.normalizeSkill(asString(value.skill)),
    };
  }

  private normalizeSkill(value: string | undefined): QuizWorkflowQuestion['skill'] {
    switch (value) {
      case 'Facts':
      case 'Inference':
      case 'Tone':
      case 'Argument':
        return value;
      default:
        return 'Facts';
    }
  }

  private buildDefaultIdempotencyKey(
    bookId: string,
    chapterId: string,
    workflowVersion: string,
    chapterContentHash: string,
  ): string {
    return `quiz:${workflowVersion}:${bookId}:${chapterId}:${chapterContentHash}`;
  }

  private toSubmitResponse(
    run: QuizWorkflowRunRecord,
    deduped: boolean,
  ): SubmitQuizWorkflowResponseDto {
    return {
      workflowRunId: run.id,
      kind: run.kind,
      status: run.status,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      producer: run.producer,
      qualityTier: run.qualityTier,
      resultVersion: run.resultVersion,
      snapshotVersion: run.snapshotVersion,
      chapterContentHash: run.chapterContentHash,
      deduped,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
      error: run.error,
    };
  }

  private toStatusResponse(run: QuizWorkflowRunRecord): GetQuizWorkflowStatusResponseDto {
    return {
      workflowRunId: run.id,
      kind: run.kind,
      status: run.status,
      bookId: run.bookId,
      chapterId: run.chapterId,
      chapterIndex: run.chapterIndex,
      workflowVersion: run.workflowVersion,
      producer: run.producer,
      qualityTier: run.qualityTier,
      resultVersion: run.resultVersion,
      snapshotVersion: run.snapshotVersion,
      chapterContentHash: run.chapterContentHash,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      resultAvailable: Boolean(run.output),
      error: run.error,
    };
  }

  private requireRun(workflowRunId: string): QuizWorkflowRunRecord {
    const run = this.quizWorkflowRepository.getRun(workflowRunId);
    if (!run) {
      throw new NotFoundException('Quiz workflow run not found');
    }
    return run;
  }

  private requireString(value: unknown, fieldName: string): string {
    if (!isNonEmptyString(value)) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  }

  private requireNonNegativeInteger(value: unknown, fieldName: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${fieldName} must be a non-negative integer`);
    }
    return value;
  }
}
