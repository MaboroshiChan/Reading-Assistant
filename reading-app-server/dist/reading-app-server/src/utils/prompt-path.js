"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePromptPath = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const unique = (values) => Array.from(new Set(values));
const resolvePromptPath = (fileName) => {
    const envPromptDir = process.env.PROMPTS_DIR?.trim();
    const candidates = unique([
        envPromptDir ? node_path_1.default.resolve(envPromptDir, fileName) : '',
        node_path_1.default.resolve(process.cwd(), 'reading-app-server', 'prompts', 'v1', fileName),
        node_path_1.default.resolve(process.cwd(), 'prompts', 'v1', fileName),
        node_path_1.default.resolve(__dirname, '..', '..', 'prompts', 'v1', fileName),
        node_path_1.default.resolve(__dirname, '..', '..', '..', '..', 'prompts', 'v1', fileName),
        node_path_1.default.resolve(__dirname, '..', '..', '..', '..', '..', 'reading-app-server', 'prompts', 'v1', fileName),
    ]).filter((candidate) => candidate.length > 0);
    for (const candidate of candidates) {
        if ((0, node_fs_1.existsSync)(candidate)) {
            return candidate;
        }
    }
    return candidates[0] ?? node_path_1.default.resolve(process.cwd(), 'reading-app-server', 'prompts', 'v1', fileName);
};
exports.resolvePromptPath = resolvePromptPath;
//# sourceMappingURL=prompt-path.js.map