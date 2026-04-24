"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlerLog = void 0;
/**
 * Formats and outputs a log entry in JSON format to the console.
 *
 * @param scope - The area or feature responsible for the log.
 * @param message - The main log message.
 * @param meta - Additional metadata to include in the log entry.
 * @param level - The severity level of the log.
 */
const handlerLog = (scope, message, meta = {}, level = 'info') => {
    const payload = {
        level,
        scope,
        message,
        ...meta,
        timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload));
};
exports.handlerLog = handlerLog;
//# sourceMappingURL=logger.js.map