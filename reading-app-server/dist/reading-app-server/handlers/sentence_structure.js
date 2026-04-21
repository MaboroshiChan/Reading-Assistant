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
exports.handleSentenceStructure = void 0;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const config_1 = require("../services/config");
const cache = __importStar(require("../services/cache"));
const shared_1 = require("./shared");
const sentence_structure_mock_1 = require("./mock/sentence_structure_mock");
const logger_1 = require("./logger");
const llmService_1 = require("../services/llmService");
const CACHE_PREFIX = 'sentence-structure';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = 'sentence_structure.v1';
const PROMPT_PATH = node_path_1.default.join(__dirname, '..', 'prompts', 'v1', 'sentence_structure.txt');
const TASK_ORDER = ['micro_roles', 'cue_interaction', 'contrast_resolution'];
const MAX_CLAUSE_DEPTH = 4;
const NORMALIZED_RESPONSE_DIR = node_path_1.default.join(__dirname, '..', '..', 'resource', 'LLM_response');
const USE_CACHE = false;
const ROLE_ALIAS = {
    subject: 'subject',
    subj: 'subject',
    agent: 'subject',
    predicate: 'predicate',
    pred: 'predicate',
    verb: 'predicate',
    object: 'object',
    obj: 'object',
    patient: 'object',
    complement: 'complement',
    comp: 'complement',
    modifier: 'modifier',
    mod: 'modifier',
    adjunct: 'modifier',
    connector: 'connector',
    conj: 'connector',
    clause: 'clause',
    phrase: 'phrase',
    token: 'token',
};
const SEMANTIC_ALIAS = {
    cause: 'cause',
    causal: 'cause',
    result: 'result',
    consequence: 'result',
    condition: 'condition',
    conditional: 'condition',
    concession: 'concession',
    purpose: 'purpose',
    goal: 'purpose',
    contrast: 'contrast',
    transition: 'transition',
    example: 'example',
    definition: 'definition',
    emphasis: 'emphasis',
    highlight: 'emphasis',
    topic: 'topic',
    theme: 'topic',
    comment: 'comment',
    time: 'time',
    temporal: 'time',
    location: 'location',
    place: 'location',
    manner: 'manner',
    evaluation: 'evaluation',
    assessment: 'evaluation',
    attribution: 'attribution',
    reporting: 'reporting',
    modality: 'modality',
    none: 'none',
};
const SEMROLE_ALIAS = {
    agent: 'Agent',
    actor: 'Agent',
    causer: 'Agent',
    patient: 'Patient',
    object: 'Patient',
    theme: 'Theme',
    experiencer: 'Experiencer',
    instrument: 'Instrument',
    tool: 'Instrument',
    goal: 'Goal',
    destination: 'Goal',
    source: 'Source',
    origin: 'Source',
    location: 'Location',
    place: 'Location',
    time: 'Time',
    manner: 'Manner',
    cause: 'Cause',
    reason: 'Cause',
    condition: 'Condition',
    none: 'None',
};
const LEGACY_ROLE_TO_SYNTACTIC = {
    agent: 'subject',
    actor: 'subject',
    subject: 'subject',
    patient: 'object',
    object: 'object',
    theme: 'object',
    goal: 'object',
    recipient: 'object',
    beneficiary: 'object',
    instrument: 'modifier',
    tool: 'modifier',
    location: 'modifier',
    place: 'modifier',
    time: 'modifier',
    manner: 'modifier',
    cause: 'modifier',
    reason: 'modifier',
    condition: 'modifier',
    topic: 'modifier',
    comment: 'modifier',
    connector: 'connector',
    cue: 'connector',
    predicate: 'predicate',
    action: 'predicate',
    relation: 'complement',
};
const VARIANTS = new Set(['blue', 'green', 'yellow', 'gray']);
const UNIT_SOURCES = ['manual', 'model', 'hybrid'];
const SOURCE_SET = new Set(UNIT_SOURCES);
/**
 * Builds a cache key for sentence structure analysis requests.
 *
 * @param req - The request envelope.
 * @returns A stable cache key.
 */
const buildCacheKey = (req) => {
    return (0, shared_1.buildStableCacheKey)(CACHE_PREFIX, CACHE_VERSION, {
        payload: req.payload,
        context: req.context ?? {},
        prompt_version: PROMPT_VERSION,
        model: config_1.config.useMockLLM ? `mock:${config_1.config.model}` : config_1.config.model,
    });
};
/**
 * Determines and orders the analysis tasks to be performed.
 *
 * @param req - The request envelope containing optional task preferences.
 * @returns An ordered array of tasks.
 */
const buildTasks = (req) => {
    const requested = req.payload.options?.tasks ?? TASK_ORDER;
    const normalized = new Set();
    for (const raw of requested) {
        if (TASK_ORDER.includes(raw)) {
            normalized.add(raw);
        }
    }
    const ordered = TASK_ORDER.filter((task) => normalized.size === 0 || normalized.has(task));
    return ordered.length ? ordered : [...TASK_ORDER];
};
let cachedPrompt = null;
/**
 * Loads the sentence structure prompt from the filesystem, with caching.
 *
 * @returns The prompt text.
 */
const loadPrompt = async () => {
    if (cachedPrompt)
        return cachedPrompt;
    cachedPrompt = await promises_1.default.readFile(PROMPT_PATH, 'utf8');
    return cachedPrompt;
};
/**
 * Extracts or derives the text fragment to be analyzed from the request metadata and span.
 *
 * @param req - The request envelope.
 * @returns An object containing the fragment text and optionally the full sentence text.
 */
const extractFragmentText = (req) => {
    const span = req.payload.span;
    const meta = (req.meta && typeof req.meta === 'object')
        ? req.meta
        : {};
    const sentenceText = typeof meta.sentence_text === 'string' ? meta.sentence_text : undefined;
    const fragmentMeta = typeof meta.fragment_text === 'string' ? meta.fragment_text : undefined;
    const sliceFromSentence = () => {
        if (!sentenceText)
            return undefined;
        if (!Number.isFinite(span.start) || !Number.isFinite(span.end))
            return undefined;
        const start = Math.max(0, Math.floor(span.start));
        const end = Math.max(start, Math.floor(span.end));
        return sentenceText.slice(start, end);
    };
    const base = fragmentMeta?.trim()?.length ? fragmentMeta : sliceFromSentence();
    const fragmentText = base && base.trim().length ? base : `fragment:${span.start}-${span.end}`;
    return { fragmentText, sentenceText };
};
/**
 * Formats contextual information (hierarchy, neighbors, entities) into a string for the LLM prompt.
 *
 * @param req - The request envelope.
 * @returns A formatted context string or null if no context is available.
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
    if (ctx.neighbors?.sentence?.prev_text) {
        lines.push(`Prev sentence: ${ctx.neighbors.sentence.prev_text}`);
    }
    if (ctx.neighbors?.sentence?.next_text) {
        lines.push(`Next sentence: ${ctx.neighbors.sentence.next_text}`);
    }
    if (ctx.neighbors?.paragraph?.prev_summary) {
        lines.push(`Prev paragraph summary: ${ctx.neighbors.paragraph.prev_summary}`);
    }
    if (ctx.neighbors?.paragraph?.next_summary) {
        lines.push(`Next paragraph summary: ${ctx.neighbors.paragraph.next_summary}`);
    }
    if (ctx.global_entities?.entities?.length) {
        lines.push('Known entities:');
        for (const entity of ctx.global_entities.entities.slice(0, 6)) {
            lines.push(`- ${entity.id} [${entity.type}]: ${entity.canonical}`);
        }
    }
    return lines.length ? lines.join('\n') : null;
};
const buildPrompt = async (req) => {
    const basePrompt = (await loadPrompt()).trim();
    const tasks = buildTasks(req);
    const { fragmentText, sentenceText } = extractFragmentText(req);
    const sections = [
        basePrompt,
        '',
        `Prompt Version: ${PROMPT_VERSION}`,
        `Model Target: ${config_1.config.model}`,
        `Document ID: ${req.payload.doc_id}`,
        `Sentence ID: ${req.payload.sentence_id}`,
        `Span: [${req.payload.span.start}, ${req.payload.span.end})`,
        `Requested tasks: ${tasks.join(', ')}`,
        '',
    ];
    if (sentenceText && sentenceText.trim().length) {
        sections.push('Full sentence:', sentenceText.trim(), '');
    }
    sections.push('Fragment to analyze:', fragmentText.trim());
    const ctx = formatContext(req);
    if (ctx) {
        sections.push('', 'Context:', ctx);
    }
    sections.push('', 'Output keys allowed: analysis, confidence');
    return sections.join('\n');
};
/**
 * Orchestrates the data collection for sentence structure analysis,
 * either by calling the LLM or using mock data.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the LLM call return (stream and usage).
 */
const buildSentenceStructureData = async (req) => {
    const tasks = buildTasks(req);
    if (config_1.config.useMockLLM) {
        (0, logger_1.handlerLog)('sentence_structure', 'building mock payload', {
            requestId: req.request_id,
            sentenceId: req.payload.sentence_id,
            tasks,
        });
        const mockData = (0, sentence_structure_mock_1.buildMockSentenceStructureData)(req);
        const text = JSON.stringify(mockData);
        const stream = (async function* () {
            yield text;
        })();
        return {
            data: stream,
            usage: Promise.resolve({
                modelId: `mock:${config_1.config.model}`,
                inputTokens: 0,
                outputTokens: 0,
            }),
        };
    }
    (0, logger_1.handlerLog)('sentence_structure', 'building LLM payload', {
        requestId: req.request_id,
        sentenceId: req.payload.sentence_id,
        promptVersion: PROMPT_VERSION,
        tasks,
    });
    const prompt = await buildPrompt(req);
    (0, logger_1.handlerLog)('sentence_structure', 'LLM prompt prepared', {
        requestId: req.request_id,
        sentenceId: req.payload.sentence_id,
        promptVersion: PROMPT_VERSION,
        tasks,
        promptLength: prompt.length,
    });
    return (0, llmService_1.json)(prompt);
};
/**
 * The main handler for sentence structure analysis requests.
 * Handles caching, LLM interaction, and background result persistence.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the streaming response.
 */
const handleSentenceStructure = async (req) => {
    //console.log("[DEBUG] handleSentenceStructure starting", req.request_id);
    (0, logger_1.handlerLog)('sentence_structure', 'request received', {
        requestId: req.request_id,
        mock: config_1.config.useMockLLM,
        promptVersion: PROMPT_VERSION,
    });
    const cacheKey = USE_CACHE ? buildCacheKey(req) : null;
    if (USE_CACHE && cacheKey) {
        const cached = cache.get(cacheKey);
        if (cached) {
            (0, logger_1.handlerLog)('sentence_structure', 'cache hit', {
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
    }
    const started = Date.now();
    const { data: stream, usage: usagePromise } = await buildSentenceStructureData(req);
    const tappedStream = (async function* () {
        let text = '';
        for await (const chunk of stream) {
            //console.log("[DEBUG] subsentence chunk:", chunk.slice(0, 50));
            text += chunk;
            yield chunk;
        }
        // Background processing
        try {
            const usage = await usagePromise;
            let data;
            if (config_1.config.useMockLLM) {
                data = JSON.parse(text);
            }
            else {
                const object = (0, llmService_1.extractJsonFromText)(text);
                data = mapSentenceStructureResponse(object, req, buildTasks(req));
            }
            void persistNormalizedSentenceStructure(req, data);
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
            if (USE_CACHE && cacheKey) {
                cache.set(cacheKey, response, config_1.config.cacheTtlMs);
            }
        }
        catch (error) {
            console.warn('[sentence_structure] failed to process/cache response', error);
        }
    })();
    return { data: tappedStream, usage: usagePromise };
};
exports.handleSentenceStructure = handleSentenceStructure;
/**
 * Maps and sanitizes the raw LLM response into the final AnalyzeSentenceStructureData structure.
 *
 * @param payload - The raw JSON payload from the LLM.
 * @param req - The original request envelope.
 * @param tasks - The list of tasks that were requested.
 * @returns The sanitized analysis data.
 */
const mapSentenceStructureResponse = (payload, req, tasks) => {
    const { fragmentText, sentenceText } = extractFragmentText(req);
    const context = {
        req,
        tasks,
        fragmentText,
        sentenceText,
        usedIds: new Set(),
    };
    const top = isRecord(payload) ? payload : {};
    const rawCandidate = isRecord(top.analysis) ? top.analysis : top;
    const rawAnalysis = normalizeLegacyAnalysis(top, rawCandidate, context);
    const analysis = sanitizeAnalysis(rawAnalysis, context, 0, fragmentText);
    const topConfidence = clampConfidence(top.confidence);
    const data = {
        analysis,
    };
    if (typeof topConfidence === 'number') {
        data.confidence = topConfidence;
        if (typeof analysis.confidence !== 'number') {
            analysis.confidence = topConfidence;
        }
    }
    if (!analysis.meta) {
        analysis.meta = {};
    }
    if (!analysis.meta?.promptVersion) {
        analysis.meta = {
            ...analysis.meta,
            promptVersion: PROMPT_VERSION,
            tasks: [...tasks],
            span: { ...req.payload.span },
            fragmentHash: (0, shared_1.hashString)(fragmentText),
        };
        if (sentenceText) {
            analysis.meta.sentenceLength = sentenceText.length;
        }
    }
    return data;
};
/**
 * Recursively sanitizes an analysis object.
 *
 * @param raw - The raw analysis data.
 * @param ctx - The sanitization context.
 * @param depth - The current recursion depth.
 * @param fallbackText - Text to use if no text is provided in the raw data.
 * @returns A sanitized SentenceStructureAnalysisData object.
 */
const sanitizeAnalysis = (raw, ctx, depth, fallbackText) => {
    const record = isRecord(raw) ? raw : {};
    const sentenceId = asString(record.sentenceId ?? record.sentence_id) ?? ctx.req.payload.sentence_id;
    const text = asString(record.text) ??
        (depth === 0 ? ctx.fragmentText : fallbackText);
    const usedIds = depth === 0 ? ctx.usedIds : new Set();
    const units = sanitizeUnits(record.units, { ...ctx, usedIds }, depth, depth === 0 ? 'u' : 'c');
    if (!units.length) {
        const fallbackId = makeUniqueId(usedIds, depth === 0 ? 'u' : 'c');
        usedIds.add(fallbackId);
        units.push({
            id: fallbackId,
            text,
            role: 'clause',
            confidence: 0.55,
            source: 'model',
        });
    }
    const analysis = {
        sentenceId,
        text,
        units,
    };
    const backbone = sanitizeBackbone(record.backbone, units);
    if (backbone) {
        analysis.backbone = backbone;
    }
    const confidence = clampConfidence(record.confidence);
    if (typeof confidence === 'number') {
        analysis.confidence = confidence;
    }
    const analyzedAt = asIsoString(record.analyzedAt ?? record.analyzed_at);
    if (analyzedAt) {
        analysis.analyzedAt = analyzedAt;
    }
    if (typeof record.version === 'number' && Number.isFinite(record.version)) {
        analysis.version = Math.trunc(record.version);
    }
    if (isRecord(record.meta) && Object.keys(record.meta).length) {
        analysis.meta = record.meta;
    }
    return analysis;
};
/**
 * Sanitizes an array of structure units.
 *
 * @param rawUnits - The raw units array.
 * @param ctx - The sanitization context.
 * @param depth - The current recursion depth.
 * @param prefix - Prefix for ID generation.
 * @param parentId - Optional ID of the parent unit.
 * @returns An array of sanitized unit data.
 */
const sanitizeUnits = (rawUnits, ctx, depth, prefix, parentId) => {
    if (!Array.isArray(rawUnits) || depth >= MAX_CLAUSE_DEPTH)
        return [];
    const units = [];
    for (let index = 0; index < rawUnits.length; index += 1) {
        const unit = sanitizeUnit(rawUnits[index], ctx, depth, parentId ? `${parentId}.` : prefix);
        if (unit)
            units.push(unit);
    }
    return units;
};
/**
 * Sanitizes a single structure unit, including its role, semantics, and recursive children/clauses.
 *
 * @param raw - The raw unit data.
 * @param ctx - The sanitization context.
 * @param depth - The current recursion depth.
 * @param prefix - Prefix for ID generation if needed.
 * @returns A sanitized unit object or null if invalid.
 */
const sanitizeUnit = (raw, ctx, depth, prefix) => {
    if (!isRecord(raw))
        return null;
    const text = asString(raw.text);
    if (!text)
        return null;
    let id = sanitizeId(raw.id ?? raw.unit_id ?? raw.unitId);
    if (!id || ctx.usedIds.has(id)) {
        id = makeUniqueId(ctx.usedIds, prefix);
    }
    ctx.usedIds.add(id);
    const unit = {
        id,
        text,
    };
    const role = canonicalRole(raw.role ?? raw.syntactic_role ?? raw.function);
    if (role)
        unit.role = role;
    const semantics = canonicalSemantics(raw.semantics ?? raw.semantic_tag ?? raw.label);
    if (semantics)
        unit.semantics = semantics;
    const semRole = canonicalSemRole(raw.semRole ?? raw.sem_role ?? raw.semanticRole);
    if (semRole)
        unit.semRole = semRole;
    const confidence = clampConfidence(raw.confidence);
    if (typeof confidence === 'number')
        unit.confidence = confidence;
    unit.source = canonicalSource(raw.source) ?? 'model';
    if (isRecord(raw.meta) && Object.keys(raw.meta).length) {
        unit.meta = raw.meta;
    }
    const viewHint = sanitizeViewHint(raw.viewHint ?? raw.view_hint);
    if (viewHint) {
        unit.viewHint = viewHint;
    }
    if (depth + 1 < MAX_CLAUSE_DEPTH && Array.isArray(raw.children)) {
        const childContext = { ...ctx, usedIds: ctx.usedIds };
        const childUnits = sanitizeUnits(raw.children, childContext, depth + 1, `${id}.`, id);
        if (childUnits.length) {
            unit.children = childUnits;
        }
    }
    if (depth + 1 < MAX_CLAUSE_DEPTH && raw.clause) {
        const clauseCtx = {
            ...ctx,
            usedIds: new Set(),
            fragmentText: text,
        };
        const clause = sanitizeAnalysis(raw.clause, clauseCtx, depth + 1, text);
        if (clause.units.length) {
            unit.clause = clause;
        }
    }
    return unit;
};
/**
 * Sanitizes or derives the backbone (subject-predicate-object) structure from units.
 *
 * @param raw - The raw backbone data.
 * @param units - The list of units to search if explicit IDs are missing.
 * @returns A sanitized backbone object or undefined.
 */
const sanitizeBackbone = (raw, units) => {
    const fromRaw = isRecord(raw)
        ? {
            subjectId: asString(raw.subjectId ?? raw.subject_id),
            predicateId: asString(raw.predicateId ?? raw.predicate_id),
            objectId: asString(raw.objectId ?? raw.object_id),
        }
        : {};
    const derived = {
        subjectId: fromRaw.subjectId ?? findUnitByRole('subject', units),
        predicateId: fromRaw.predicateId ?? findUnitByRole('predicate', units),
        objectId: fromRaw.objectId ?? findUnitByRole('object', units),
    };
    if (!derived.subjectId && !derived.predicateId && !derived.objectId)
        return undefined;
    return {
        ...(derived.subjectId ? { subjectId: derived.subjectId } : {}),
        ...(derived.predicateId ? { predicateId: derived.predicateId } : {}),
        ...(derived.objectId ? { objectId: derived.objectId } : {}),
    };
};
/**
 * Recursively finds the first unit with a specific syntactic role.
 *
 * @param role - The role to find.
 * @param units - The list of units to search.
 * @returns The found unit ID or undefined.
 */
const findUnitByRole = (role, units) => {
    for (const unit of units) {
        if (unit.role === role)
            return unit.id;
        if (unit.children) {
            const child = findUnitByRole(role, unit.children);
            if (child)
                return child;
        }
        if (unit.clause) {
            const clause = findUnitByRole(role, unit.clause.units);
            if (clause)
                return clause;
        }
    }
    return undefined;
};
/**
 * Detects legacy response formats and maps them to the current internal model.
 *
 * @param top - The top-level response object.
 * @param raw - The raw analysis part.
 * @param ctx - The sanitization context.
 * @returns A normalized analysis object.
 */
function normalizeLegacyAnalysis(top, raw, ctx) {
    const roles = extractLegacyRoles(top, raw);
    if (!roles.length)
        return raw;
    const baseText = asString(raw.text) ??
        ctx.fragmentText ??
        (ctx.sentenceText
            ? ctx.sentenceText.slice(Math.max(0, ctx.req.payload.span.start), Math.max(Math.max(0, ctx.req.payload.span.start), ctx.req.payload.span.end))
            : '');
    const units = [];
    let index = 1;
    for (const role of roles) {
        const unit = convertLegacyRole(role, ctx, index, baseText);
        if (!unit)
            continue;
        units.push(unit);
        index += 1;
    }
    if (!units.length)
        return raw;
    const normalized = { ...raw };
    normalized.text = baseText;
    normalized.units = units;
    normalized.sentenceId =
        asString(raw.sentenceId ?? raw.sentence_id) ?? ctx.req.payload.sentence_id;
    if (!isRecord(raw.backbone)) {
        const backbone = deriveBackboneFromUnits(units);
        if (backbone)
            normalized.backbone = backbone;
    }
    const meta = isRecord(raw.meta) ? { ...raw.meta } : {};
    normalized.meta = { ...meta, legacyTransformed: true };
    delete normalized.semantic_roles;
    delete normalized.anchors;
    return normalized;
}
/**
 * Extracts legacy "semantic_roles" or "anchors" from the raw response.
 *
 * @param top - The top-level response object.
 * @param raw - The raw analysis part.
 * @returns An array of legacy role objects.
 */
function extractLegacyRoles(top, raw) {
    const fromRaw = Array.isArray(raw.semantic_roles)
        ? raw.semantic_roles
        : null;
    const fromTop = Array.isArray(top.semantic_roles)
        ? top.semantic_roles
        : null;
    const source = fromRaw ?? fromTop;
    if (!source)
        return [];
    return source.filter((item) => isRecord(item));
}
/**
 * Converts a single legacy role entry into a modern structure unit.
 *
 * @param rawRole - The legacy role data.
 * @param ctx - The sanitization context.
 * @param index - Index for ID generation.
 * @param fallbackText - Fallback text if no text is found for the span.
 * @returns A modern unit object or null.
 */
function convertLegacyRole(rawRole, ctx, index, fallbackText) {
    const label = asString(rawRole.role);
    const span = coerceLegacySpan(rawRole.span);
    const text = pickTextForSpan(span, ctx, fallbackText);
    if (!text)
        return null;
    const id = `legacy-${index}`;
    const unit = {
        id,
        text,
        source: 'model',
    };
    const semRole = label ? canonicalSemRole(label) : undefined;
    if (semRole)
        unit.semRole = semRole;
    const syntactic = label ? LEGACY_ROLE_TO_SYNTACTIC[asLower(label) ?? ''] ?? canonicalRole(label) : undefined;
    if (syntactic)
        unit.role = syntactic;
    if (!unit.role && semRole === 'Agent')
        unit.role = 'subject';
    if (!unit.role && semRole === 'Theme')
        unit.role = 'object';
    if (!unit.role)
        unit.role = 'token';
    const confidence = clampConfidence(rawRole.confidence);
    if (typeof confidence === 'number')
        unit.confidence = confidence;
    return unit;
}
/**
 * Coerces and validates a legacy span object.
 *
 * @param span - The raw span data.
 * @returns A valid span object or null.
 */
function coerceLegacySpan(span) {
    if (!isRecord(span))
        return null;
    const start = asNumber(span.start);
    const end = asNumber(span.end);
    if (start === undefined || end === undefined)
        return null;
    const s = Math.floor(start);
    const e = Math.floor(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s)
        return null;
    return { start: s, end: e };
}
/**
 * Selects the best text snippet for a given span, considering context and fallback.
 *
 * @param span - The span to get text for.
 * @param ctx - The sanitization context.
 * @param fallback - Fallback text if snippet extraction fails.
 * @returns The extracted or fallback text.
 */
function pickTextForSpan(span, ctx, fallback) {
    const fragment = ctx.fragmentText ?? fallback;
    if (!span)
        return fragment;
    const sentence = ctx.sentenceText;
    const totalLength = sentence?.length ?? fragment.length;
    const start = clampIndex(span.start, totalLength);
    const end = clampIndex(span.end, totalLength);
    if (end <= start)
        return fragment;
    if (sentence) {
        const snippet = sentence.slice(start, end).trim();
        if (snippet)
            return snippet;
    }
    const requestSpan = ctx.req.payload.span;
    const reqStart = Math.max(0, Math.floor(requestSpan.start ?? 0));
    const reqEnd = Math.max(reqStart, Math.floor(requestSpan.end ?? reqStart + fragment.length));
    const overlapStart = Math.max(start, reqStart);
    const overlapEnd = Math.min(end, reqEnd);
    if (overlapEnd > overlapStart) {
        const localStart = overlapStart - reqStart;
        const localEnd = overlapEnd - reqStart;
        const clipped = fragment.slice(localStart, localEnd).trim();
        if (clipped)
            return clipped;
    }
    const approxStart = Math.max(0, start - reqStart);
    const approxEnd = Math.max(approxStart, end - reqStart);
    const approx = fragment.slice(approxStart, approxEnd).trim();
    return approx || fragment;
}
/**
 * Persists the normalized analysis to the filesystem for debugging and dataset collection.
 *
 * @param req - The original request envelope.
 * @param data - The normalized analysis data.
 */
async function persistNormalizedSentenceStructure(req, data) {
    const dir = NORMALIZED_RESPONSE_DIR;
    try {
        await promises_1.default.mkdir(dir, { recursive: true });
        const name = `${Date.now()}_${req.payload.doc_id}_${req.payload.sentence_id}.json`;
        const target = node_path_1.default.join(dir, name);
        await promises_1.default.writeFile(target, JSON.stringify({ request: req, response: data }, null, 2));
    }
    catch (error) {
        console.warn('[sentence_structure] failed to persist normalization', error);
    }
}
/**
 * Derives the backbone structure by searching for units with subject/predicate/object roles.
 *
 * @param units - The list of units to search.
 * @returns The derived backbone object or undefined.
 */
function deriveBackboneFromUnits(units) {
    const s = units.find((u) => u.role === 'subject')?.id;
    const p = units.find((u) => u.role === 'predicate')?.id;
    const o = units.find((u) => u.role === 'object')?.id;
    if (!s && !p && !o)
        return undefined;
    return {
        ...(s ? { subjectId: s } : {}),
        ...(p ? { predicateId: p } : {}),
        ...(o ? { objectId: o } : {}),
    };
}
// -----------------------------
// Utilities & Aliases
// -----------------------------
/** Checks if a value is a plain object (not null, not array). */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Casts unknown to string or undefined. */
const asString = (v) => (typeof v === 'string' ? v : undefined);
/** Casts unknown to lowercase string or undefined. */
const asLower = (v) => (typeof v === 'string' ? v.toLowerCase() : undefined);
/** Casts unknown to finite number or undefined. */
const asNumber = (v) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
/** Validates and converts unknown to ISO date string or undefined. */
const asIsoString = (v) => {
    if (typeof v !== 'string')
        return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
/** Clamps a value between 0 and 1. */
const clampConfidence = (v) => {
    const n = asNumber(v);
    if (n === undefined)
        return undefined;
    return Math.max(0, Math.min(1, n));
};
/** Clamps an index between 0 and max. */
const clampIndex = (v, max) => Math.max(0, Math.min(max, Math.floor(v)));
/** Sanitizes an ID string. */
const sanitizeId = (v) => {
    const s = asString(v);
    if (!s)
        return undefined;
    const cleaned = s.trim();
    return cleaned.length ? cleaned : undefined;
};
/** Generates a unique ID within a given set. */
const makeUniqueId = (used, prefix) => {
    let counter = 1;
    let candidate = `${prefix}${counter}`;
    while (used.has(candidate)) {
        counter += 1;
        candidate = `${prefix}${counter}`;
    }
    return candidate;
};
/** Normalizes a syntactic role. */
const canonicalRole = (v) => ROLE_ALIAS[asLower(v) ?? ''];
/** Normalizes a semantic tag. */
const canonicalSemantics = (v) => SEMANTIC_ALIAS[asLower(v) ?? ''];
/** Normalizes a semantic role name. */
const canonicalSemRole = (v) => SEMROLE_ALIAS[asLower(v) ?? ''];
/** Validates a data source. */
const canonicalSource = (v) => SOURCE_SET.has(asLower(v)) ? asLower(v) : undefined;
/** Sanitizes layout/view hints. */
const sanitizeViewHint = (v) => {
    if (!isRecord(v))
        return undefined;
    const hint = {};
    if (typeof v.collapsed === 'boolean')
        hint.collapsed = v.collapsed;
    const variant = asString(v.variant);
    if (variant && VARIANTS.has(variant))
        hint.variant = variant;
    const label = asString(v.label);
    if (label)
        hint.label = label;
    const order = asNumber(v.order);
    if (order !== undefined)
        hint.order = order;
    return Object.keys(hint).length ? hint : undefined;
};
//# sourceMappingURL=sentence_structure.js.map