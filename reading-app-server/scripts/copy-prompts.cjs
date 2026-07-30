const fs = require('node:fs');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(serverRoot, 'prompts');
const targetDir = path.join(serverRoot, 'dist', 'reading-app-server', 'prompts');

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Prompt source directory not found: ${sourceDir}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });
