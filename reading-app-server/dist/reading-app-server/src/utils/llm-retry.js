"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyLLMError = classifyLLMError;
exports.retryDelayMsForLLMError = retryDelayMsForLLMError;
exports.retryLLMOperation = retryLLMOperation;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
function classifyLLMError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const statusCode = extractStatusCode(message);
    const retryAfterMs = extractRetryDelayMs(message);
    const provider = detectProvider(normalized);
    if (statusCode !== undefined
        && RETRYABLE_STATUS_CODES.has(statusCode)) {
        return {
            retryable: true,
            provider,
            reason: statusCode === 429 ? 'rate_limit' : statusCode >= 500 ? 'server_error' : 'unknown',
            statusCode,
            retryAfterMs,
            message,
        };
    }
    if (normalized.includes('high demand')
        || normalized.includes('rate limit')
        || normalized.includes('too many requests')
        || normalized.includes('resource_exhausted')
        || normalized.includes('quota exceeded')) {
        return {
            retryable: true,
            provider,
            reason: 'rate_limit',
            statusCode,
            retryAfterMs,
            message,
        };
    }
    if (normalized.includes('service unavailable')
        || normalized.includes('temporarily unavailable')
        || normalized.includes('status":"unavailable"')
        || normalized.includes("status: 'unavailable'")
        || normalized.includes('backend error')) {
        return {
            retryable: true,
            provider,
            reason: 'service_unavailable',
            statusCode,
            retryAfterMs,
            message,
        };
    }
    if (normalized.includes('timed out')
        || normalized.includes('timeout')
        || normalized.includes('deadline exceeded')
        || normalized.includes('econnreset')
        || normalized.includes('etimedout')
        || normalized.includes('socket hang up')
        || normalized.includes('fetch failed')
        || normalized.includes('network error')
        || normalized.includes('connection reset')) {
        return {
            retryable: true,
            provider,
            reason: normalized.includes('timeout') ? 'timeout' : 'network',
            statusCode,
            retryAfterMs,
            message,
        };
    }
    return {
        retryable: false,
        provider,
        reason: 'unknown',
        statusCode,
        retryAfterMs,
        message,
    };
}
function retryDelayMsForLLMError(classification, attempt, defaultDelayMs, maxDelayMs) {
    if (classification.retryAfterMs !== undefined) {
        return Math.min(maxDelayMs, classification.retryAfterMs);
    }
    const backoffMs = defaultDelayMs * (attempt + 1);
    return Math.min(maxDelayMs, backoffMs);
}
async function retryLLMOperation(options) {
    let attempt = 0;
    const sleep = options.sleep ?? defaultSleep;
    while (true) {
        try {
            return await options.operation();
        }
        catch (error) {
            const classification = classifyLLMError(error);
            if (!classification.retryable || attempt >= options.maxRetries) {
                throw error;
            }
            const delayMs = retryDelayMsForLLMError(classification, attempt, options.defaultDelayMs, options.maxDelayMs);
            attempt += 1;
            await options.onRetry?.({
                attempt,
                delayMs,
                error,
                classification,
            });
            await sleep(delayMs);
        }
    }
}
function detectProvider(message) {
    if (message.includes('google') || message.includes('gemini') || message.includes('generativelanguage.googleapis.com')) {
        return 'google';
    }
    if (message.includes('openai'))
        return 'openai';
    if (message.includes('anthropic') || message.includes('claude'))
        return 'anthropic';
    return 'unknown';
}
function extractStatusCode(message) {
    const matchers = [
        /\[(\d{3})\s+[^\]]+\]/,
        /"code"\s*:\s*(\d{3})/i,
        /\bstatus code\b[:=]?\s*(\d{3})/i,
        /\bhttp\s*(\d{3})\b/i,
        /\b(\d{3})\b/,
    ];
    for (const matcher of matchers) {
        const match = message.match(matcher);
        if (!match)
            continue;
        const code = Number(match[1]);
        if (Number.isFinite(code) && code >= 400 && code <= 599) {
            return code;
        }
    }
    return undefined;
}
function extractRetryDelayMs(message) {
    const secondPatterns = [
        /retry in\s+(\d+(?:\.\d+)?)s/i,
        /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i,
        /retry-after["'\s:=]+(\d+(?:\.\d+)?)/i,
    ];
    for (const pattern of secondPatterns) {
        const match = message.match(pattern);
        if (!match)
            continue;
        const seconds = Number(match[1]);
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.ceil(seconds * 1000);
        }
    }
    const millisecondMatch = message.match(/retry(?:Delay|_after)?["'\s:=]+(\d+)ms/i);
    if (millisecondMatch) {
        const ms = Number(millisecondMatch[1]);
        if (Number.isFinite(ms) && ms > 0) {
            return Math.ceil(ms);
        }
    }
    return undefined;
}
async function defaultSleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=llm-retry.js.map