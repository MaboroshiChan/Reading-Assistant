"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAbortError = createAbortError;
exports.isAbortError = isAbortError;
exports.throwIfAborted = throwIfAborted;
function createAbortError(message = 'Operation aborted') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}
function isAbortError(error) {
    if (!error)
        return false;
    if (error instanceof DOMException) {
        return error.name === 'AbortError';
    }
    if (error instanceof Error) {
        if (error.name === 'AbortError')
            return true;
        return /\babort(ed|ing)?\b/i.test(error.message);
    }
    return false;
}
function throwIfAborted(signal) {
    if (!signal?.aborted)
        return;
    const reason = signal.reason;
    if (reason instanceof Error) {
        throw reason;
    }
    throw createAbortError(typeof reason === 'string' && reason.trim().length > 0
        ? reason
        : 'Operation aborted');
}
//# sourceMappingURL=abort.js.map