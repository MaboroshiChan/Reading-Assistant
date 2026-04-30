"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushWorkflowLogs = exports.workflowLog = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_LOG_PATH = node_path_1.default.join(__dirname, '..', '..', 'log', 'workflows.log');
const TERMINAL_PRIMARY_KEYS = [
    'workflowKind',
    'workflowRunId',
    'bookId',
    'chapterId',
    'chapterIndex',
    'workflowVersion',
    'status',
    'reason',
    'errorCode',
    'errorMessage',
    'deduped',
    'resultAvailable',
    'snapshotVersion',
    'completedAt',
    'startedAt',
];
let writeChain = Promise.resolve();
const resolveLogPath = () => {
    const configured = process.env.WORKFLOW_LOG_FILE?.trim();
    return configured ? node_path_1.default.resolve(configured) : DEFAULT_LOG_PATH;
};
const stringifyValue = (value) => {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number'
        || typeof value === 'boolean'
        || value === null
        || value === undefined) {
        return String(value);
    }
    return JSON.stringify(value);
};
const formatTerminalLine = (payload) => {
    const prefix = `[${payload.timestamp}][workflow][${payload.event}]`;
    const parts = [];
    const consumed = new Set(['timestamp', 'scope', 'event']);
    for (const key of TERMINAL_PRIMARY_KEYS) {
        const value = payload[key];
        if (value === undefined)
            continue;
        parts.push(`${key}=${stringifyValue(value)}`);
        consumed.add(key);
    }
    for (const [key, value] of Object.entries(payload)) {
        if (consumed.has(key) || value === undefined)
            continue;
        parts.push(`${key}=${stringifyValue(value)}`);
    }
    return parts.length > 0 ? `${prefix} ${parts.join(' ')}` : prefix;
};
const workflowLog = (event, meta = {}) => {
    const payload = {
        timestamp: new Date().toISOString(),
        scope: 'workflow',
        event,
        ...meta,
    };
    const line = `${JSON.stringify(payload)}\n`;
    console.info(formatTerminalLine(payload));
    writeChain = writeChain
        .then(async () => {
        const logPath = resolveLogPath();
        await promises_1.default.mkdir(node_path_1.default.dirname(logPath), { recursive: true });
        await promises_1.default.appendFile(logPath, line, 'utf8');
    })
        .catch((error) => {
        console.warn('[workflow-log] failed to persist log entry', error);
    });
};
exports.workflowLog = workflowLog;
const flushWorkflowLogs = async () => {
    await writeChain;
};
exports.flushWorkflowLogs = flushWorkflowLogs;
//# sourceMappingURL=workflow.logger.js.map