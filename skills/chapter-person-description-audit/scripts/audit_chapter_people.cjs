#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function applyEnvFile(envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadEnvFiles() {
  const envPaths = [
    path.resolve(process.cwd(), 'reading-app-server/.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      applyEnvFile(envPath);
    }
  }
}

function parseArgs(argv) {
  const parsed = {
    bookId: '',
    chapterId: '',
    chapterIndex: '',
    json: false,
    url: '',
    namespace: '',
    database: '',
    user: '',
    pass: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--book-id':
        parsed.bookId = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--chapter-id':
        parsed.chapterId = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--chapter-index':
        parsed.chapterIndex = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--url':
        parsed.url = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--ns':
        parsed.namespace = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--db':
        parsed.database = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--user':
        parsed.user = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--pass':
        parsed.pass = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--json':
        parsed.json = true;
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

  if (!parsed.bookId) throw new Error('Missing required --book-id');
  if (!parsed.chapterId && !parsed.chapterIndex) {
    throw new Error('Provide --chapter-id or --chapter-index');
  }

  return parsed;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node skills/chapter-person-description-audit/scripts/audit_chapter_people.cjs \\',
    '    --book-id <BOOK_ID> --chapter-id <CHAPTER_ID> [--json]',
    '',
    'This script audits existing SurrealDB rows only. It does not rerun knowledge extraction or invoke the LLM.',
    '',
    'Optional connection overrides:',
    '  --url <SURREAL_URL> --ns <SURREAL_NS> --db <SURREAL_DB> --user <SURREAL_USER> --pass <SURREAL_PASS>',
    '',
    'Example:',
    '  node skills/chapter-person-description-audit/scripts/audit_chapter_people.cjs \\',
    '    --book-id 3D744C27-6D8C-4D4E-9367-BF5EE5DEF441 --chapter-id 4 --json',
  ].join('\n'));
}

function resolveConfig(args) {
  const config = {
    url: args.url || process.env.SURREAL_URL || '',
    namespace: args.namespace || process.env.SURREAL_NS || '',
    database: args.database || process.env.SURREAL_DB || '',
    user: args.user || process.env.SURREAL_USER || '',
    pass: args.pass || process.env.SURREAL_PASS || '',
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

function sqlString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

async function runQuery(config, sql) {
  const endpoint = `${config.url.replace(/\/+$/, '')}/sql`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'text/plain',
      'Surreal-NS': config.namespace,
      'Surreal-DB': config.database,
      Authorization: `Basic ${Buffer.from(`${config.user}:${config.pass}`).toString('base64')}`,
    },
    body: sql,
  });

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected SurrealDB payload: ${JSON.stringify(payload)}`);
  }

  for (const statement of payload) {
    if (statement.status !== 'OK') {
      throw new Error(typeof statement.detail === 'string' ? statement.detail : JSON.stringify(statement.result));
    }
  }

  return payload;
}

function normalizeText(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function formatRoleBackfillDescription(name, roles) {
  const uniqueRoles = sortStrings(uniqueStrings(roles));
  if (uniqueRoles.length === 0) return undefined;
  return `${name} is mentioned as ${uniqueRoles.join(', ')} in this chapter.`;
}

function pickPreferredRelationDescription(name, descriptions) {
  const unique = Array.from(new Set(descriptions.map(normalizeText).filter(Boolean)));
  if (unique.length === 0) return undefined;

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fullNamePattern = new RegExp(`\\b${escapedName}\\b`, 'i');
  const surname = name.trim().split(/\s+/).filter(Boolean).at(-1);
  const surnamePattern = surname
    ? new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    : null;

  const score = (description) => {
    if (fullNamePattern.test(description)) return 3;
    if (surnamePattern && surnamePattern.test(description)) return 2;
    return 1;
  };

  return [...unique].sort((left, right) => {
    const scoreDiff = score(right) - score(left);
    if (scoreDiff !== 0) return scoreDiff;
    return right.length - left.length;
  })[0];
}

function computeEffectiveDescription(name, chapterDescription, globalDescription, relationDescriptions, roles) {
  const chapter = normalizeText(chapterDescription);
  if (chapter) return { source: 'chapter', description: chapter };

  const global = normalizeText(globalDescription);
  if (global) return { source: 'global', description: global };

  const relation = pickPreferredRelationDescription(name, relationDescriptions);
  if (relation) return { source: 'relation', description: relation };

  const role = formatRoleBackfillDescription(name, roles);
  if (role) return { source: 'role', description: role };

  return { source: 'default', description: `${name} is mentioned in this chapter.` };
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConfig(args);

  const chapterWhere = args.chapterId
    ? `bookId = ${sqlString(args.bookId)} AND chapterId = ${sqlString(args.chapterId)}`
    : `bookId = ${sqlString(args.bookId)} AND chapterIndex = ${Number(args.chapterIndex)}`;

  const chapterPayload = await runQuery(
    config,
    [
      `SELECT recordId, bookId, chapterId, title, chapterIndex FROM chapter WHERE ${chapterWhere} LIMIT 1;`,
      `SELECT bookId, bookMetadata FROM book WHERE bookId = ${sqlString(args.bookId)} LIMIT 1;`,
    ].join('\n'),
  );

  const chapter = chapterPayload[0]?.result?.[0];
  if (!chapter) {
    throw new Error(`Chapter not found for ${chapterWhere}`);
  }
  const book = chapterPayload[1]?.result?.[0] ?? null;

  const appearancePayload = await runQuery(
    config,
    `SELECT recordId, nodeRecordId, localId, name, importance, description, roles, traits FROM appears_in WHERE chapterRecordId = ${sqlString(chapter.recordId)} AND nodeType = 'person' ORDER BY name;`,
  );
  const appearances = appearancePayload[0]?.result ?? [];

  const nodeRecordIds = appearances.map((appearance) => appearance.nodeRecordId).filter(Boolean);
  const nodeRecordIdSql = nodeRecordIds.length
    ? `[${nodeRecordIds.map((id) => sqlString(id)).join(', ')}]`
    : '[]';

  const extraPayload = nodeRecordIds.length
    ? await runQuery(
      config,
      [
        `SELECT recordId, name, description, roles, traits, importance FROM person WHERE recordId INSIDE ${nodeRecordIdSql};`,
        `SELECT fromRecordId, toRecordId, relationType, description FROM related_to WHERE chapterRecordId = ${sqlString(chapter.recordId)} AND (fromRecordId INSIDE ${nodeRecordIdSql} OR toRecordId INSIDE ${nodeRecordIdSql});`,
      ].join('\n'),
    )
    : [{ result: [] }, { result: [] }];

  const peopleByRecordId = new Map((extraPayload[0]?.result ?? []).map((person) => [person.recordId, person]));
  const relations = extraPayload[1]?.result ?? [];

  const rows = appearances.map((appearance) => {
    const person = peopleByRecordId.get(appearance.nodeRecordId);
    const relationDescriptions = relations
      .filter((relation) => relation.fromRecordId === appearance.nodeRecordId || relation.toRecordId === appearance.nodeRecordId)
      .map((relation) => relation.description);
    const roles = [
      ...(appearance.roles ?? []),
      ...(person?.roles ?? []),
    ];
    const effective = computeEffectiveDescription(
      appearance.name,
      appearance.description,
      person?.description,
      relationDescriptions,
      roles,
    );

    return {
      localId: appearance.localId,
      name: appearance.name,
      nodeRecordId: appearance.nodeRecordId,
      importance: appearance.importance ?? person?.importance ?? null,
      chapterDescription: normalizeText(appearance.description) ?? null,
      globalDescription: normalizeText(person?.description) ?? null,
      relationDescription: pickPreferredRelationDescription(appearance.name, relationDescriptions) ?? null,
      roles: sortStrings(uniqueStrings(roles)),
      effectiveDescriptionSource: effective.source,
      effectiveDescription: effective.description,
    };
  });

  const summary = {
    bookId: args.bookId,
    bookTitle: book?.bookMetadata?.title ?? null,
    chapterId: chapter.chapterId,
    chapterIndex: chapter.chapterIndex,
    chapterTitle: chapter.title ?? null,
    chapterRecordId: chapter.recordId,
    totalPeople: rows.length,
    rawChapterDescriptionsPresent: rows.filter((row) => row.chapterDescription).length,
    rawChapterDescriptionsMissing: rows.filter((row) => !row.chapterDescription).length,
    effectiveBySource: {
      chapter: rows.filter((row) => row.effectiveDescriptionSource === 'chapter').length,
      global: rows.filter((row) => row.effectiveDescriptionSource === 'global').length,
      relation: rows.filter((row) => row.effectiveDescriptionSource === 'relation').length,
      role: rows.filter((row) => row.effectiveDescriptionSource === 'role').length,
      default: rows.filter((row) => row.effectiveDescriptionSource === 'default').length,
    },
  };

  const result = { summary, people: rows };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Book: ${summary.bookTitle ?? summary.bookId}`);
  console.log(`Chapter: ${summary.chapterIndex} - ${summary.chapterTitle ?? summary.chapterId}`);
  console.log(`People: ${summary.totalPeople}`);
  console.log(`Raw chapter descriptions present: ${summary.rawChapterDescriptionsPresent}`);
  console.log(`Raw chapter descriptions missing: ${summary.rawChapterDescriptionsMissing}`);
  console.log(
    `Effective descriptions by source: chapter=${summary.effectiveBySource.chapter}, global=${summary.effectiveBySource.global}, relation=${summary.effectiveBySource.relation}, role=${summary.effectiveBySource.role}, default=${summary.effectiveBySource.default}`,
  );
  console.log('');

  for (const row of rows) {
    console.log(`- ${row.name}`);
    console.log(`  raw chapter: ${row.chapterDescription ?? '[missing]'}`);
    console.log(`  global: ${row.globalDescription ?? '[missing]'}`);
    console.log(`  relation: ${row.relationDescription ?? '[missing]'}`);
    console.log(`  effective (${row.effectiveDescriptionSource}): ${row.effectiveDescription}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
