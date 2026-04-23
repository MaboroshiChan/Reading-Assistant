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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildParagraphTasks = exports.buildParagraphPrompt = exports.handleParagraph = exports.PARAGRAPH_PROMPT_VERSION = void 0;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const config_1 = require("../services/config");
const cache = __importStar(require("../services/cache"));
const llmService_1 = require("../services/llmService");
const shared_1 = require("./shared");
const logger_1 = require("./logger");
const CACHE_PREFIX = 'paragraph';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'paragraph.v1.1';
exports.PARAGRAPH_PROMPT_VERSION = PROMPT_VERSION;
const PROMPT_PATH = node_path_1.default.join(__dirname, '..', 'prompts', 'v1', 'paragraph.txt');
const TASK_ORDER = ['summary', 'roles', 'rhetoric', 'claims', 'tags'];
/**
 * Builds a cache key for paragraph analysis requests.
 *
 * @param req - The request envelope.
 * @returns A stable cache key string.
 */
const buildCacheKey = (req) => {
    return (0, shared_1.buildStableCacheKey)(CACHE_PREFIX, CACHE_VERSION, {
        payload: req.payload,
        context: req.context ?? {},
        prompt_version: PROMPT_VERSION,
        model: config_1.config.model,
    });
};
let cachedParagraphSystemPrompt = null;
/**
 * Loads the paragraph analysis prompt from the filesystem, with caching.
 *
 * @returns The prompt text.
 */
const loadParagraphSystemPrompt = async () => {
    if (cachedParagraphSystemPrompt)
        return cachedParagraphSystemPrompt;
    cachedParagraphSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedParagraphSystemPrompt;
};
/**
 * Determines and orders the analysis tasks for a paragraph.
 *
 * @param req - The request envelope.
 * @returns An ordered array of tasks.
 */
const buildTasks = (req) => {
    const requested = req.payload.options?.tasks ?? TASK_ORDER;
    const normalized = new Set();
    for (const rawTask of requested) {
        if (!TASK_ORDER.includes(rawTask))
            continue;
        normalized.add(rawTask);
    }
    const ordered = TASK_ORDER.filter((task) => normalized.size === 0 || normalized.has(task));
    return ordered.length ? ordered : [...TASK_ORDER];
};
exports.buildParagraphTasks = buildTasks;
/**
 * Formats paragraph-level context (hierarchy, neighbors, entities) for the prompt.
 *
 * @param req - The request envelope.
 * @returns A formatted context string or null.
 */
const formatContext = (req) => {
    const ctx = req.context;
    if (!ctx)
        return null;
    const lines = [];
    if (ctx.hierarchy?.heading_chain?.length) {
        lines.push(`Heading chain: ${ctx.hierarchy.heading_chain.join(' > ')}`);
    }
    if (typeof ctx.hierarchy?.paragraph_index === 'number') {
        lines.push(`Paragraph index: ${ctx.hierarchy.paragraph_index}`);
    }
    if (ctx.neighbors?.paragraph?.prev_summary) {
        lines.push(`Prev paragraph summary: ${ctx.neighbors.paragraph.prev_summary}`);
    }
    if (ctx.neighbors?.paragraph?.next_summary) {
        lines.push(`Next paragraph summary: ${ctx.neighbors.paragraph.next_summary}`);
    }
    if (ctx.neighbors?.sentence?.prev_text) {
        lines.push(`Prev sentence: ${ctx.neighbors.sentence.prev_text}`);
    }
    if (ctx.neighbors?.sentence?.next_text) {
        lines.push(`Next sentence: ${ctx.neighbors.sentence.next_text}`);
    }
    if (ctx.global_entities?.entities?.length) {
        const entityLines = ctx.global_entities.entities
            .slice(0, 8)
            .map((entity) => `${entity.id} [${entity.type}]: ${entity.canonical}`);
        lines.push('Known entities:');
        lines.push(...entityLines);
    }
    if (!lines.length)
        return null;
    return lines.join('\n');
};
/**
 * Builds the full LLM prompt for paragraph analysis.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the prompt string.
 */
const buildPrompt = (req) => {
    const tasks = buildTasks(req);
    const sections = [
        `Document ID: ${req.payload.doc_id}`,
        `Paragraph ID: ${req.payload.paragraph_id}`,
        `Prompt Version: ${PROMPT_VERSION}`,
        `Requested tasks: ${tasks.join(', ')}`,
        '',
        'Paragraph text:',
        '```text',
        req.payload.paragraph_text,
        '```',
    ];
    const contextBlock = formatContext(req);
    if (contextBlock) {
        sections.push('', 'Additional context:', contextBlock);
    }
    sections.push('', 'Respond with JSON only. Do not wrap the JSON in markdown fences.');
    return sections.join('\n');
};
exports.buildParagraphPrompt = buildPrompt;
/**
 * Orchestrates paragraph data collection from the LLM.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the call results.
 */
const buildParagraphData = async (req) => {
    const tasks = buildTasks(req);
    (0, logger_1.handlerLog)('paragraph', 'building LLM prompt', {
        requestId: req.request_id,
        tasks,
        promptVersion: PROMPT_VERSION,
    });
    const [systemPrompt, userPrompt] = await Promise.all([
        loadParagraphSystemPrompt(),
        Promise.resolve(buildPrompt(req)),
    ]);
    const llmClient = (0, llmService_1.createLLMClient)({ systemPrompt });
    (0, logger_1.handlerLog)('paragraph', 'LLM prompt prepared', {
        requestId: req.request_id,
        paragraphId: req.payload.paragraph_id,
        promptVersion: PROMPT_VERSION,
        tasks,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        prompt: userPrompt,
    });
    return llmClient.json(userPrompt);
};
/**
 * The main handler for paragraph analysis requests.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the streaming response.
 */
const handleParagraph = async (req) => {
    (0, logger_1.handlerLog)('paragraph', 'request received', {
        requestId: req.request_id,
        paragraphId: req.payload.paragraph_id,
        promptVersion: PROMPT_VERSION,
    });
    const cacheKey = buildCacheKey(req);
    const cached = cache.get(cacheKey);
    if (cached) {
        (0, logger_1.handlerLog)('paragraph', 'cache hit', {
            requestId: req.request_id,
            cacheKey,
            promptVersion: PROMPT_VERSION,
        });
        const text = JSON.stringify({ ...cached, served_from: 'cache' });
        const usage = await Promise.resolve(cached.usage);
        return {
            data: (async function* () {
                yield text;
            })(),
            usage: Promise.resolve({
                modelId: usage?.model_id,
                inputTokens: usage?.tokens_in,
                outputTokens: usage?.tokens_out,
            }),
        };
    }
    const started = Date.now();
    const { data: stream, usage: usagePromise } = await buildParagraphData(req);
    const tappedStream = (async function* () {
        let text = '';
        for await (const chunk of stream) {
            text += chunk;
            yield chunk;
        }
        // Background processing
        try {
            const usage = await usagePromise;
            const object = coerceParagraphResponse((0, llmService_1.extractJsonFromText)(text));
            const data = mapParagraphResponse(object, req);
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
        }
        catch (error) {
            console.warn('[paragraph] failed to cache response', error);
        }
    })();
    return { data: tappedStream, usage: usagePromise };
};
exports.handleParagraph = handleParagraph;
/**
 * Coerces the raw LLM JSON response into a typed LLMParagraphResponse object.
 *
 * @param value - The raw JSON payload.
 * @returns A typed object with potential defaults.
 */
const coerceParagraphResponse = (value) => {
    if (!isRecord(value))
        return {};
    return {
        summary: asString(value.summary),
        roles: Array.isArray(value.roles)
            ? value.roles
                .map(coerceRole)
                .filter((role) => role !== null)
            : undefined,
        rhetoric: Array.isArray(value.rhetoric)
            ? value.rhetoric
                .map(coerceRhetoric)
                .filter((item) => item !== null)
            : undefined,
        claims: Array.isArray(value.claims)
            ? value.claims
                .map(coerceClaim)
                .filter((item) => item !== null)
            : undefined,
        anchors: Array.isArray(value.anchors)
            ? coerceAnchorArray(value.anchors)
            : undefined,
        tags: Array.isArray(value.tags)
            ? value.tags.reduce((acc, tag) => {
                if (!isRecord(tag))
                    return acc;
                const name = asString(tag.name);
                const type = asString(tag.type) === 'logic' ? 'logic' : 'concept';
                const description = asString(tag.description);
                if (name) {
                    acc.push({ name, type, description });
                }
                return acc;
            }, [])
            : undefined,
        confidence: asConfidence(value.confidence),
    };
};
/**
 * Maps the coerced LLM response into the final AnalyzeParagraphData structure.
 *
 * @param payload - The typed LLM response payload.
 * @param req - The original request envelope.
 * @returns The final sanitized analysis data.
 */
const mapParagraphResponse = (payload, req) => {
    const text = req.payload.paragraph_text;
    const paragraphId = req.payload.paragraph_id;
    const tasks = new Set(buildTasks(req));
    const shouldInclude = (task) => req.payload.options?.tasks ? tasks.has(task) : true;
    const anchorIndex = new Map();
    const baseAnchor = text.length > 0
        ? (0, shared_1.makeAnchor)({
            paragraphId,
            span: { start: 0, end: text.length },
            text,
        })
        : null;
    if (baseAnchor) {
        anchorIndex.set(baseAnchor.anchor_hash, baseAnchor);
    }
    const collectAnchors = (rawAnchors, fallbackToParagraph = false) => {
        const anchors = [];
        const seen = new Set();
        if (rawAnchors) {
            for (const raw of rawAnchors) {
                const anchor = anchorFromSpan(raw, text, paragraphId);
                if (anchor && !seen.has(anchor.anchor_hash)) {
                    anchors.push(anchor);
                    seen.add(anchor.anchor_hash);
                    anchorIndex.set(anchor.anchor_hash, anchor);
                }
            }
        }
        if (!anchors.length && fallbackToParagraph && baseAnchor) {
            anchors.push(baseAnchor);
        }
        return anchors;
    };
    const roles = shouldInclude('roles') && payload.roles
        ? (() => {
            const items = payload.roles
                .map((role) => {
                const anchors = collectAnchors(role.anchors);
                if (!role.role)
                    return null;
                return {
                    role: role.role,
                    anchors,
                    confidence: role.confidence,
                };
            })
                .filter((role) => role !== null)
                .map((role) => ({
                role: role.role,
                anchors: role.anchors,
                confidence: role.confidence,
            }));
            return items.length ? items : undefined;
        })()
        : undefined;
    const rhetoric = shouldInclude('rhetoric') && payload.rhetoric
        ? (() => {
            const items = payload.rhetoric
                .map((item) => {
                const label = item.label;
                if (!label)
                    return null;
                return {
                    label,
                    evidence_anchors: collectAnchors(item.evidence_anchors),
                    confidence: item.confidence,
                };
            })
                .filter((entry) => entry !== null)
                .map((entry) => ({
                label: entry.label,
                evidence_anchors: entry.evidence_anchors.length ? entry.evidence_anchors : undefined,
                confidence: entry.confidence,
            }));
            return items.length ? items : undefined;
        })()
        : undefined;
    const claims = shouldInclude('claims') && payload.claims
        ? (() => {
            const items = payload.claims
                .map((claim) => {
                const textValue = claim.text;
                if (!textValue)
                    return null;
                const anchors = collectAnchors(claim.anchors, true);
                const entityLinks = claim.entity_links?.filter((id) => typeof id === 'string' && id.trim());
                return {
                    text: textValue,
                    polarity: normalizePolarity(claim.polarity),
                    support: normalizeSupport(claim.support),
                    anchors,
                    entity_links: entityLinks && entityLinks.length ? entityLinks : undefined,
                };
            })
                .filter((entry) => entry !== null);
            return items.length ? items : undefined;
        })()
        : undefined;
    if (payload.anchors) {
        collectAnchors(payload.anchors);
    }
    const summary = shouldInclude('summary')
        ? payload.summary ?? (0, shared_1.summarize)(text)
        : undefined;
    const anchorList = anchorIndex.size ? (0, shared_1.sortAnchors)(Array.from(anchorIndex.values())) : undefined;
    return {
        summary,
        roles,
        rhetoric,
        claims,
        anchors: anchorList,
        tags: shouldInclude('tags') ? payload.tags : undefined,
        confidence: payload.confidence,
    };
};
/**
 * Helper to create an Anchor from a raw span and text context.
 *
 * @param anchor - The raw anchor data with start/end positions.
 * @param paragraphText - The full text of the paragraph for snippet extraction.
 * @param paragraphId - The ID of the paragraph.
 * @returns An Anchor object or null if the span is invalid.
 */
const anchorFromSpan = (anchor, paragraphText, paragraphId) => {
    const span = normalizeSpan(anchor.start, anchor.end, paragraphText.length);
    if (!span)
        return null;
    const snippet = paragraphText.slice(span.start, span.end);
    if (!snippet)
        return null;
    return (0, shared_1.makeAnchor)({
        paragraphId,
        sentenceId: anchor.sentence_id,
        span,
        text: snippet,
    });
};
/**
 * Validates and normalizes span indices within a maximum length.
 *
 * @param start - The raw start index.
 * @param end - The raw end index.
 * @param maxLength - The maximum allowed length.
 * @returns A validated span object or null.
 */
const normalizeSpan = (start, end, maxLength) => {
    if (!Number.isFinite(start) || !Number.isFinite(end))
        return null;
    let s = Math.floor(start);
    let e = Math.floor(end);
    if (e < s) {
        const tmp = s;
        s = e;
        e = tmp;
    }
    s = Math.max(0, Math.min(s, maxLength));
    e = Math.max(0, Math.min(e, maxLength));
    if (e <= s)
        return null;
    return { start: s, end: e };
};
/** Checks if a value is a plain object. */
const isRecord = (value) => typeof value === 'object' && value !== null;
/** Casts unknown to trimmed string or undefined. */
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
/** Casts unknown to finite number or undefined. */
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
/** Validates and returns a number between 0 and 1. */
const asConfidence = (value) => {
    const num = asNumber(value);
    if (typeof num !== 'number')
        return undefined;
    if (num < 0 || num > 1)
        return undefined;
    return num;
};
/** Coerces a raw anchor object. */
const coerceAnchor = (value) => {
    if (!isRecord(value))
        return null;
    const start = asNumber(value.start);
    const end = asNumber(value.end);
    if (typeof start !== 'number' || typeof end !== 'number')
        return null;
    if (end <= start)
        return null;
    const sentenceId = asString(value.sentence_id);
    return { start, end, sentence_id: sentenceId };
};
/** Coerces an array of raw anchors. */
const coerceAnchorArray = (value) => {
    if (!Array.isArray(value))
        return [];
    const output = [];
    for (const item of value) {
        const anchor = coerceAnchor(item);
        if (anchor)
            output.push(anchor);
    }
    return output;
};
/** Coerces a raw role object. */
const coerceRole = (value) => {
    if (!isRecord(value))
        return null;
    const role = asString(value.role);
    if (!role)
        return null;
    return {
        role,
        anchors: coerceAnchorArray(value.anchors),
        confidence: asConfidence(value.confidence),
    };
};
/** Coerces a raw rhetoric object. */
const coerceRhetoric = (value) => {
    if (!isRecord(value))
        return null;
    const label = asString(value.label);
    if (!label)
        return null;
    return {
        label,
        evidence_anchors: coerceAnchorArray(value.evidence_anchors),
        confidence: asConfidence(value.confidence),
    };
};
/** Coerces a raw claim object. */
const coerceClaim = (value) => {
    if (!isRecord(value))
        return null;
    const text = asString(value.text);
    if (!text)
        return null;
    return {
        text,
        polarity: normalizePolarity(value.polarity),
        support: normalizeSupport(value.support),
        anchors: coerceAnchorArray(value.anchors),
        entity_links: Array.isArray(value.entity_links)
            ? value.entity_links
                .map(asString)
                .filter((id) => typeof id === 'string')
            : undefined,
    };
};
/** Normalizes polarity values. */
const normalizePolarity = (value) => {
    const str = asString(value);
    if (str === 'pos' || str === 'neg' || str === 'nu')
        return str;
    return 'nu';
};
/** Normalizes support values. */
const normalizeSupport = (value) => {
    const str = asString(value);
    if (str === 'strong' || str === 'weak' || str === 'unspecified')
        return str;
    return 'unspecified';
};
//# sourceMappingURL=paragraph.js.map