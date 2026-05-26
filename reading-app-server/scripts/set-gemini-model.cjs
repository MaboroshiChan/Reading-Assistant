#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  {
    label: '.env',
    file: path.join(ROOT, '.env'),
    update(content, modelId) {
      return replaceEnvModelId(content, modelId);
    },
  },
  {
    label: '.env.test',
    file: path.join(ROOT, '.env.test'),
    update(content, modelId) {
      return replaceEnvModelId(content, modelId);
    },
  },
  {
    label: 'runtime-config.ts',
    file: path.join(ROOT, 'src/config/runtime-config.ts'),
    update(content, modelId) {
      const pattern = /model:\s*process\.env\.MODEL_ID\s*\?\?\s*'[^']+'/;
      const replacement = `model: process.env.MODEL_ID ?? '${modelId}'`;
      return replaceRequired(content, pattern, replacement, 'runtime config default model');
    },
  },
  {
    label: 'test-models3.js',
    file: path.join(ROOT, 'test-models3.js'),
    update(content, modelId) {
      const pattern = /await testModel\('[^']+'\);/;
      const replacement = `await testModel('${modelId}');`;
      return replaceRequired(content, pattern, replacement, 'test-models3 primary model');
    },
  },
];

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/set-gemini-model.cjs <model-id>',
    '  npm run gemini:model:set -- <model-id>',
    '',
    'Examples:',
    '  npm run gemini:model:set -- gemini-flash-lite-latest',
    '  node scripts/set-gemini-model.cjs gemini-2.5-flash',
    '',
    'This updates:',
    '  - reading-app-server/.env',
    '  - reading-app-server/.env.test',
    '  - reading-app-server/src/config/runtime-config.ts',
    '  - reading-app-server/test-models3.js',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    modelId: '',
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!args.modelId) {
      args.modelId = arg.trim();
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return args;
}

function replaceEnvModelId(content, modelId) {
  const pattern = /^MODEL_ID=.*$/m;
  if (pattern.test(content)) {
    return content.replace(pattern, `MODEL_ID=${modelId}`);
  }
  const trimmed = content.replace(/\s*$/, '');
  return `${trimmed}\nMODEL_ID=${modelId}\n`;
}

function replaceRequired(content, pattern, replacement, description) {
  if (!pattern.test(content)) {
    throw new Error(`Could not find ${description} to update`);
  }
  return content.replace(pattern, replacement);
}

function updateFile(target, modelId) {
  const current = fs.readFileSync(target.file, 'utf8');
  const next = target.update(current, modelId);
  if (next === current) {
    return { changed: false, file: target.file, label: target.label };
  }
  fs.writeFileSync(target.file, next, 'utf8');
  return { changed: true, file: target.file, label: target.label };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.modelId) {
    printHelp();
    if (!args.help && !args.modelId) {
      process.exitCode = 1;
    }
    return;
  }

  const modelId = args.modelId;
  const results = TARGETS.map((target) => updateFile(target, modelId));

  console.log(`Set Gemini model to: ${modelId}`);
  for (const result of results) {
    console.log(`${result.changed ? 'updated' : 'unchanged'} ${result.label} -> ${path.relative(ROOT, result.file)}`);
  }
}

main();
