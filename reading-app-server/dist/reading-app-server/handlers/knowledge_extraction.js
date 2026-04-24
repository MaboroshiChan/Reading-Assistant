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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleKnowledgeExtraction = void 0;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const config_1 = require("../services/config");
const cache = __importStar(require("../services/cache"));
const llmService_1 = require("../services/llmService");
const shared_1 = require("./shared");
const logger_1 = require("./logger");
const CACHE_PREFIX = 'knowledge-extraction';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'knowledge_extraction.v2.0';
const PROMPT_PATH = node_path_1.default.join(__dirname, '..', 'prompts', 'v1', 'knowledge_extraction.txt');
const ENTITY_TYPES = new Set(['organization', 'place', 'time', 'object', 'other']);
const NODE_TYPES = new Set(['person', 'idea', 'event', 'entity', 'theme']);
const RELATION_TYPES = new Set([
    'knows',
    'supports',
    'opposes',
    'extends',
    'causes',
    'participates_in',
    'located_in',
    'happens_at',
    'reflects',
    'related_to',
]);
const IDEA_KINDS = new Set(['claim', 'belief', 'question', 'principle', 'conflict']);
const asIdeaKind = (value) => {
    const kind = asString(value);
    return kind && IDEA_KINDS.has(kind) ? kind : undefined;
};
const asEntityType = (value) => {
    const type = asString(value);
    return type && ENTITY_TYPES.has(type) ? type : undefined;
};
const asNodeType = (value) => {
    const type = asString(value);
    return type && NODE_TYPES.has(type) ? type : undefined;
};
const asRelationType = (value) => {
    const type = asString(value);
    return type && RELATION_TYPES.has(type) ? type : undefined;
};
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const sanitizeStringArray = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const items = value.map(asString).filter((item) => Boolean(item));
    return items.length ? items : undefined;
};
const sanitizeEvidence = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const evidence = value
        .map((item) => {
        if (!isRecord(item))
            return null;
        const quote = asString(item.quote);
        if (!quote)
            return null;
        return { quote };
    })
        .filter((item) => item !== null);
    return evidence.length ? evidence : undefined;
};
const sanitizePeople = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const people = value
        .map((item, index) => {
        if (!isRecord(item))
            return null;
        const name = asString(item.name);
        if (!name)
            return null;
        return {
            local_id: asString(item.local_id) ?? `p${index + 1}`,
            name,
            aliases: sanitizeStringArray(item.aliases),
            description: asString(item.description),
            roles: sanitizeStringArray(item.roles),
            traits: sanitizeStringArray(item.traits),
            evidence: sanitizeEvidence(item.evidence),
        };
    })
        .filter((item) => item !== null);
    return people.length ? people : undefined;
};
const sanitizeIdeas = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const ideas = value
        .map((item, index) => {
        if (!isRecord(item))
            return null;
        const label = asString(item.label);
        if (!label)
            return null;
        const kind = asIdeaKind(item.kind);
        return {
            local_id: asString(item.local_id) ?? `i${index + 1}`,
            label,
            description: asString(item.description),
            kind: kind ?? 'claim',
            evidence: sanitizeEvidence(item.evidence),
        };
    })
        .filter((item) => item !== null);
    return ideas.length ? ideas : undefined;
};
const sanitizeEvents = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const events = value
        .map((item, index) => {
        if (!isRecord(item))
            return null;
        const label = asString(item.label);
        if (!label)
            return null;
        return {
            local_id: asString(item.local_id) ?? `e${index + 1}`,
            label,
            description: asString(item.description),
            participant_local_ids: sanitizeStringArray(item.participant_local_ids),
            time_hint: asString(item.time_hint),
            place_hint: asString(item.place_hint),
            evidence: sanitizeEvidence(item.evidence),
        };
    })
        .filter((item) => item !== null);
    return events.length ? events : undefined;
};
const sanitizeEntities = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const entities = value
        .map((item, index) => {
        if (!isRecord(item))
            return null;
        const label = asString(item.label);
        const type = asEntityType(item.type);
        if (!label || !type)
            return null;
        return {
            local_id: asString(item.local_id) ?? `n${index + 1}`,
            label,
            type,
            description: asString(item.description),
            evidence: sanitizeEvidence(item.evidence),
        };
    })
        .filter((item) => item !== null);
    return entities.length ? entities : undefined;
};
const sanitizeThemes = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const themes = value
        .map((item, index) => {
        if (!isRecord(item))
            return null;
        const label = asString(item.label);
        if (!label)
            return null;
        const strength = asNumber(item.strength);
        return {
            local_id: asString(item.local_id) ?? `t${index + 1}`,
            label,
            strength: typeof strength === 'number' ? Math.max(0, Math.min(1, strength)) : undefined,
            description: asString(item.description),
            evidence: sanitizeEvidence(item.evidence),
        };
    })
        .filter((item) => item !== null);
    return themes.length ? themes : undefined;
};
const sanitizeRelations = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const relations = value
        .map((item, index) => {
        if (!isRecord(item))
            return null;
        const fromId = asString(item.from_id);
        const fromType = asNodeType(item.from_type);
        const toId = asString(item.to_id);
        const toType = asNodeType(item.to_type);
        if (!fromId || !fromType || !toId || !toType)
            return null;
        const relationType = asRelationType(item.relation_type);
        const confidence = asNumber(item.confidence);
        return {
            local_id: asString(item.local_id) ?? `r${index + 1}`,
            from_id: fromId,
            from_type: fromType,
            to_id: toId,
            to_type: toType,
            relation_type: relationType ?? 'related_to',
            description: asString(item.description),
            confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : undefined,
            evidence: sanitizeEvidence(item.evidence),
        };
    })
        .filter((item) => item !== null);
    return relations.length ? relations : undefined;
};
const buildFallbackKnowledge = (req) => ({
    title: req.payload.chapter_title ?? `Chapter ${req.payload.chapter_id}`,
    summary: (0, shared_1.summarize)(req.payload.chapter_text, 240),
    people: [],
    ideas: [],
    events: [],
    entities: [],
    themes: [],
    relations: [],
});
const sanitizeKnowledgeExtraction = (raw, req) => {
    const record = isRecord(raw) ? raw : {};
    return {
        title: asString(record.title) ?? req.payload.chapter_title ?? `Chapter ${req.payload.chapter_id}`,
        summary: asString(record.summary) ?? (0, shared_1.summarize)(req.payload.chapter_text, 240),
        people: sanitizePeople(record.people) ?? [],
        ideas: sanitizeIdeas(record.ideas) ?? [],
        events: sanitizeEvents(record.events) ?? [],
        entities: sanitizeEntities(record.entities) ?? [],
        themes: sanitizeThemes(record.themes) ?? [],
        relations: sanitizeRelations(record.relations) ?? [],
    };
};
const buildCacheKey = (req) => {
    return (0, shared_1.buildStableCacheKey)(CACHE_PREFIX, CACHE_VERSION, {
        payload: req.payload,
        context: req.context ?? {},
        prompt_version: PROMPT_VERSION,
        model: config_1.config.model,
    });
};
let cachedSystemPrompt = null;
const loadSystemPrompt = async () => {
    if (cachedSystemPrompt)
        return cachedSystemPrompt;
    cachedSystemPrompt = (await promises_1.default.readFile(PROMPT_PATH, 'utf8')).trim();
    return cachedSystemPrompt;
};
const buildPrompt = (req) => {
    const sections = [
        `Document ID: ${req.payload.doc_id}`,
        `Chapter ID: ${req.payload.chapter_id}`,
        `Chapter Title: ${req.payload.chapter_title ?? ''}`,
        `Chunk ID: ${req.payload.chunk_id ?? ''}`,
        `Chunk Index: ${req.payload.chunk_index ?? ''}`,
        `Total Chunks: ${req.payload.total_chunks ?? ''}`,
        `Prompt Version: ${PROMPT_VERSION}`,
        '',
        'Memory context:',
        '```text',
        req.payload.memory_context ?? '',
        '```',
        '',
        'Chapter text:',
        '```text',
        req.payload.chapter_text,
        '```',
        '',
        'Respond with JSON only. Do not wrap the JSON in markdown fences.',
    ];
    return sections.join('\n');
};
const buildKnowledgeExtractionData = async (req) => {
    (0, logger_1.handlerLog)('knowledge_extraction', 'building LLM prompt', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
    });
    const [systemPrompt, userPrompt] = await Promise.all([
        loadSystemPrompt(),
        Promise.resolve(buildPrompt(req)),
    ]);
    const llmClient = (0, llmService_1.createLLMClient)({ systemPrompt });
    (0, logger_1.handlerLog)('knowledge_extraction', 'LLM prompt prepared', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        promptVersion: PROMPT_VERSION,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
    });
    return llmClient.json(userPrompt);
};
const handleKnowledgeExtraction = async (req) => {
    (0, logger_1.handlerLog)('knowledge_extraction', 'request received', {
        requestId: req.request_id,
        chapterId: req.payload.chapter_id,
        chunkId: req.payload.chunk_id,
        promptVersion: PROMPT_VERSION,
    });
    const cacheKey = buildCacheKey(req);
    const cached = cache.get(cacheKey);
    if (cached) {
        (0, logger_1.handlerLog)('knowledge_extraction', 'cache hit', {
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
    const { data: stream, usage: usagePromise } = await buildKnowledgeExtractionData(req);
    const tappedStream = (async function* () {
        let text = '';
        for await (const chunk of stream) {
            text += chunk;
            yield chunk;
        }
        try {
            const usage = await usagePromise;
            const raw = (0, llmService_1.extractJsonFromText)(text);
            const data = sanitizeKnowledgeExtraction(raw, req);
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
            console.warn('[knowledge_extraction] failed to cache response', error);
            const fallback = buildFallbackKnowledge(req);
            const response = {
                request_id: req.request_id,
                status: 'ok',
                served_from: 'fresh',
                data: fallback,
                usage: {
                    latency_ms: Date.now() - started,
                },
            };
            cache.set(cacheKey, response, config_1.config.cacheTtlMs);
        }
    })();
    return { data: tappedStream, usage: usagePromise };
};
exports.handleKnowledgeExtraction = handleKnowledgeExtraction;
//# sourceMappingURL=knowledge_extraction.js.map