"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushBookIngestionLogs = exports.bookIngestionLog = void 0;
const shouldMirrorToStdout = () => {
    const configured = process.env.BOOK_INGESTION_LOG_STDOUT?.trim().toLowerCase();
    if (configured === '1' || configured === 'true')
        return true;
    if (configured === '0' || configured === 'false')
        return false;
    return process.env.NODE_ENV === 'production';
};
const bookIngestionLog = (event, meta = {}) => {
    const payload = {
        timestamp: new Date().toISOString(),
        scope: 'book-ingestion',
        event,
        ...meta,
    };
    const line = `${JSON.stringify(payload)}\n`;
    if (shouldMirrorToStdout()) {
        process.stdout.write(line);
    }
};
exports.bookIngestionLog = bookIngestionLog;
const flushBookIngestionLogs = async () => { };
exports.flushBookIngestionLogs = flushBookIngestionLogs;
//# sourceMappingURL=book-ingestion.logger.js.map