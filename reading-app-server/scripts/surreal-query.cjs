#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { spawnSync } = require('node:child_process');

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

function parseArgs(argv) {
  const parsed = {
    sql: '',
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--json':
        parsed.json = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        parsed.sql = argv.slice(index).join(' ').trim();
        index = argv.length;
        break;
    }
  }

  return parsed;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node reading-app-server/scripts/surreal-query.cjs "SELECT * FROM book;"',
    '  echo "SELECT count() FROM book GROUP ALL;" | node reading-app-server/scripts/surreal-query.cjs',
    '',
    'Options:',
    '  --json     Print raw JSON payload',
    '  --help     Show this help message',
  ].join('\n'));
}

function getStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
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

function runQuery(config, sql) {
  const endpoint = `${config.url.replace(/\/+$/, '')}/sql`;
  const result = spawnSync(
    'curl',
    [
      '-sS',
      '-X',
      'POST',
      endpoint,
      '-u',
      `${config.user}:${config.pass}`,
      '-H',
      'Accept: application/json',
      '-H',
      `Surreal-NS: ${config.namespace}`,
      '-H',
      `Surreal-DB: ${config.database}`,
      '-H',
      'Content-Type: text/plain',
      '--data',
      sql,
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'curl failed');
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse SurrealDB response JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(payload)) {
    const details = payload && typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
    throw new Error(`Unexpected SurrealDB response: ${details}`);
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

function printPretty(payload) {
  for (let index = 0; index < payload.length; index += 1) {
    const statement = payload[index];
    console.log(`Statement ${index + 1}: ${statement.status}`);
    console.log(JSON.stringify(statement.result, null, 2));
  }
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const stdinSql = (await getStdin()).trim();
  const sql = (args.sql || stdinSql).trim();
  if (!sql) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const config = requireConfig();
  const payload = runQuery(config, sql);
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  printPretty(payload);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
