"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushWorkflowLogs = exports.workflowLog = void 0;
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
};
exports.workflowLog = workflowLog;
const flushWorkflowLogs = async () => { };
exports.flushWorkflowLogs = flushWorkflowLogs;
//# sourceMappingURL=workflow.logger.js.map