#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SINGLE_EVAL_SCRIPT = path.resolve(__dirname, 'evaluate-graph-dto-from-ingestion.cjs');

function parseArgs(argv) {
  const parsed = {
    bookId: '',
    chapterIds: [],
    namespace: 'LumenGraphDTOTest',
    pollTimeoutMs: 600000,
    workflowTimeoutMs: 600000,
    workflowRetryAttempts: 3,
    workflowRetryDelayMs: 10000,
    keepTemp: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--book-id':
        parsed.bookId = argv[++index] ?? '';
        break;
      case '--chapter-ids':
        parsed.chapterIds = String(argv[++index] ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        break;
      case '--namespace':
        parsed.namespace = argv[++index] ?? parsed.namespace;
        break;
      case '--poll-timeout-ms':
        parsed.pollTimeoutMs = Number(argv[++index] ?? parsed.pollTimeoutMs);
        break;
      case '--workflow-timeout-ms':
        parsed.workflowTimeoutMs = Number(argv[++index] ?? parsed.workflowTimeoutMs);
        break;
      case '--workflow-retry-attempts':
        parsed.workflowRetryAttempts = Number(argv[++index] ?? parsed.workflowRetryAttempts);
        break;
      case '--workflow-retry-delay-ms':
        parsed.workflowRetryDelayMs = Number(argv[++index] ?? parsed.workflowRetryDelayMs);
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

  if (!parsed.bookId) throw new Error('--book-id is required');
  if (parsed.chapterIds.length === 0) throw new Error('--chapter-ids is required');
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

  return parsed;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node reading-app-server/scripts/evaluate-graph-dto-chapters.cjs \\',
    '    --book-id <id> --chapter-ids <id1,id2,...> [--namespace <name>]',
    '    [--poll-timeout-ms <n>] [--workflow-timeout-ms <n>]',
    '    [--workflow-retry-attempts <n>] [--workflow-retry-delay-ms <n>] [--keep-temp]',
    '',
    'Behavior:',
    '  Runs the existing single-chapter graph DTO evaluation sequentially for each chapter id,',
    '  using a fresh test database under the given namespace for every chapter.',
  ].join('\n'));
}

function parseFinalJson(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf('\n{');
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  return JSON.parse(jsonText);
}

function runSingleChapter(args) {
  const commandArgs = [
    SINGLE_EVAL_SCRIPT,
    '--book-id', args.bookId,
    '--chapter-id', args.chapterId,
    '--namespace', args.namespace,
    '--poll-timeout-ms', String(args.pollTimeoutMs),
    '--workflow-timeout-ms', String(args.workflowTimeoutMs),
    '--workflow-retry-attempts', String(args.workflowRetryAttempts),
    '--workflow-retry-delay-ms', String(args.workflowRetryDelayMs),
  ];
  if (args.keepTemp) commandArgs.push('--keep-temp');

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024 * 16,
  });

  if (result.status !== 0) {
    throw new Error([
      `Single chapter evaluation failed for chapter ${args.chapterId}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }

  return parseFinalJson(result.stdout);
}

function buildChapterSummary(report) {
  return {
    chapterId: report.source.chapterId,
    chapterIndex: report.source.chapterIndex,
    chapterTitle: report.source.chapterTitle,
    workflowRunId: report.workflow.workflowRunId,
    workflowStatus: report.workflow.status,
    targetDatabase: report.target.database,
    result: report.api.latest,
    graphCounts: report.surreal.counts,
    checks: report.checks,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const summaries = [];
  for (const chapterId of args.chapterIds) {
    try {
      const report = runSingleChapter({
        bookId: args.bookId,
        chapterId,
        namespace: args.namespace,
        pollTimeoutMs: args.pollTimeoutMs,
        workflowTimeoutMs: args.workflowTimeoutMs,
        workflowRetryAttempts: args.workflowRetryAttempts,
        workflowRetryDelayMs: args.workflowRetryDelayMs,
        keepTemp: args.keepTemp,
      });
      summaries.push({
        status: 'completed',
        ...buildChapterSummary(report),
      });
    } catch (error) {
      summaries.push({
        status: 'failed',
        chapterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(JSON.stringify({
    bookId: args.bookId,
    namespace: args.namespace,
    pollTimeoutMs: args.pollTimeoutMs,
    workflowTimeoutMs: args.workflowTimeoutMs,
    workflowRetryAttempts: args.workflowRetryAttempts,
    workflowRetryDelayMs: args.workflowRetryDelayMs,
    chapterCount: summaries.length,
    completedCount: summaries.filter((item) => item.status === 'completed').length,
    failedCount: summaries.filter((item) => item.status === 'failed').length,
    chapters: summaries,
  }, null, 2));
}

main();
