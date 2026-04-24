"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushBookIngestionLogs = exports.bookIngestionLog = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_LOG_PATH = node_path_1.default.join(__dirname, '..', '..', '..', 'log', 'book-ingestion.log');
let writeChain = Promise.resolve();
const resolveLogPath = () => {
    const configured = process.env.BOOK_INGESTION_LOG_FILE?.trim();
    return configured ? node_path_1.default.resolve(configured) : DEFAULT_LOG_PATH;
};
const bookIngestionLog = (event, meta = {}) => {
    const payload = {
        timestamp: new Date().toISOString(),
        scope: 'book-ingestion',
        event,
        ...meta,
    };
    const line = `${JSON.stringify(payload)}\n`;
    writeChain = writeChain
        .then(async () => {
        const logPath = resolveLogPath();
        await promises_1.default.mkdir(node_path_1.default.dirname(logPath), { recursive: true });
        await promises_1.default.appendFile(logPath, line, 'utf8');
    })
        .catch((error) => {
        console.warn('[book-ingestion-log] failed to persist log entry', error);
    });
};
exports.bookIngestionLog = bookIngestionLog;
const flushBookIngestionLogs = async () => {
    await writeChain;
};
exports.flushBookIngestionLogs = flushBookIngestionLogs;
//# sourceMappingURL=book-ingestion.logger.js.map