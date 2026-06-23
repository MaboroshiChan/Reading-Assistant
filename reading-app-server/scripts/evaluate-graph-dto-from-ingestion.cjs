#!/usr/bin/env node

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_TEST_NAMESPACE = 'LumenGraphDTOTest';
const DEFAULT_MAX_PAGES = 8;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 600_000;
const DEFAULT_WORKFLOW_TIMEOUT_MS = 600_000;
const DEFAULT_PROGRESS_STALL_TIMEOUT_MS = 360_000;
const DEFAULT_WORKFLOW_RETRY_ATTEMPTS = 3;
const DEFAULT_WORKFLOW_RETRY_DELAY_MS = 10_000;
const SOURCE_RAILWAY_SERVICE = 'Reading-Assistant';
const TARGET_RAILWAY_SERVICE = 'reading-assistant-graphdto-test';
const RAILWAY_SESSION = 'railway-skill-1782140000-graphdto-test';
const EXCLUDED_BOOK_PREFIXES = ['smoke-', 'test-', 'tmp-'];

function parseArgs(argv) {
  const parsed = {
    bookId: '',
    title: '',
    chapterId: '',
    namespace: DEFAULT_TEST_NAMESPACE,
    database: '',
    maxPages: DEFAULT_MAX_PAGES,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    workflowTimeoutMs: DEFAULT_WORKFLOW_TIMEOUT_MS,
    workflowRetryAttempts: DEFAULT_WORKFLOW_RETRY_ATTEMPTS,
    workflowRetryDelayMs: DEFAULT_WORKFLOW_RETRY_DELAY_MS,
    listBooks: false,
    keepTemp: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--book-id':
        parsed.bookId = argv[++index] ?? '';
        break;
      case '--title':
        parsed.title = argv[++index] ?? '';
        break;
      case '--chapter-id':
        parsed.chapterId = argv[++index] ?? '';
        break;
      case '--namespace':
        parsed.namespace = argv[++index] ?? DEFAULT_TEST_NAMESPACE;
        break;
      case '--database':
        parsed.database = argv[++index] ?? '';
        break;
      case '--max-pages':
        parsed.maxPages = Number(argv[++index] ?? DEFAULT_MAX_PAGES);
        break;
      case '--poll-timeout-ms':
        parsed.pollTimeoutMs = Number(argv[++index] ?? DEFAULT_POLL_TIMEOUT_MS);
        break;
      case '--workflow-timeout-ms':
        parsed.workflowTimeoutMs = Number(argv[++index] ?? DEFAULT_WORKFLOW_TIMEOUT_MS);
        break;
      case '--workflow-retry-attempts':
        parsed.workflowRetryAttempts = Number(argv[++index] ?? DEFAULT_WORKFLOW_RETRY_ATTEMPTS);
        break;
      case '--workflow-retry-delay-ms':
        parsed.workflowRetryDelayMs = Number(argv[++index] ?? DEFAULT_WORKFLOW_RETRY_DELAY_MS);
        break;
      case '--list-books':
        parsed.listBooks = true;
        break;
      case '--keep-temp':
        parsed.keepTemp = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.bookId && parsed.title) {
    throw new Error('Use either --book-id or --title, not both');
  }

  if (!Number.isInteger(parsed.maxPages) || parsed.maxPages <= 0) {
    throw new Error('--max-pages must be a positive integer');
  }
  if (!Number.isInteger(parsed.pollTimeoutMs) || parsed.pollTimeoutMs <= 0) {
    throw new Error('--poll-timeout-ms must be a positive integer');
  }
  if (!Number.isInteger(parsed.workflowTimeoutMs) || parsed.workflowTimeoutMs <= 0) {
    throw new Error('--workflow-timeout-ms must be a positive integer');
  }
  if (!Number.isInteger(parsed.workflowRetryAttempts) || parsed.workflowRetryAttempts <= 0) {
    throw new Error('--workflow-retry-attempts must be a positive integer');
  }
  if (!Number.isInteger(parsed.workflowRetryDelayMs) || parsed.workflowRetryDelayMs <= 0) {
    throw new Error('--workflow-retry-delay-ms must be a positive integer');
  }

  if (!/^[A-Za-z0-9_]+$/.test(parsed.namespace)) {
    throw new Error('--namespace must contain only letters, numbers, and underscores');
  }

  if (parsed.database && !/^[A-Za-z0-9_]+$/.test(parsed.database)) {
    throw new Error('--database must contain only letters, numbers, and underscores');
  }

  return parsed;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node reading-app-server/scripts/evaluate-graph-dto-from-ingestion.cjs [options]',
    '',
    'Options:',
    '  --list-books           List candidate production books discovered from Railway Surreal',
    '  --book-id <id>         Use a specific production book id as the source ingestion',
    '  --title <text>         Select the first production book whose live model title matches',
    '  --chapter-id <id>      Force a specific chapter id inside the selected book',
    `  --namespace <name>     Test Surreal namespace. Default: ${DEFAULT_TEST_NAMESPACE}`,
    '  --database <name>      Target database name inside the test namespace. Default: run_<timestamp>',
    `  --max-pages <n>        Prefer chapters with at most n pages. Default: ${DEFAULT_MAX_PAGES}`,
    `  --poll-timeout-ms <n>  Wait this long for workflow completion. Default: ${DEFAULT_POLL_TIMEOUT_MS}`,
    `  --workflow-timeout-ms <n>  Override local workflow timeout env. Default: ${DEFAULT_WORKFLOW_TIMEOUT_MS}`,
    `  --workflow-retry-attempts <n>  Whole-workflow retries after retryable 503 failures. Default: ${DEFAULT_WORKFLOW_RETRY_ATTEMPTS}`,
    `  --workflow-retry-delay-ms <n>  Delay between whole-workflow retries. Default: ${DEFAULT_WORKFLOW_RETRY_DELAY_MS}`,
    '  --keep-temp            Reserved flag; kept for wrapper compatibility',
    '  --help                 Show this message',
    '',
    'Behavior:',
    '  1. Discover existing production books from the current Railway Surreal namespace',
    '  2. Ensure the dedicated test namespace exists, then create a fresh per-run database',
    '  3. Replay one real chapter from the production Railway service into the Railway test service',
    '  4. Run knowledge extraction on the Railway test service',
    '  5. Report graph table counts plus storage shape checks from the isolated test database',
  ].join('\n'));
}

function logStep(step, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[graph-dto-eval][${step}]${suffix}`);
}

function fail(step, message, details) {
  const suffix = details ? ` ${JSON.stringify(details, null, 2)}` : '';
  const error = new Error(`[${step}] ${message}${suffix}`);
  error.step = step;
  error.details = details;
  throw error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractWorkflowErrorMessage(workflowStatus) {
  const message = workflowStatus?.error?.message;
  if (typeof message !== 'string') return '';
  return message;
}

function isRetryableWorkflowFailure(error) {
  const details = error?.details;
  const lastBody = details?.lastBody;
  if (!lastBody || lastBody.status !== 'failed') return false;
  if (lastBody.error?.code !== 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED') return false;
  const errorMessage = extractWorkflowErrorMessage(lastBody);
  return /(503|UNAVAILABLE|Service Unavailable)/i.test(errorMessage);
}

function summarizeWorkflowAttempt(attempt, submit, status, error) {
  return {
    attempt,
    workflowRunId: submit?.workflowRunId ?? null,
    status: status?.status ?? error?.details?.lastBody?.status ?? 'unknown',
    errorCode: error?.details?.lastBody?.error?.code ?? null,
    errorMessage: error?.details?.lastBody?.error?.message ?? null,
  };
}

function railwayEnv() {
  return {
    ...process.env,
    RAILWAY_CALLER: 'skill:use-railway@1.2.2',
    RAILWAY_AGENT_SESSION: RAILWAY_SESSION,
  };
}

function runRailwayJson(args) {
  const result = spawnSync('railway', args, {
    cwd: ROOT_DIR,
    env: railwayEnv(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `railway ${args.join(' ')} failed`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse Railway JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveSurrealConfig(vars) {
  const url = String(vars.SURREAL_URL ?? '').trim();
  const publicHost = String(vars.RAILWAY_SERVICE_SURREALDB_3_X_LATEST__URL ?? '').trim();

  if (!url || !vars.SURREAL_NS || !vars.SURREAL_DB || !vars.SURREAL_USER || !vars.SURREAL_PASS) {
    throw new Error('Missing required Surreal Railway variables');
  }

  return {
    url: url.includes('railway.internal') && publicHost ? `https://${publicHost}` : url.replace(/\/+$/, ''),
    namespace: String(vars.SURREAL_NS),
    database: String(vars.SURREAL_DB),
    user: String(vars.SURREAL_USER),
    pass: String(vars.SURREAL_PASS),
  };
}

async function surrealQuery(config, sql, overrides = {}) {
  const namespace = overrides.namespace ?? config.namespace;
  const database = overrides.database ?? config.database;

  const response = await fetch(`${config.url.replace(/\/+$/, '')}/sql`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.user}:${config.pass}`, 'utf8').toString('base64')}`,
      'Surreal-NS': namespace,
      'Surreal-DB': database,
      'Content-Type': 'text/plain',
    },
    body: sql,
  });

  const payload = await response.json().catch(async () => {
    const text = await response.text();
    throw new Error(`SurrealDB returned non-JSON: ${text}`);
  });

  if (!response.ok) {
    throw new Error(`SurrealDB HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected SurrealDB payload: ${JSON.stringify(payload)}`);
  }

  for (const statement of payload) {
    if (statement.status !== 'OK') {
      const detail = typeof statement.detail === 'string' && statement.detail.trim()
        ? statement.detail
        : statement.result;
      throw new Error(`SurrealDB statement failed: ${String(detail)}`);
    }
  }

  return payload;
}

async function ensureTestNamespace(config, namespace, database) {
  const rootInfo = await surrealQuery(config, 'INFO FOR ROOT;');
  const namespaces = rootInfo[0]?.result?.namespaces ?? {};
  const namespaceExists = Object.prototype.hasOwnProperty.call(namespaces, namespace);

  if (!namespaceExists) {
    await surrealQuery(config, `DEFINE NAMESPACE ${namespace};`);
  }

  const nsInfo = await surrealQuery(
    { ...config, namespace, database },
    'INFO FOR NS;',
    { namespace, database },
  );
  const databases = nsInfo[0]?.result?.databases ?? {};
  const databaseExists = Object.prototype.hasOwnProperty.call(databases, database);

  if (!databaseExists) {
    await surrealQuery(
      { ...config, namespace, database },
      `DEFINE DATABASE ${database};`,
      { namespace, database },
    );
  }

  return { namespaceExists, databaseExists };
}

async function clearTestDatabase(config, namespace, database) {
  const info = await surrealQuery(
    { ...config, namespace, database },
    'INFO FOR DB;',
    { namespace, database },
  );
  const tables = Object.keys(info[0]?.result?.tables ?? {});
  if (tables.length === 0) {
    return { clearedTables: [] };
  }

  await surrealQuery(
    { ...config, namespace, database },
    tables.map((table) => `DELETE ${table};`).join('\n'),
    { namespace, database },
  );

  return { clearedTables: tables.sort() };
}

function firstCount(result) {
  if (!Array.isArray(result) || result.length === 0) return 0;
  const row = result[0] ?? {};
  return Number(row.count ?? 0);
}

function toChapterMap(rows) {
  const byBookId = new Map();
  for (const row of rows) {
    const bookId = String(row.bookId ?? '').trim();
    if (!bookId) continue;
    const current = byBookId.get(bookId) ?? {
      bookId,
      chapterCount: 0,
      firstChapterId: '',
      firstChapterIndex: Number.POSITIVE_INFINITY,
      firstChapterTitle: '',
    };
    current.chapterCount += 1;
    const chapterIndex = Number(row.chapterIndex ?? Number.POSITIVE_INFINITY);
    if (chapterIndex < current.firstChapterIndex) {
      current.firstChapterIndex = chapterIndex;
      current.firstChapterId = String(row.chapterId ?? '');
      current.firstChapterTitle = String(row.title ?? '');
    }
    byBookId.set(bookId, current);
  }
  return byBookId;
}

function isExcludedBookId(bookId) {
  return EXCLUDED_BOOK_PREFIXES.some((prefix) => bookId.startsWith(prefix));
}

async function discoverCandidateBooks(surrealConfig) {
  const payload = await surrealQuery(
    surrealConfig,
    'SELECT bookId FROM book; SELECT bookId, chapterId, chapterIndex, title FROM chapter ORDER BY chapterIndex ASC;',
  );

  const bookRows = payload[0]?.result ?? [];
  const chapterRows = payload[1]?.result ?? [];
  const chapterMap = toChapterMap(chapterRows);

  return bookRows
    .map((row) => String(row.bookId ?? '').trim())
    .filter(Boolean)
    .filter((bookId) => !isExcludedBookId(bookId))
    .map((bookId) => chapterMap.get(bookId) ?? {
      bookId,
      chapterCount: 0,
      firstChapterId: '',
      firstChapterIndex: Number.POSITIVE_INFINITY,
      firstChapterTitle: '',
    })
    .filter((candidate) => candidate.chapterCount > 0)
    .sort((left, right) => {
      const chapterDelta = left.chapterCount - right.chapterCount;
      if (chapterDelta !== 0) return chapterDelta;
      return left.bookId.localeCompare(right.bookId);
    });
}

async function requestJson(step, url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    fail(step, 'Request could not reach endpoint', {
      endpoint: url,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const rawText = await response.text();

  let body = rawText;
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

async function fetchProductionBookModel(baseUrl, bookId) {
  return requestJson('fetch-production-book-model', `${baseUrl}/v1/books/${bookId}/model`);
}

async function fetchProductionChapter(baseUrl, bookId, chapterId) {
  return requestJson('fetch-production-chapter', `${baseUrl}/v1/books/${bookId}/chapters/${chapterId}`);
}

async function fetchProductionPage(baseUrl, bookId, chapterId, pageIndex) {
  return requestJson(
    'fetch-production-page',
    `${baseUrl}/v1/books/${bookId}/chapters/${chapterId}/pages/${pageIndex}`,
  );
}

async function resolveSourceBook(baseUrl, candidates, args) {
  if (args.bookId) {
    const model = await fetchProductionBookModel(baseUrl, args.bookId);
    return { bookId: args.bookId, model };
  }

  if (args.title) {
    const needle = args.title.toLowerCase();
    for (const candidate of candidates) {
      const model = await fetchProductionBookModel(baseUrl, candidate.bookId);
      const title = String(model?.meta?.title ?? '').toLowerCase();
      if (title.includes(needle)) {
        return { bookId: candidate.bookId, model };
      }
    }
    fail('resolve-source-book', 'No production book matched --title', { title: args.title });
  }

  for (const candidate of candidates) {
    const model = await fetchProductionBookModel(baseUrl, candidate.bookId);
    if (Array.isArray(model?.chapters) && model.chapters.length > 0) {
      return { bookId: candidate.bookId, model };
    }
  }

  fail('resolve-source-book', 'No production book with usable ingestion was found');
}

async function resolveSourceChapter(baseUrl, sourceBook, args) {
  const chapters = [...sourceBook.model.chapters].sort((left, right) => left.chapterIndex - right.chapterIndex);

  if (args.chapterId) {
    const chapter = chapters.find((item) => item.chapterId === args.chapterId);
    if (!chapter) {
      fail('resolve-source-chapter', 'The requested --chapter-id is not part of the selected source book', {
        chapterId: args.chapterId,
        bookId: sourceBook.bookId,
      });
    }
    const chapterMeta = await fetchProductionChapter(baseUrl, sourceBook.bookId, chapter.chapterId);
    return { chapter, chapterMeta };
  }

  let fallback = null;
  for (const chapter of chapters) {
    const chapterMeta = await fetchProductionChapter(baseUrl, sourceBook.bookId, chapter.chapterId);
    if (chapterMeta.pageCount > 0 && !fallback) {
      fallback = { chapter, chapterMeta };
    }
    if (chapterMeta.pageCount > 0 && chapterMeta.pageCount <= args.maxPages) {
      return { chapter, chapterMeta };
    }
  }

  if (fallback) {
    return fallback;
  }

  fail('resolve-source-chapter', 'No chapter with at least one ingested page was found', {
    bookId: sourceBook.bookId,
  });
}

async function loadChapterPages(baseUrl, bookId, chapterId, pageCount) {
  const pages = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    pages.push(await fetchProductionPage(baseUrl, bookId, chapterId, pageIndex));
  }
  return pages.sort((left, right) => left.pageIndex - right.pageIndex);
}

async function upsertChapterBatch(baseUrl, payload) {
  return requestJson(
    'upsert-test-batch',
    `${baseUrl}/v1/books/${payload.bookId}/chapters/${payload.chapterId}/pages:batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

async function submitKnowledgeExtraction(baseUrl, payload) {
  return requestJson('submit-knowledge-extraction', `${baseUrl}/v1/workflows/knowledge-extraction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function pollWorkflow(baseUrl, workflowRunId, pollTimeoutMs) {
  const startedAt = performance.now();
  const deadline = startedAt + pollTimeoutMs;
  const stallTimeoutMs = Math.min(DEFAULT_PROGRESS_STALL_TIMEOUT_MS, pollTimeoutMs);
  let lastBody = null;
  let lastProgressSignature = '';
  let lastProgressAt = startedAt;

  while (performance.now() <= deadline) {
    lastBody = await requestJson(
      'poll-knowledge-extraction',
      `${baseUrl}/v1/workflows/knowledge-extraction/${workflowRunId}`,
    );
    const now = performance.now();
    const progress = lastBody?.progress ?? null;
    const progressSignature = JSON.stringify({
      status: lastBody?.status ?? null,
      percent: progress?.percent ?? null,
      stage: progress?.stage ?? null,
      updatedAt: lastBody?.updatedAt ?? null,
      resultAvailable: lastBody?.resultAvailable ?? null,
    });
    if (progressSignature !== lastProgressSignature) {
      lastProgressSignature = progressSignature;
      lastProgressAt = now;
      logStep('workflow.progress', {
        workflowRunId,
        status: lastBody?.status ?? null,
        progress,
        updatedAt: lastBody?.updatedAt ?? null,
        elapsedMs: Math.round(now - startedAt),
      });
    }
    if (lastBody.status === 'completed') return lastBody;
    if (lastBody.status === 'failed' || lastBody.status === 'stale') {
      fail('poll-knowledge-extraction', 'Workflow reached a non-success terminal state', { lastBody });
    }
    if (now - lastProgressAt > stallTimeoutMs) {
      fail('poll-knowledge-extraction', 'Workflow appears stalled without progress updates', {
        workflowRunId,
        pollTimeoutMs,
        stallTimeoutMs,
        elapsedMs: Math.round(now - startedAt),
        lastProgressAgeMs: Math.round(now - lastProgressAt),
        lastBody,
      });
    }
    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }

  fail('poll-knowledge-extraction', 'Timed out waiting for workflow completion', {
    workflowRunId,
    pollTimeoutMs,
    elapsedMs: Math.round(performance.now() - startedAt),
    lastProgressAgeMs: Math.round(performance.now() - lastProgressAt),
    lastBody,
  });
}

async function fetchKnowledgeResult(baseUrl, workflowRunId) {
  return requestJson(
    'fetch-knowledge-result',
    `${baseUrl}/v1/workflows/knowledge-extraction/${workflowRunId}/result`,
  );
}

async function fetchLatestKnowledge(baseUrl, bookId, chapterId) {
  return requestJson(
    'fetch-latest-knowledge',
    `${baseUrl}/v1/books/${bookId}/chapters/${chapterId}/knowledge-extraction`,
  );
}

async function fetchBookModel(baseUrl, bookId) {
  return requestJson('fetch-test-book-model', `${baseUrl}/v1/books/${bookId}/model`);
}

async function waitForRemoteService(baseUrl, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() <= deadline) {
    try {
      const response = await fetch(`${baseUrl}/ping`);
      if (response.ok) return;
    } catch {
      // wait and retry
    }

    await sleep(500);
  }

  fail('wait-for-remote-service', 'Timed out waiting for the Railway test service', {
    baseUrl,
    timeoutMs,
  });
}

function summarizeKnowledgeResult(result) {
  return {
    title: result.title,
    summaryLength: String(result.summary ?? '').length,
    people: Array.isArray(result.people) ? result.people.length : 0,
    ideas: Array.isArray(result.ideas) ? result.ideas.length : 0,
    events: Array.isArray(result.events) ? result.events.length : 0,
    entities: Array.isArray(result.entities) ? result.entities.length : 0,
    themes: Array.isArray(result.themes) ? result.themes.length : 0,
    relations: Array.isArray(result.relations) ? result.relations.length : 0,
  };
}

function isTitleSummaryOnly(keys) {
  return Array.isArray(keys)
    && keys.length === 2
    && keys[0] === 'summary'
    && keys[1] === 'title';
}

async function buildSurrealReport(config, namespace, database) {
  const payload = await surrealQuery(
    { ...config, namespace, database },
    [
      'SELECT count() AS count FROM workflow_run GROUP ALL;',
      'SELECT count() AS count FROM chapter_knowledge_snapshot GROUP ALL;',
      'SELECT count() AS count FROM page_knowledge_extraction_cache GROUP ALL;',
      'SELECT count() AS count FROM book GROUP ALL;',
      'SELECT count() AS count FROM chapter GROUP ALL;',
      'SELECT count() AS count FROM person GROUP ALL;',
      'SELECT count() AS count FROM concept GROUP ALL;',
      'SELECT count() AS count FROM event GROUP ALL;',
      'SELECT count() AS count FROM entity GROUP ALL;',
      'SELECT count() AS count FROM theme GROUP ALL;',
      'SELECT count() AS count FROM related_to GROUP ALL;',
      'SELECT count() AS count FROM appears_in GROUP ALL;',
      'SELECT count() AS count FROM part_of GROUP ALL;',
      'SELECT count() AS count FROM knowledge_evidence GROUP ALL;',
      'SELECT * FROM page_knowledge_extraction_cache LIMIT 1;',
      'SELECT * FROM chapter_knowledge_snapshot LIMIT 1;',
      "SELECT * FROM workflow_run WHERE status = 'completed' LIMIT 1;",
      'SELECT * FROM related_to LIMIT 5;',
      'SELECT * FROM knowledge_evidence LIMIT 5;',
    ].join('\n'),
    { namespace, database },
  );

  const counts = {
    workflowRun: firstCount(payload[0]?.result),
    chapterSnapshot: firstCount(payload[1]?.result),
    pageCache: firstCount(payload[2]?.result),
    book: firstCount(payload[3]?.result),
    chapter: firstCount(payload[4]?.result),
    person: firstCount(payload[5]?.result),
    concept: firstCount(payload[6]?.result),
    event: firstCount(payload[7]?.result),
    entity: firstCount(payload[8]?.result),
    theme: firstCount(payload[9]?.result),
    relatedTo: firstCount(payload[10]?.result),
    appearsIn: firstCount(payload[11]?.result),
    partOf: firstCount(payload[12]?.result),
    evidence: firstCount(payload[13]?.result),
  };

  const pageCacheSample = Array.isArray(payload[14]?.result) ? payload[14].result[0] ?? null : null;
  const snapshotSample = Array.isArray(payload[15]?.result) ? payload[15].result[0] ?? null : null;
  const runSample = Array.isArray(payload[16]?.result) ? payload[16].result[0] ?? null : null;
  const relationSamples = Array.isArray(payload[17]?.result) ? payload[17].result : [];
  const evidenceSamples = Array.isArray(payload[18]?.result) ? payload[18].result : [];

  return {
    counts,
    pageCacheSampleKeys: pageCacheSample ? Object.keys(pageCacheSample).sort() : [],
    pageCacheHasExtractionPayload: Boolean(pageCacheSample && Object.prototype.hasOwnProperty.call(pageCacheSample, 'extraction')),
    snapshotResultKeys: snapshotSample?.result ? Object.keys(snapshotSample.result).sort() : [],
    workflowOutputKeys: runSample?.output ? Object.keys(runSample.output).sort() : [],
    relationSamples,
    evidenceSamples,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const sourceRailwayVars = runRailwayJson(['variable', 'list', '--service', SOURCE_RAILWAY_SERVICE, '--json']);
  const targetRailwayVars = runRailwayJson(['variable', 'list', '--service', TARGET_RAILWAY_SERVICE, '--json']);
  const railwayStatus = runRailwayJson(['status', '--json']);
  const sourceSurrealConfig = resolveSurrealConfig(sourceRailwayVars);
  const targetSurrealConfig = resolveSurrealConfig(targetRailwayVars);
  const sourceBaseUrl = `https://${String(sourceRailwayVars.RAILWAY_PUBLIC_DOMAIN).trim()}`;
  const targetBaseUrl = `https://${String(targetRailwayVars.RAILWAY_PUBLIC_DOMAIN).trim()}`;
  const candidates = await discoverCandidateBooks(sourceSurrealConfig);

  if (args.listBooks) {
    console.log(JSON.stringify({
      service: SOURCE_RAILWAY_SERVICE,
      namespace: sourceSurrealConfig.namespace,
      database: sourceSurrealConfig.database,
      candidateCount: candidates.length,
      candidates,
    }, null, 2));
    return;
  }

  if (candidates.length === 0) {
    fail('discover-candidates', 'No production books were found in the live Surreal namespace');
  }

  const sourceBook = await resolveSourceBook(sourceBaseUrl, candidates, args);
  const sourceChapter = await resolveSourceChapter(sourceBaseUrl, sourceBook, args);
  const sourcePages = await loadChapterPages(
    sourceBaseUrl,
    sourceBook.bookId,
    sourceChapter.chapter.chapterId,
    sourceChapter.chapterMeta.pageCount,
  );
  const targetIdSuffix = randomUUID().slice(0, 8);
  const targetBookId = `graphdto-${targetIdSuffix}-${sourceBook.bookId}`;
  const targetChapterId = `graphdto-${targetIdSuffix}-${sourceChapter.chapter.chapterId}`;

  if (args.database && args.database !== targetSurrealConfig.database) {
    fail('target-database', 'Remote Railway test service is pinned to a single Surreal database; update service env before overriding it', {
      requestedDatabase: args.database,
      configuredDatabase: targetSurrealConfig.database,
      service: TARGET_RAILWAY_SERVICE,
    });
  }

  const targetDatabase = targetSurrealConfig.database || args.database || `run_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${randomUUID().slice(0, 6)}`;
  const ensured = await ensureTestNamespace(targetSurrealConfig, args.namespace, targetDatabase);
  const cleared = await clearTestDatabase(targetSurrealConfig, args.namespace, targetDatabase);
  let report = null;

  await waitForRemoteService(targetBaseUrl);

    let upsert;
    let submit;
    let status;
    let result;
    let latest;
    let bookModel;
    let surrealReport;
    const workflowAttempts = [];

    try {
      const batchPayload = {
        bookId: targetBookId,
        chapterId: targetChapterId,
        chapterIndex: sourceChapter.chapter.chapterIndex,
        chapterTitle: sourceChapter.chapter.title,
        bookMetadata: {
          title: sourceBook.model.meta?.title,
          author: sourceBook.model.meta?.author,
          language: sourceBook.model.meta?.language,
        },
        pages: sourcePages.map((page) => ({
          pageIndex: page.pageIndex,
          sourceHash: page.sourceHash,
          pageParagraphs: page.pageParagraphs,
        })),
        bookIngestionCompleted: false,
      };

      logStep('source.selected', {
        bookId: sourceBook.bookId,
        bookTitle: sourceBook.model.meta?.title,
        chapterId: sourceChapter.chapter.chapterId,
        chapterIndex: sourceChapter.chapter.chapterIndex,
        chapterTitle: sourceChapter.chapter.title,
        pageCount: sourcePages.length,
        liveService: railwayStatus?.name,
      });

      logStep('target.prepared', {
        surrealUrl: targetSurrealConfig.url,
        targetBaseUrl,
        namespace: args.namespace,
        database: targetDatabase,
        targetBookId,
        targetChapterId,
        namespaceExists: ensured.namespaceExists,
        databaseExists: ensured.databaseExists,
        clearedTableCount: cleared.clearedTables.length,
      });

      upsert = await upsertChapterBatch(targetBaseUrl, batchPayload);

      for (let attempt = 1; attempt <= args.workflowRetryAttempts; attempt += 1) {
        try {
          submit = await submitKnowledgeExtraction(targetBaseUrl, {
            bookId: targetBookId,
            chapterId: targetChapterId,
            chapterIndex: sourceChapter.chapter.chapterIndex,
            workflowVersion: 'v1',
            idempotencyKey: `graph-dto-eval:${targetBookId}:${targetChapterId}:${targetDatabase}:attempt_${attempt}`,
            expectedSnapshotVersion: upsert.snapshotVersion,
            expectedChapterContentHash: upsert.chapterContentHash,
          });
          status = await pollWorkflow(targetBaseUrl, submit.workflowRunId, args.pollTimeoutMs);
          result = await fetchKnowledgeResult(targetBaseUrl, submit.workflowRunId);
          latest = await fetchLatestKnowledge(targetBaseUrl, targetBookId, targetChapterId);
          bookModel = await fetchBookModel(targetBaseUrl, targetBookId);
          surrealReport = await buildSurrealReport(targetSurrealConfig, args.namespace, targetDatabase);
          workflowAttempts.push(summarizeWorkflowAttempt(attempt, submit, status, null));
          break;
        } catch (error) {
          workflowAttempts.push(summarizeWorkflowAttempt(attempt, submit, status, error));
          if (isRetryableWorkflowFailure(error) && attempt < args.workflowRetryAttempts) {
            logStep('workflow.retrying', {
              attempt,
              nextAttempt: attempt + 1,
              workflowRunId: submit?.workflowRunId ?? null,
              retryDelayMs: args.workflowRetryDelayMs,
              database: targetDatabase,
            });
            await sleep(args.workflowRetryDelayMs);
            continue;
          }
          throw error;
        }
      }

      if (!status || !result || !latest || !bookModel || !surrealReport) {
        fail('chapter-eval', 'Workflow attempts exhausted without producing a successful result', {
          targetDatabase,
          chapterId: sourceChapter.chapter.chapterId,
          chapterTitle: sourceChapter.chapter.title,
          workflowAttempts,
        });
      }
    } catch (error) {
      fail('chapter-eval', error instanceof Error ? error.message : String(error), {
        targetDatabase,
        chapterId: sourceChapter.chapter.chapterId,
        chapterTitle: sourceChapter.chapter.title,
        workflowAttempts,
        targetBaseUrl,
      });
    }

    report = {
      source: {
        liveBaseUrl: sourceBaseUrl,
        bookId: sourceBook.bookId,
        bookTitle: sourceBook.model.meta?.title,
        chapterId: sourceChapter.chapter.chapterId,
        chapterIndex: sourceChapter.chapter.chapterIndex,
        chapterTitle: sourceChapter.chapter.title,
        pageCount: sourcePages.length,
      },
      target: {
        bookId: targetBookId,
        chapterId: targetChapterId,
        namespace: args.namespace,
        database: targetDatabase,
        targetBaseUrl,
        clearedTables: cleared.clearedTables,
      },
      workflow: {
        workflowRunId: submit.workflowRunId,
        status: status.status,
        snapshotVersion: latest.snapshotVersion,
        chapterContentHash: latest.chapterContentHash,
        attemptCount: workflowAttempts.length,
        attempts: workflowAttempts,
      },
      api: {
        result: summarizeKnowledgeResult(result.result),
        latest: summarizeKnowledgeResult(latest.result),
        keyInformation: {
          people: bookModel.keyInformation?.people?.length ?? 0,
          ideas: bookModel.keyInformation?.ideas?.length ?? 0,
          events: bookModel.keyInformation?.events?.length ?? 0,
          entities: bookModel.keyInformation?.entities?.length ?? 0,
          themes: bookModel.keyInformation?.themes?.length ?? 0,
          relations: bookModel.keyInformation?.relations?.length ?? 0,
        },
      },
      surreal: surrealReport,
      checks: {
        latestShapePreserved: Array.isArray(latest.result.people)
          && Array.isArray(latest.result.ideas)
          && Array.isArray(latest.result.events)
          && Array.isArray(latest.result.entities)
          && Array.isArray(latest.result.themes)
          && Array.isArray(latest.result.relations),
        pageCacheSlimMetadata: surrealReport.pageCacheHasExtractionPayload === false,
        snapshotSlimResult: isTitleSummaryOnly(surrealReport.snapshotResultKeys),
        workflowSlimOutput: isTitleSummaryOnly(surrealReport.workflowOutputKeys),
        graphTablesPopulated: surrealReport.counts.person
          + surrealReport.counts.concept
          + surrealReport.counts.event
          + surrealReport.counts.entity
          + surrealReport.counts.theme > 0,
      },
    };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
