"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.appConfig = exports.createAppConfig = void 0;
exports.getOpenAIApiKey = getOpenAIApiKey;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
const config_1 = require("@nestjs/config");
const loadEnvFiles = () => {
    const envPaths = [
        process.env.NODE_ENV === 'test'
            ? node_path_1.default.resolve(process.cwd(), 'reading-app-server/.env.test')
            : null,
        node_path_1.default.resolve(process.cwd(), 'reading-app-server/.env'),
        node_path_1.default.resolve(process.cwd(), '.env'),
    ].filter((candidate) => Boolean(candidate));
    for (const envPath of envPaths) {
        if ((0, node_fs_1.existsSync)(envPath)) {
            dotenv_1.default.config({ path: envPath });
        }
    }
};
loadEnvFiles();
const createAppConfig = () => ({
    port: Number(process.env.PORT ?? 8787),
    model: process.env.MODEL_ID ?? 'gemini-2.5-flash',
    timeoutMs: 50_000,
    cacheMax: 500,
    cacheTtlMs: 7 * 24 * 3600_000,
    debugMode: process.env.LLM_DEBUG === '1' || process.env.DEBUG_LLM === '1',
    thinking: false,
    temperature: 0.1,
    autoSubmitKnowledgeExtractionWorkflow: process.env.AUTO_SUBMIT_KNOWLEDGE_EXTRACTION_WORKFLOW === '1',
    requireKnowledgeExtractionCache: process.env.KNOWLEDGE_EXTRACTION_REQUIRE_CACHE === '1',
    surrealUrl: process.env.SURREAL_URL ?? '',
    surrealNamespace: process.env.SURREAL_NS ?? '',
    surrealDatabase: process.env.SURREAL_DB ?? '',
    surrealUser: process.env.SURREAL_USER ?? '',
    surrealPass: process.env.SURREAL_PASS ?? '',
});
exports.createAppConfig = createAppConfig;
exports.appConfig = (0, config_1.registerAs)('app', exports.createAppConfig);
// Keep a stable object interface for existing handlers while still reading current env state.
exports.config = new Proxy({}, {
    get(_target, property) {
        const current = (0, exports.createAppConfig)();
        return current[property];
    },
});
function getOpenAIApiKey() {
    return process.env.GEMINI_API_KEY ?? '';
}
//# sourceMappingURL=runtime-config.js.map