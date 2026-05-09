#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const NODE_TABLE_BY_TYPE = {
  person: 'person',
  idea: 'concept',
  theme: 'theme',
  entity: 'entity',
  event: 'event',
};

function loadEnvFiles() {
  const envPaths = [
    process.env.NODE_ENV === 'test'
      ? path.resolve(process.cwd(), 'reading-app-server/.env.test')
      : null,
    path.resolve(process.cwd(), 'reading-app-server/.env'),
    path.resolve(process.cwd(), '.env'),
  ].filter(Boolean);

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
}

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/delete-surreal-records.cjs --table <table> --id <record-id>',
    '  node scripts/delete-surreal-records.cjs --table <table> --where "<condition>"',
    '  node scripts/delete-surreal-records.cjs --table <table> --all',
    '  node scripts/delete-surreal-records.cjs --scope chapter --bookId <book-id> --chapterId <chapter-id>',
    '  node scripts/delete-surreal-records.cjs --scope book --bookId <book-id>',
    '',
    'Examples:',
    '  node scripts/delete-surreal-records.cjs --table workflow_run --id 123',
    '  node scripts/delete-surreal-records.cjs --table chapter --where "bookId = \'book-1\'"',
    '  node scripts/delete-surreal-records.cjs --scope chapter --bookId book-1 --chapterId chapter-3',
    '  node scripts/delete-surreal-records.cjs --scope book --bookId book-1 --dry-run',
    '',
    'Options:',
    '  --table <name>       SurrealDB table name to delete from',
    '  --id <record-id>     Delete a single record by id (without the table prefix)',
    '  --where <expr>       Delete records matching a SurrealQL WHERE expression',
    '  --all                Delete every record in the table',
    '  --scope <chapter|book>',
    '                       High-level cleanup for a chapter or whole book',
    '  --bookId <book-id>   Required for --scope chapter|book',
    '  --chapterId <id>     Required for --scope chapter',
    '  --dry-run            Print the generated SQL/plan without executing it',
    '  --help               Show this help message',
    '',
    'Scope behavior:',
    '  chapter: deletes chapter graph rows, workflow rows, chapter snapshots, page caches,',
    '           chapter-scoped relation edges, and graph nodes that become orphaned.',
    '  book:    deletes all chapter-scoped data for the book plus the book graph row, and',
    '           graph nodes that become orphaned after the book is removed.',
  ].join('\n'));
}

function parseArgs(argv) {
  const parsed = {
    table: undefined,
    id: undefined,
    where: undefined,
    all: false,
    scope: undefined,
    bookId: undefined,
    chapterId: undefined,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--table':
        parsed.table = argv[index + 1];
        index += 1;
        break;
      case '--id':
        parsed.id = argv[index + 1];
        index += 1;
        break;
      case '--where':
        parsed.where = argv[index + 1];
        index += 1;
        break;
      case '--all':
        parsed.all = true;
        break;
      case '--scope':
        parsed.scope = argv[index + 1];
        index += 1;
        break;
      case '--bookId':
        parsed.bookId = argv[index + 1];
        index += 1;
        break;
      case '--chapterId':
        parsed.chapterId = argv[index + 1];
        index += 1;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireConfig() {
  const config = {
    url: process.env.SURREAL_URL || '',
    namespace: process.env.SURREAL_NS || '',
    database: process.env.SURREAL_DB || '',
    user: process.env.SURREAL_USER || '',
    pass: process.env.SURREAL_PASS || '',
  };

  const missing = Object.entries({
    SURREAL_URL: config.url,
    SURREAL_NS: config.namespace,
    SURREAL_DB: config.database,
    SURREAL_USER: config.user,
    SURREAL_PASS: config.pass,
  })
    .filter(([, value]) => !String(value).trim())
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing SurrealDB configuration: ${missing.join(', ')}`);
  }

  return config;
}

function validateArgs(args) {
  if (args.help) return;

  if (args.scope) {
    if (args.scope !== 'chapter' && args.scope !== 'book') {
      throw new Error('--scope must be either "chapter" or "book"');
    }
    if (!args.bookId || !args.bookId.trim()) {
      throw new Error('--bookId is required when using --scope');
    }
    if (args.scope === 'chapter' && (!args.chapterId || !args.chapterId.trim())) {
      throw new Error('--chapterId is required when using --scope chapter');
    }
    if (args.table || args.id || args.where || args.all) {
      throw new Error('--scope cannot be combined with --table/--id/--where/--all');
    }
    return;
  }

  if (!args.table || !args.table.trim()) {
    throw new Error('--table is required');
  }

  const modeCount = [Boolean(args.id), Boolean(args.where), args.all].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error('Choose exactly one delete mode: --id, --where, or --all');
  }
}

function buildSql(args) {
  if (args.id) {
    return {
      previewSql: `DELETE ONLY ${args.table}:${args.id};`,
      executeSql: `DELETE ONLY ${args.table}:${args.id};`,
      summary: `Delete one record from ${args.table}: ${args.id}`,
    };
  }

  if (args.where) {
    return {
      previewSql: `SELECT * FROM ${args.table} WHERE ${args.where};`,
      executeSql: `DELETE ${args.table} WHERE ${args.where};`,
      summary: `Delete records from ${args.table} where ${args.where}`,
    };
  }

  return {
    previewSql: `SELECT * FROM ${args.table};`,
    executeSql: `DELETE ${args.table};`,
    summary: `Delete all records from ${args.table}`,
  };
}

function escapeSqlString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function quoteSqlString(value) {
  return `'${escapeSqlString(value)}'`;
}

function buildEquals(field, value) {
  return `${field} = ${quoteSqlString(value)}`;
}

function buildAnyEquals(field, values) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (uniqueValues.length === 0) return '';
  return uniqueValues.map((value) => buildEquals(field, value)).join(' OR ');
}

function countPreviewRows(previewPayload) {
  const first = previewPayload[0]?.result;
  return Array.isArray(first) ? first.length : 0;
}

async function runQuery(config, sql) {
  const endpoint = config.url.replace(/\/+$/, '');
  const response = await fetch(`${endpoint}/sql`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.user}:${config.pass}`, 'utf8').toString('base64')}`,
      'Surreal-NS': config.namespace,
      'Surreal-DB': config.database,
      'Content-Type': 'text/plain',
    },
    body: sql,
  });

  const payload = await response.json().catch(async () => {
    const raw = await response.text().catch(() => '');
    throw new Error(`Failed to parse SurrealDB response JSON${raw ? `: ${raw}` : ''}`);
  });

  if (!response.ok) {
    throw new Error(`SurrealDB query failed with HTTP ${response.status}`);
  }

  for (const statement of payload) {
    if (statement.status !== 'OK') {
      const detail = typeof statement.detail === 'string' && statement.detail.trim()
        ? statement.detail
        : statement.result;
      throw new Error(String(detail || 'SurrealDB returned a non-OK statement status'));
    }
  }

  return payload;
}

async function selectRows(config, table, whereClause) {
  const sql = whereClause && whereClause.trim()
    ? `SELECT * FROM ${table} WHERE ${whereClause};`
    : `SELECT * FROM ${table};`;
  const payload = await runQuery(config, sql);
  const rows = payload[0]?.result;
  return Array.isArray(rows) ? rows : [];
}

function tableForNodeType(nodeType) {
  return NODE_TABLE_BY_TYPE[nodeType] || null;
}

function buildDeleteByRecordIds(table, field, ids) {
  const whereClause = buildAnyEquals(field, ids);
  if (!whereClause) return null;
  return `DELETE ${table} WHERE ${whereClause};`;
}

function buildScopeDryRunSummary(args) {
  if (args.scope === 'chapter') {
    return [
      `[surreal-delete] Dry run for chapter cleanup`,
      `[surreal-delete] Target bookId=${args.bookId} chapterId=${args.chapterId}`,
      '[surreal-delete] This will target:',
      '  - chapter',
      '  - workflow_run',
      '  - chapter_knowledge_snapshot',
      '  - page_knowledge_extraction_cache',
      '  - appears_in',
      '  - related_to',
      '  - part_of',
      '  - orphaned person/concept/theme/entity/event nodes',
      '  - orphaned book row when the deleted chapter is the last chapter in the book',
    ];
  }

  return [
    `[surreal-delete] Dry run for book cleanup`,
    `[surreal-delete] Target bookId=${args.bookId}`,
    '[surreal-delete] This will target:',
    '  - book',
    '  - all chapter rows for the book',
    '  - workflow_run',
    '  - chapter_knowledge_snapshot',
    '  - page_knowledge_extraction_cache',
    '  - appears_in',
    '  - related_to',
    '  - part_of',
    '  - orphaned person/concept/theme/entity/event nodes',
  ];
}

async function buildScopedDeletionPlan(config, args) {
  const chapterWhere = args.scope === 'chapter'
    ? `${buildEquals('bookId', args.bookId)} AND ${buildEquals('chapterId', args.chapterId)}`
    : buildEquals('bookId', args.bookId);

  const [chapters, allBookChapters, workflowRuns, snapshots, pageCaches, books] = await Promise.all([
    selectRows(config, 'chapter', chapterWhere),
    selectRows(config, 'chapter', buildEquals('bookId', args.bookId)),
    selectRows(config, 'workflow_run', chapterWhere),
    selectRows(config, 'chapter_knowledge_snapshot', chapterWhere),
    selectRows(config, 'page_knowledge_extraction_cache', chapterWhere),
    selectRows(config, 'book', buildEquals('bookId', args.bookId)),
  ]);

  const chapterRecordIds = chapters
    .map((chapter) => chapter.recordId)
    .filter((recordId) => typeof recordId === 'string' && recordId.trim().length > 0);
  const chapterRecordIdSet = new Set(chapterRecordIds);

  const appearanceWhere = buildAnyEquals('chapterRecordId', chapterRecordIds);
  const relationWhere = buildAnyEquals('chapterRecordId', chapterRecordIds);
  const partOfWhere = buildAnyEquals('chapterRecordId', chapterRecordIds);

  const [appearances, relations, partOfEdges] = await Promise.all([
    appearanceWhere ? selectRows(config, 'appears_in', appearanceWhere) : Promise.resolve([]),
    relationWhere ? selectRows(config, 'related_to', relationWhere) : Promise.resolve([]),
    partOfWhere ? selectRows(config, 'part_of', partOfWhere) : Promise.resolve([]),
  ]);

  const orphanNodeIdsByTable = {
    person: new Set(),
    concept: new Set(),
    theme: new Set(),
    entity: new Set(),
    event: new Set(),
  };

  const nodeChecks = new Map();
  for (const appearance of appearances) {
    const nodeRecordId = appearance.nodeRecordId;
    const nodeType = appearance.nodeType;
    const table = tableForNodeType(nodeType);
    if (!table || typeof nodeRecordId !== 'string' || !nodeRecordId.trim()) continue;
    nodeChecks.set(`${table}:${nodeRecordId}`, { table, nodeRecordId });
  }

  for (const { table, nodeRecordId } of nodeChecks.values()) {
    const nodeAppearances = await selectRows(
      config,
      'appears_in',
      buildEquals('nodeRecordId', nodeRecordId),
    );
    const hasRemainingAppearance = nodeAppearances.some(
      (appearance) => !chapterRecordIdSet.has(appearance.chapterRecordId),
    );
    if (!hasRemainingAppearance) {
      orphanNodeIdsByTable[table].add(nodeRecordId);
    }
  }

  const remainingBookChapters = allBookChapters.filter(
    (chapter) => !chapterRecordIdSet.has(chapter.recordId),
  );
  const shouldDeleteBookRows = args.scope === 'book' || remainingBookChapters.length === 0;
  const bookRecordIdsToDelete = shouldDeleteBookRows
    ? books
      .map((book) => book.recordId)
      .filter((recordId) => typeof recordId === 'string' && recordId.trim().length > 0)
    : [];

  const statements = [];

  const relationDelete = buildDeleteByRecordIds(
    'related_to',
    'recordId',
    relations.map((row) => row.recordId),
  );
  if (relationDelete) statements.push(relationDelete);

  const appearanceDelete = buildDeleteByRecordIds(
    'appears_in',
    'recordId',
    appearances.map((row) => row.recordId),
  );
  if (appearanceDelete) statements.push(appearanceDelete);

  const partOfDelete = buildDeleteByRecordIds(
    'part_of',
    'recordId',
    partOfEdges.map((row) => row.recordId),
  );
  if (partOfDelete) statements.push(partOfDelete);

  if (workflowRuns.length > 0) {
    statements.push(`DELETE workflow_run WHERE ${chapterWhere};`);
  }
  if (snapshots.length > 0) {
    statements.push(`DELETE chapter_knowledge_snapshot WHERE ${chapterWhere};`);
  }
  if (pageCaches.length > 0) {
    statements.push(`DELETE page_knowledge_extraction_cache WHERE ${chapterWhere};`);
  }

  const chapterDelete = buildDeleteByRecordIds(
    'chapter',
    'recordId',
    chapters.map((row) => row.recordId),
  );
  if (chapterDelete) statements.push(chapterDelete);

  const bookDelete = buildDeleteByRecordIds('book', 'recordId', bookRecordIdsToDelete);
  if (bookDelete) statements.push(bookDelete);

  for (const [table, ids] of Object.entries(orphanNodeIdsByTable)) {
    const deleteSql = buildDeleteByRecordIds(table, 'recordId', Array.from(ids));
    if (deleteSql) statements.push(deleteSql);
  }

  return {
    scope: args.scope,
    chapterWhere,
    counts: {
      books: bookRecordIdsToDelete.length,
      chapters: chapters.length,
      workflowRuns: workflowRuns.length,
      snapshots: snapshots.length,
      pageCaches: pageCaches.length,
      appearances: appearances.length,
      relations: relations.length,
      partOfEdges: partOfEdges.length,
      orphanPeople: orphanNodeIdsByTable.person.size,
      orphanConcepts: orphanNodeIdsByTable.concept.size,
      orphanThemes: orphanNodeIdsByTable.theme.size,
      orphanEntities: orphanNodeIdsByTable.entity.size,
      orphanEvents: orphanNodeIdsByTable.event.size,
    },
    statements,
  };
}

function printScopePlan(plan, args) {
  const label = args.scope === 'chapter'
    ? `chapter cleanup for bookId=${args.bookId} chapterId=${args.chapterId}`
    : `book cleanup for bookId=${args.bookId}`;

  console.log(`[surreal-delete] Planned ${label}`);
  console.log(`[surreal-delete] Matched rows:`);
  console.log(`  books: ${plan.counts.books}`);
  console.log(`  chapters: ${plan.counts.chapters}`);
  console.log(`  workflow_run: ${plan.counts.workflowRuns}`);
  console.log(`  chapter_knowledge_snapshot: ${plan.counts.snapshots}`);
  console.log(`  page_knowledge_extraction_cache: ${plan.counts.pageCaches}`);
  console.log(`  appears_in: ${plan.counts.appearances}`);
  console.log(`  related_to: ${plan.counts.relations}`);
  console.log(`  part_of: ${plan.counts.partOfEdges}`);
  console.log(`  orphan person: ${plan.counts.orphanPeople}`);
  console.log(`  orphan concept: ${plan.counts.orphanConcepts}`);
  console.log(`  orphan theme: ${plan.counts.orphanThemes}`);
  console.log(`  orphan entity: ${plan.counts.orphanEntities}`);
  console.log(`  orphan event: ${plan.counts.orphanEvents}`);
}

async function executeGenericDelete(args) {
  const config = requireConfig();
  const sql = buildSql(args);

  console.log(`[surreal-delete] ${sql.summary}`);
  console.log(`[surreal-delete] Preview SQL: ${sql.previewSql}`);

  if (args.dryRun) {
    console.log('[surreal-delete] Dry run only. No records were deleted.');
    return;
  }

  const previewPayload = await runQuery(config, sql.previewSql);
  const previewCount = countPreviewRows(previewPayload);
  console.log(`[surreal-delete] Matching records: ${previewCount}`);

  if (previewCount === 0 && !args.id) {
    console.log('[surreal-delete] Nothing matched. Skipping delete.');
    return;
  }

  console.log(`[surreal-delete] Execute SQL: ${sql.executeSql}`);
  await runQuery(config, sql.executeSql);
  console.log('[surreal-delete] Delete completed.');
}

async function executeScopedDelete(args) {
  if (args.dryRun) {
    for (const line of buildScopeDryRunSummary(args)) {
      console.log(line);
    }
    return;
  }

  const config = requireConfig();
  const plan = await buildScopedDeletionPlan(config, args);
  printScopePlan(plan, args);

  if (plan.statements.length === 0) {
    console.log('[surreal-delete] Nothing matched. Skipping delete.');
    return;
  }

  for (const statement of plan.statements) {
    console.log(`[surreal-delete] Execute SQL: ${statement}`);
    await runQuery(config, statement);
  }

  console.log('[surreal-delete] Scoped delete completed.');
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  validateArgs(args);

  if (args.scope) {
    await executeScopedDelete(args);
    return;
  }

  await executeGenericDelete(args);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[surreal-delete] ${message}`);
  process.exit(1);
});
