#!/usr/bin/env tsx

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..', '..');
const require = createRequire(import.meta.url);
const RAILWAY_SERVICE = 'Reading-Assistant';
const RAILWAY_SESSION = 'railway-skill-1782140000-graphdto-piece-debug';

type Args = {
  bookId: string;
  chapterId: string;
  pieceIndex: number;
  startPieceIndex: number;
  timeoutMs: number;
  keepTemp: boolean;
  dumpPrompts: boolean;
  output: 'summary' | 'full';
};

type ProductionPage = {
  pageIndex: number;
  sourceHash: string;
  pageParagraphs: Record<string, string>;
};

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    bookId: '',
    chapterId: '',
    pieceIndex: 0,
    startPieceIndex: 0,
    timeoutMs: 240_000,
    keepTemp: false,
    dumpPrompts: true,
    output: 'summary',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--book-id':
        parsed.bookId = argv[++index] ?? '';
        break;
      case '--chapter-id':
        parsed.chapterId = argv[++index] ?? '';
        break;
      case '--piece-index':
        parsed.pieceIndex = Number(argv[++index] ?? 0);
        break;
      case '--start-piece-index':
        parsed.startPieceIndex = Number(argv[++index] ?? 0);
        break;
      case '--timeout-ms':
        parsed.timeoutMs = Number(argv[++index] ?? 240_000);
        break;
      case '--keep-temp':
        parsed.keepTemp = true;
        break;
      case '--dump-prompts':
        parsed.dumpPrompts = true;
        break;
      case '--no-dump-prompts':
        parsed.dumpPrompts = false;
        break;
      case '--output':
        parsed.output = (argv[++index] ?? 'summary') === 'full' ? 'full' : 'summary';
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.bookId.trim()) {
    throw new Error('--book-id is required');
  }
  if (!parsed.chapterId.trim()) {
    throw new Error('--chapter-id is required');
  }
  if (!Number.isInteger(parsed.pieceIndex) || parsed.pieceIndex < 0) {
    throw new Error('--piece-index must be a non-negative integer');
  }
  if (!Number.isInteger(parsed.startPieceIndex) || parsed.startPieceIndex < 0) {
    throw new Error('--start-piece-index must be a non-negative integer');
  }
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  return parsed;
}

function printHelp() {
  console.log([
    'Usage:',
    '  npx tsx reading-app-server/scripts/debug-knowledge-piece.ts \\',
    '    --book-id <book-id> --chapter-id <chapter-id> --piece-index <n> [options]',
    '',
    'Options:',
    '  --start-piece-index <n>  Replay from this earlier piece to build memory continuity. Default: 0',
    '  --timeout-ms <n>         Override knowledge extraction LLM timeout. Default: 240000',
    '  --output <summary|full>  Print compact or full graph JSON. Default: summary',
    '  --dump-prompts           Write prompt files under a temp directory. Default: on',
    '  --no-dump-prompts        Skip prompt dumps',
    '  --keep-temp              Preserve temp directory after exit',
    '  --help                   Show this message',
  ].join('\n'));
}

function railwayEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RAILWAY_CALLER: 'skill:use-railway@1.2.2',
    RAILWAY_AGENT_SESSION: RAILWAY_SESSION,
  };
}

function logStep(step: string, details?: unknown) {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[piece-debug][${step}]${suffix}`);
}

function fail(step: string, message: string, details?: unknown): never {
  const suffix = details ? ` ${JSON.stringify(details, null, 2)}` : '';
  throw new Error(`[${step}] ${message}${suffix}`);
}

function runRailwayJson(args: string[]) {
  const result = spawnSync('railway', args, {
    cwd: ROOT_DIR,
    env: railwayEnv(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `railway ${args.join(' ')} failed`);
  }

  return JSON.parse(result.stdout);
}

async function requestJson(step: string, url: string) {
  const response = await fetch(url);
  const rawText = await response.text();

  let body: unknown = rawText;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }
  }

  if (!response.ok) {
    fail(step, 'Request failed', {
      endpoint: url,
      httpStatus: response.status,
      body,
    });
  }

  return body;
}

async function fetchProductionBookModel(baseUrl: string, bookId: string) {
  return requestJson('fetch-production-book-model', `${baseUrl}/v1/books/${bookId}/model`) as Promise<any>;
}

async function fetchProductionChapter(baseUrl: string, bookId: string, chapterId: string) {
  return requestJson('fetch-production-chapter', `${baseUrl}/v1/books/${bookId}/chapters/${chapterId}`) as Promise<any>;
}

async function fetchProductionPage(baseUrl: string, bookId: string, chapterId: string, pageIndex: number) {
  return requestJson(
    'fetch-production-page',
    `${baseUrl}/v1/books/${bookId}/chapters/${chapterId}/pages/${pageIndex}`,
  ) as Promise<ProductionPage>;
}

async function loadChapterPages(
  baseUrl: string,
  bookId: string,
  chapterId: string,
  pageCount: number,
): Promise<ProductionPage[]> {
  const pages: ProductionPage[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    pages.push(await fetchProductionPage(baseUrl, bookId, chapterId, pageIndex));
  }
  return pages.sort((left, right) => left.pageIndex - right.pageIndex);
}

function createTempRoot(keepTemp: boolean): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-piece-debug-'));
  return {
    root,
    cleanup: () => {
      if (!keepTemp) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

function summarizeGraph(result: any) {
  const countNodes = (type: string) =>
    Array.isArray(result?.nodes) ? result.nodes.filter((node: any) => node?.type === type).length : 0;

  return {
    title: result?.title ?? '',
    summaryLength: String(result?.summary ?? '').length,
    people: countNodes('person'),
    ideas: countNodes('idea'),
    events: countNodes('event'),
    entities: countNodes('entity'),
    themes: countNodes('theme'),
    edges: Array.isArray(result?.edges) ? result.edges.length : 0,
    evidence: Array.isArray(result?.evidence) ? result.evidence.length : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.KNOWLEDGE_EXTRACTION_WORKFLOW_TIMEOUT_MS = String(args.timeoutMs);

  const railwayVars = runRailwayJson(['variable', 'list', '--service', RAILWAY_SERVICE, '--json']);
  const baseUrl = `https://${String(railwayVars.RAILWAY_PUBLIC_DOMAIN ?? '').trim()}`;
  if (!baseUrl || baseUrl === 'https://') {
    fail('railway', 'Missing Railway public domain');
  }

  const bookModel = await fetchProductionBookModel(baseUrl, args.bookId);
  const chapterMeta = await fetchProductionChapter(baseUrl, args.bookId, args.chapterId);
  const pages = await loadChapterPages(baseUrl, args.bookId, args.chapterId, Number(chapterMeta.pageCount ?? 0));

  const temp = createTempRoot(args.keepTemp);
  logStep('temp.created', { root: temp.root });

  try {
    const {
      BookIngestionRepository,
    } = require('../dist/reading-app-server/src/modules/book-ingestion/book-ingestion.repository.js');
    const {
      BookContextService,
    } = require('../dist/reading-app-server/src/modules/book-ingestion/book-context.service.js');
    const {
      KnowledgeExtractionWorkflowRepository,
    } = require('../dist/reading-app-server/src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.repository.js');
    const {
      KnowledgeExtractionWorkflowService,
    } = require('../dist/reading-app-server/src/modules/knowledge-extraction-workflow/knowledge-extraction-workflow.service.js');
    const {
      WorkflowQueueService,
    } = require('../dist/reading-app-server/src/modules/workflow-queue/workflow-queue.service.js');
    const {
      buildSharedChapterPrefixCache,
    } = require('../dist/reading-app-server/src/utils/chapter-prefix-cache.js');
    const {
      config,
    } = require('../dist/reading-app-server/src/config/runtime-config.js');
    const {
      createLLMClient,
      extractJsonFromText,
    } = require('../dist/reading-app-server/services/llmService.js');

    const ingestionDir = path.join(temp.root, 'book-ingestion');
    await fsp.mkdir(ingestionDir, { recursive: true });
    const bookRepository = new BookIngestionRepository(ingestionDir);
    const workflowRepository = new KnowledgeExtractionWorkflowRepository();
    const bookContextService = new BookContextService(bookRepository, workflowRepository);
    const service = new KnowledgeExtractionWorkflowService(
      bookRepository,
      bookContextService,
      workflowRepository,
      new WorkflowQueueService(),
    ) as any;
    const incrementalRepository = new KnowledgeExtractionWorkflowRepository();

    for (const page of pages) {
      bookRepository.upsertPageFragment({
        bookId: args.bookId,
        chapterId: args.chapterId,
        chapterIndex: Number(chapterMeta.chapterIndex ?? 0),
        chapterTitle: chapterMeta.chapterTitle,
        pageIndex: page.pageIndex,
        sourceHash: page.sourceHash,
        pageParagraphs: page.pageParagraphs,
        bookMetadata: {
          isFiction: false,
        },
      });
    }

    const chapter = bookRepository.getChapter(args.bookId, args.chapterId);
    if (!chapter) {
      fail('load-chapter', 'Failed to materialize chapter in temporary repository');
    }

    const pieces = service.buildPieces(chapter);
    const targetPiece = pieces[args.pieceIndex];
    if (!targetPiece) {
      fail('piece-selection', 'Requested piece index is out of range', {
        pieceIndex: args.pieceIndex,
        totalPieces: pieces.length,
      });
    }
    if (args.startPieceIndex > args.pieceIndex) {
      fail('piece-selection', '--start-piece-index cannot exceed --piece-index', {
        startPieceIndex: args.startPieceIndex,
        pieceIndex: args.pieceIndex,
      });
    }

    logStep('source.loaded', {
      bookId: args.bookId,
      chapterId: args.chapterId,
      chapterTitle: chapter.chapterTitle ?? null,
      pageCount: pages.length,
      totalPieces: pieces.length,
      targetPieceIndex: args.pieceIndex,
      targetPages: targetPiece.pageRefs,
    });

    const bookContext = bookContextService.buildBookContextBundle(args.bookId, args.chapterId);
    const chapterContext = bookContextService.buildChapterContextBundle(args.bookId, args.chapterId);

    let finalResult: any = null;
    for (const piece of pieces.slice(args.startPieceIndex, args.pieceIndex + 1)) {
      const memorySnapshot = await incrementalRepository.buildChapterSnapshot(args.bookId, args.chapterId);
      const memoryContext = service.buildMemoryContext(memorySnapshot);
      const pageWindow =
        bookContextService.buildPageWindowContext(args.bookId, args.chapterId, piece.pageIndex)
        ?? service.createFallbackPageWindow(piece);
      const prompt = service.buildPieceSuffixPrompt({
        bookId: args.bookId,
        chapterId: args.chapterId,
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        chapterText: chapter.chapterTextMaterialized,
        chapterContentHash: chapter.chapterContentHash,
        piece,
        bookContext,
        chapterContext,
        pageWindow,
        memoryContext,
      });

      if (args.dumpPrompts) {
        await fsp.writeFile(
          path.join(temp.root, `piece-${piece.pieceIndex}-prompt.txt`),
          prompt,
          'utf8',
        );
      }

      logStep('piece.start', {
        pieceIndex: piece.pieceIndex,
        pages: piece.pageRefs,
        primaryPageIndex: piece.pageIndex,
      });

      const startedAt = performance.now();
      let result: any;
      if (piece.pieceIndex === args.pieceIndex) {
        const promptVariant = service.promptVariantForBook(args.bookId);
        const systemPrompt = await service.loadPrompt(promptVariant === 'fiction');
        const llmClient = createLLMClient({
          systemPrompt,
          model: config.knowledgeExtractionWorkflowModel,
          timeoutMs: config.knowledgeExtractionWorkflowTimeoutMs,
          prefixCache: buildSharedChapterPrefixCache({
            bookId: args.bookId,
            chapterId: args.chapterId,
            chapterIndex: chapter.chapterIndex,
            chapterTitle: chapter.chapterTitle,
            chapterContentHash: chapter.chapterContentHash,
            chapterText: chapter.chapterTextMaterialized,
            bookMetadata: {
              title: typeof bookModel?.title === 'string' ? bookModel.title : undefined,
              author: typeof bookModel?.author === 'string' ? bookModel.author : undefined,
              language: typeof bookModel?.language === 'string' ? bookModel.language : undefined,
            },
          }),
          logContext: {
            workflowKind: 'knowledge_extraction',
            bookId: args.bookId,
            chapterId: args.chapterId,
            chapterIndex: chapter.chapterIndex,
            pageIndex: piece.pageIndex,
            pageNumber: piece.pageNumber,
            pieceIndex: piece.pieceIndex,
            totalPieces: piece.totalPieces,
            sourceHash: piece.sourceHash,
          },
        });
        const response = await llmClient.json(prompt);
        let rawText = '';
        for await (const chunk of response.data) {
          rawText += chunk;
        }
        await fsp.writeFile(
          path.join(temp.root, `piece-${piece.pieceIndex}-raw.txt`),
          rawText,
          'utf8',
        );

        try {
          const parsed = extractJsonFromText(rawText);
          await fsp.writeFile(
            path.join(temp.root, `piece-${piece.pieceIndex}-parsed.json`),
            JSON.stringify(parsed, null, 2),
            'utf8',
          );
          result = service.sanitizeKnowledgeExtractionGraph(parsed, {
            chapterId: args.chapterId,
            chapterTitle: chapter.chapterTitle,
            allowedPageRefs: piece.pageRefs,
            promptVariant,
            memoryContext,
            primaryPageText: piece.rawText,
          });
          logStep('piece.raw', {
            pieceIndex: piece.pieceIndex,
            rawChars: rawText.length,
            parseStatus: 'ok',
          });
        } catch (error) {
          result = service.createEmptyKnowledgeExtractionGraph(args.chapterId, chapter.chapterTitle);
          logStep('piece.raw', {
            pieceIndex: piece.pieceIndex,
            rawChars: rawText.length,
            parseStatus: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        result = await service.generateKnowledgeExtractionForPiece({
          bookId: args.bookId,
          chapterId: args.chapterId,
          chapterIndex: chapter.chapterIndex,
          chapterTitle: chapter.chapterTitle,
          chapterText: chapter.chapterTextMaterialized,
          chapterContentHash: chapter.chapterContentHash,
          piece,
          bookContext,
          chapterContext,
          pageWindow,
          memoryContext,
        });
      }
      const elapsedMs = Math.round(performance.now() - startedAt);

      await incrementalRepository.upsertPageGraphExtraction({
        bookId: args.bookId,
        chapterId: args.chapterId,
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        extraction: result,
      });

      if (args.dumpPrompts) {
        await fsp.writeFile(
          path.join(temp.root, `piece-${piece.pieceIndex}-result.json`),
          JSON.stringify(result, null, 2),
          'utf8',
        );
      }

      logStep('piece.done', {
        pieceIndex: piece.pieceIndex,
        elapsedMs,
        summary: summarizeGraph(result),
      });
      finalResult = result;
    }

    const persistedSnapshot = await incrementalRepository.buildChapterSnapshot(args.bookId, args.chapterId);
    await fsp.writeFile(
      path.join(temp.root, 'chapter-snapshot.json'),
      JSON.stringify(persistedSnapshot, null, 2),
      'utf8',
    );

    console.log(JSON.stringify({
      tempRoot: temp.root,
      targetPieceIndex: args.pieceIndex,
      targetPages: targetPiece.pageRefs,
      finalPiece: args.output === 'full' ? finalResult : summarizeGraph(finalResult),
      chapterSnapshot: args.output === 'full'
        ? persistedSnapshot
        : {
          title: persistedSnapshot.title,
          summaryLength: String(persistedSnapshot.summary ?? '').length,
          people: persistedSnapshot.people.length,
          ideas: persistedSnapshot.ideas.length,
          events: persistedSnapshot.events.length,
          entities: persistedSnapshot.entities.length,
          themes: persistedSnapshot.themes.length,
          relations: persistedSnapshot.relations.length,
        },
    }, null, 2));
  } finally {
    temp.cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
