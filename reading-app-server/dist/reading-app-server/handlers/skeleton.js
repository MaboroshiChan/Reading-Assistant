"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSkeleton = void 0;
const config_1 = require("../services/config");
const cache = __importStar(require("../services/cache"));
const shared_1 = require("./shared");
const skeleton_data_1 = require("./skeleton-data");
const logger_1 = require("./logger");
const CACHE_PREFIX = 'skeleton';
/**
 * Builds a cache key for skeleton analysis requests.
 *
 * @param req - The request envelope.
 * @returns A stable cache key string.
 */
const buildCacheKey = (req) => {
    const payloadKey = (0, shared_1.hashString)(JSON.stringify(req.payload));
    const contextKey = (0, shared_1.hashString)(JSON.stringify(req.context ?? {}));
    return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};
/**
 * Orchestrates skeleton data collection. Skeleton analysis currently uses
 * the deterministic builder until a live LLM-backed implementation lands.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the call results.
 */
const prepareSkeletonData = async (req) => {
    (0, logger_1.handlerLog)('skeleton', 'building generated payload', {
        requestId: req.request_id,
        docId: req.payload.doc_id,
    });
    const data = (0, skeleton_data_1.buildSkeletonData)(req);
    const text = JSON.stringify(data);
    return {
        data: (async function* () { yield text; })(),
        usage: Promise.resolve({
            modelId: config_1.config.model,
            inputTokens: 0,
            outputTokens: 0,
        }),
    };
};
/**
 * The main handler for skeleton analysis requests.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the streaming response.
 */
const handleSkeleton = async (req, _signal) => {
    (0, logger_1.handlerLog)('skeleton', 'request received', {
        requestId: req.request_id,
    });
    const cacheKey = buildCacheKey(req);
    const cached = cache.get(cacheKey);
    if (cached) {
        (0, logger_1.handlerLog)('skeleton', 'cache hit', { requestId: req.request_id });
        const text = JSON.stringify({ ...cached, served_from: 'cache' });
        const usage = await Promise.resolve(cached.usage);
        return {
            data: (async function* () { yield text; })(),
            usage: Promise.resolve({
                modelId: usage?.model_id,
                inputTokens: usage?.tokens_in,
                outputTokens: usage?.tokens_out,
            }),
        };
    }
    const started = Date.now();
    const { data: stream, usage: usagePromise } = await prepareSkeletonData(req);
    const tappedStream = (0, shared_1.withBufferedStream)(stream, async ({ text, completed }) => {
        if (!completed)
            return;
        try {
            const usage = await usagePromise;
            const data = JSON.parse(text);
            (0, logger_1.handlerLog)('skeleton', 'data prepared', {
                requestId: req.request_id,
                source: 'generated',
            });
            const response = {
                request_id: req.request_id,
                status: 'ok',
                served_from: 'fresh',
                data,
                usage: {
                    latency_ms: Date.now() - started,
                    model_id: usage?.modelId,
                    tokens_in: usage?.inputTokens,
                    tokens_out: usage?.outputTokens,
                },
            };
            cache.set(cacheKey, response, config_1.config.cacheTtlMs);
            (0, logger_1.handlerLog)('skeleton', 'response cached', {
                requestId: req.request_id,
                latencyMs: Date.now() - started,
            });
        }
        catch (error) {
            console.warn('[skeleton] failed to cache response', error);
        }
    });
    return { data: tappedStream, usage: usagePromise };
};
exports.handleSkeleton = handleSkeleton;
//# sourceMappingURL=skeleton.js.map