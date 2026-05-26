#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/genai');

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
    '  node scripts/clear-gemini-caches.cjs',
    '  node scripts/clear-gemini-caches.cjs --dry-run',
    '',
    'Options:',
    '  --dry-run    List how many Gemini cachedContents exist without deleting them',
    '  --help       Show this help message',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function listCachedContentNames(ai) {
  const names = [];
  for await (const item of await ai.caches.list({ config: { pageSize: 100 } })) {
    if (item && typeof item.name === 'string' && item.name.trim()) {
      names.push(item.name);
    }
  }
  return names;
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const ai = new GoogleGenAI({ apiKey });
  const names = await listCachedContentNames(ai);

  console.log(`Found ${names.length} Gemini cachedContents.`);
  if (names.length === 0) {
    return;
  }

  if (args.dryRun) {
    for (const name of names) {
      console.log(name);
    }
    return;
  }

  let deleted = 0;
  for (const name of names) {
    await ai.caches.delete({ name });
    deleted += 1;
    console.log(`Deleted ${deleted}/${names.length}: ${name}`);
  }

  console.log(`Deleted ${deleted} Gemini cachedContents.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
