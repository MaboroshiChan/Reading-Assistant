#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const TABLE_ORDER = [
  'workflow_run',
  'chapter_knowledge_snapshot',
  'page_knowledge_extraction_cache',
  'book',
  'chapter',
  'person',
  'concept',
  'theme',
  'entity',
  'event',
  'appears_in',
  'related_to',
  'part_of',
];

const KEY_BUILDERS = {
  book: (row) => row.bookId,
  chapter: (row) => `${row.bookId}::${row.chapterId}`,
  person: (row) => row.normalizedName,
  concept: (row) => row.normalizedLabel,
  theme: (row) => row.normalizedLabel,
  entity: (row) => `${row.entityType}::${row.normalizedLabel}`,
  event: (row) => `${row.bookId}::${row.chapterId}::${row.normalizedLabel}`,
  appears_in: (row) => `${row.chapterRecordId}::${row.nodeRecordId}`,
  related_to: (row) => `${row.chapterRecordId}::${row.fromRecordId}::${row.relationType}::${row.toRecordId}`,
  part_of: (row) => `${row.bookRecordId}::${row.chapterRecordId}`,
  workflow_run: (row) => row.idempotencyKey,
  chapter_knowledge_snapshot: (row) => `${row.bookId}::${row.chapterId}`,
  page_knowledge_extraction_cache: (row) =>
    `${row.bookId}::${row.chapterId}::${row.pageIndex}::${row.promptVersion}::${row.sourceHash}`,
};

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    failOnDuplicates: argv.includes('--fail-on-duplicates'),
  };
}

function fetchTables() {
  const sql = TABLE_ORDER.map((table) => `SELECT * FROM ${table};`).join(' ');
  const result = spawnSync(
    process.execPath,
    ['reading-app-server/scripts/surreal-query.cjs', '--json', sql],
    { encoding: 'utf8', cwd: process.cwd() },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Failed to query SurrealDB');
  }

  const payload = JSON.parse(result.stdout);
  return Object.fromEntries(TABLE_ORDER.map((table, index) => [table, payload[index]?.result || []]));
}

function findDuplicates(rows, keyBuilder) {
  const grouped = new Map();

  for (const row of rows) {
    const key = keyBuilder(row);
    const bucket = grouped.get(key) || [];
    bucket.push(row.id || row.recordId || null);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, count: ids.length, ids }));
}

function buildReport(tables) {
  const report = {};

  for (const table of TABLE_ORDER) {
    const rows = tables[table] || [];
    const duplicates = findDuplicates(rows, KEY_BUILDERS[table]);
    report[table] = {
      total: rows.length,
      duplicateGroups: duplicates.length,
      duplicates,
    };
  }

  return report;
}

function printPretty(report) {
  let hasDuplicates = false;

  for (const table of TABLE_ORDER) {
    const entry = report[table];
    const line = `${table}: total=${entry.total}, duplicateGroups=${entry.duplicateGroups}`;
    console.log(line);

    if (entry.duplicateGroups > 0) {
      hasDuplicates = true;
      for (const duplicate of entry.duplicates) {
        console.log(`  key=${duplicate.key}`);
        console.log(`  count=${duplicate.count}`);
        console.log(`  ids=${duplicate.ids.join(', ')}`);
      }
    }
  }

  if (!hasDuplicates) {
    console.log('No duplicate groups found.');
  }
}

function hasAnyDuplicates(report) {
  return Object.values(report).some((entry) => entry.duplicateGroups > 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tables = fetchTables();
  const report = buildReport(tables);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPretty(report);
  }

  if (args.failOnDuplicates && hasAnyDuplicates(report)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
