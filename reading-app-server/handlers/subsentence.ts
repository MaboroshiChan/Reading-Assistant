import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AnalyzeSubSentenceData,
  RequestEnvelopeSubsentence,
  ResponseEnvelopeSubSentence,
  SubSentenceAnalysisData,
  SubSentenceUnitData,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { buildStableCacheKey, hashString } from './shared';
import { buildMockSubSentenceData } from './mock/subsentenceMock';
import { handlerLog } from './logger';
import { json as llmJson, type LLMUsage } from '../services/llmService';

const CACHE_PREFIX = 'subsentence';
const CACHE_VERSION = 'v1';
const PROMPT_VERSION = 'subsentence.v1';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'subsentence.txt');
const TASK_ORDER = ['micro_roles', 'cue_interaction', 'contrast_resolution'] as const;
type SubSentenceTask = typeof TASK_ORDER[number];
const MAX_CLAUSE_DEPTH = 4;
const NORMALIZED_RESPONSE_DIR = path.join(__dirname, '..', '..', 'resource', 'LLM_response');
const USE_CACHE = false;

type SyntacticRole =
  | 'subject'
  | 'predicate'
  | 'object'
  | 'complement'
  | 'modifier'
  | 'connector'
  | 'clause'
  | 'phrase'
  | 'token';

type SemanticTag =
  | 'cause' | 'result' | 'condition' | 'concession' | 'purpose'
  | 'contrast' | 'transition' | 'example' | 'definition'
  | 'emphasis' | 'topic' | 'comment' | 'time' | 'location' | 'manner'
  | 'evaluation' | 'attribution' | 'reporting' | 'modality' | 'none';

type SemanticRoleName =
  | 'Agent' | 'Patient' | 'Theme' | 'Experiencer' | 'Instrument'
  | 'Goal' | 'Source' | 'Location' | 'Time' | 'Manner' | 'Cause' | 'Condition' | 'None';

type ColorVariant = 'blue' | 'green' | 'yellow' | 'gray';

const ROLE_ALIAS: Record<string, SyntacticRole> = {
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

const SEMANTIC_ALIAS: Record<string, SemanticTag> = {
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

const SEMROLE_ALIAS: Record<string, SemanticRoleName> = {
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

const LEGACY_ROLE_TO_SYNTACTIC: Record<string, SyntacticRole> = {
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

const VARIANTS = new Set<ColorVariant>(['blue', 'green', 'yellow', 'gray']);
const UNIT_SOURCES = ['manual', 'model', 'hybrid'] as const;
type UnitSource = typeof UNIT_SOURCES[number];
const SOURCE_SET = new Set<UnitSource>(UNIT_SOURCES);

const buildCacheKey = (req: RequestEnvelopeSubsentence): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.useMockLLM ? `mock:${config.model}` : config.model,
  });
};

const buildTasks = (req: RequestEnvelopeSubsentence): SubSentenceTask[] => {
  const requested = req.payload.options?.tasks ?? TASK_ORDER;
  const normalized = new Set<SubSentenceTask>();
  for (const raw of requested) {
    if (TASK_ORDER.includes(raw as SubSentenceTask)) {
      normalized.add(raw as SubSentenceTask);
    }
  }
  const ordered = TASK_ORDER.filter((task) => normalized.size === 0 || normalized.has(task));
  return ordered.length ? ordered : [...TASK_ORDER];
};

let cachedPrompt: string | null = null;

const loadPrompt = async (): Promise<string> => {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedPrompt;
};

const extractFragmentText = (
  req: RequestEnvelopeSubsentence,
): { fragmentText: string; sentenceText?: string } => {
  const span = req.payload.span;
  const meta = (req.meta && typeof req.meta === 'object')
    ? (req.meta as Record<string, unknown>)
    : {};
  const sentenceText = typeof meta.sentence_text === 'string' ? meta.sentence_text : undefined;
  const fragmentMeta = typeof meta.fragment_text === 'string' ? meta.fragment_text : undefined;

  const sliceFromSentence = () => {
    if (!sentenceText) return undefined;
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end)) return undefined;
    const start = Math.max(0, Math.floor(span.start));
    const end = Math.max(start, Math.floor(span.end));
    return sentenceText.slice(start, end);
  };

  const base = fragmentMeta?.trim()?.length ? fragmentMeta : sliceFromSentence();
  const fragmentText =
    base && base.trim().length ? base : `fragment:${span.start}-${span.end}`;

  return { fragmentText, sentenceText };
};

const formatContext = (req: RequestEnvelopeSubsentence): string | null => {
  const ctx = req.context;
  if (!ctx) return null;
  const lines: string[] = [];

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

const buildPrompt = async (req: RequestEnvelopeSubsentence): Promise<string> => {
  const basePrompt = (await loadPrompt()).trim();
  const tasks = buildTasks(req);
  const { fragmentText, sentenceText } = extractFragmentText(req);

  const sections: string[] = [
    basePrompt,
    '',
    `Prompt Version: ${PROMPT_VERSION}`,
    `Model Target: ${config.model}`,
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

interface SubSentenceBuildResult {
  data: AnalyzeSubSentenceData;
  usage?: LLMUsage;
}

const buildSubSentenceData = async (
  req: RequestEnvelopeSubsentence,
): Promise<SubSentenceBuildResult> => {
  const tasks = buildTasks(req);

  if (config.useMockLLM) {
    handlerLog('subsentence', 'building mock payload', {
      requestId: req.request_id,
      sentenceId: req.payload.sentence_id,
      tasks,
    });
    return { data: buildMockSubSentenceData(req) };
  }

  handlerLog('subsentence', 'building LLM payload', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: PROMPT_VERSION,
    tasks,
  });
  const prompt = await buildPrompt(req);
  handlerLog('subsentence', 'LLM prompt prepared', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: PROMPT_VERSION,
    tasks,
    promptLength: prompt.length,
  });
  const { object, usage } = await llmJson<unknown>(prompt);
  handlerLog('subsentence', 'LLM response received', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: PROMPT_VERSION,
    model: usage?.modelId,
    tokensIn: usage?.inputTokens,
    tokensOut: usage?.outputTokens,
  });

  const data = mapSubSentenceResponse(object, req, tasks);
  return { data, usage };
};

export const handleSubSentence = async (
  req: RequestEnvelopeSubsentence,
): Promise<ResponseEnvelopeSubSentence> => {
  
  handlerLog('subsentence', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
    promptVersion: PROMPT_VERSION,
  });

  const cacheKey = USE_CACHE ? buildCacheKey(req) : null;
  if (USE_CACHE && cacheKey) {
    const cached = cache.get<ResponseEnvelopeSubSentence>(cacheKey);
    if (cached) {
      handlerLog('subsentence', 'cache hit', {
        requestId: req.request_id,
        cacheKey,
        promptVersion: PROMPT_VERSION,
      });
      return { ...cached, served_from: 'cache' };
    }
  }

  const started = Date.now();
  const { data, usage } = await buildSubSentenceData(req);
  persistNormalizedSubSentence(req, data).catch((error) => {
    handlerLog(
      'subsentence',
      'failed to persist normalized subsentence response',
      {
        requestId: req.request_id,
        error: error instanceof Error ? error.message : String(error),
      },
      'warn',
    );
  });
  handlerLog('subsentence', 'data prepared', {
    requestId: req.request_id,
    source: config.useMockLLM ? 'mock' : 'llm',
    units: data.analysis.units.length,
    promptVersion: PROMPT_VERSION,
  });
  const response: ResponseEnvelopeSubSentence = {
    request_id: req.request_id,
    status: 'ok',
    served_from: 'fresh',
    data,
    usage: {
      latency_ms: Date.now() - started,
      model_id: usage?.modelId ?? (config.useMockLLM ? `mock:${config.model}` : undefined),
      tokens_in: usage?.inputTokens ?? (config.useMockLLM ? 0 : undefined),
      tokens_out: usage?.outputTokens ?? (config.useMockLLM ? 0 : undefined),
    },
  };

  if (USE_CACHE && cacheKey) {
    cache.set(cacheKey, response, config.cacheTtlMs);
    handlerLog('subsentence', 'response cached', {
      requestId: req.request_id,
      latencyMs: Date.now() - started,
      cacheKey,
      promptVersion: PROMPT_VERSION,
    });
  }
  return response;
};

interface SanitizeContext {
  req: RequestEnvelopeSubsentence;
  tasks: readonly SubSentenceTask[];
  fragmentText: string;
  sentenceText?: string;
  usedIds: Set<string>;
}

const mapSubSentenceResponse = (
  payload: unknown,
  req: RequestEnvelopeSubsentence,
  tasks: readonly SubSentenceTask[],
): AnalyzeSubSentenceData => {
  const { fragmentText, sentenceText } = extractFragmentText(req);
  const context: SanitizeContext = {
    req,
    tasks,
    fragmentText,
    sentenceText,
    usedIds: new Set<string>(),
  };

  const top = isRecord(payload) ? payload : {};
  const rawCandidate = isRecord(top.analysis) ? top.analysis : top;
  const rawAnalysis = normalizeLegacyAnalysis(top, rawCandidate, context);

  const analysis = sanitizeAnalysis(rawAnalysis, context, 0, fragmentText);
  const topConfidence = clampConfidence((top as Record<string, unknown>).confidence);

  const data: AnalyzeSubSentenceData = {
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
      fragmentHash: hashString(fragmentText),
    };
    if (sentenceText) {
      analysis.meta.sentenceLength = sentenceText.length;
    }
  }

  return data;
};

const sanitizeAnalysis = (
  raw: unknown,
  ctx: SanitizeContext,
  depth: number,
  fallbackText: string,
): SubSentenceAnalysisData => {
  const record = isRecord(raw) ? raw : {};
  const sentenceId =
    asString(record.sentenceId ?? record.sentence_id) ?? ctx.req.payload.sentence_id;
  const text =
    asString(record.text) ??
    (depth === 0 ? ctx.fragmentText : fallbackText);

  const usedIds = depth === 0 ? ctx.usedIds : new Set<string>();
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

  const analysis: SubSentenceAnalysisData = {
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

const sanitizeUnits = (
  rawUnits: unknown,
  ctx: SanitizeContext,
  depth: number,
  prefix: string,
  parentId?: string,
): SubSentenceUnitData[] => {
  if (!Array.isArray(rawUnits) || depth >= MAX_CLAUSE_DEPTH) return [];

  const units: SubSentenceUnitData[] = [];
  for (let index = 0; index < rawUnits.length; index += 1) {
    const unit = sanitizeUnit(
      rawUnits[index],
      ctx,
      depth,
      parentId ? `${parentId}.` : prefix,
    );
    if (unit) units.push(unit);
  }
  return units;
};

const sanitizeUnit = (
  raw: unknown,
  ctx: SanitizeContext,
  depth: number,
  prefix: string,
): SubSentenceUnitData | null => {
  if (!isRecord(raw)) return null;
  const text = asString(raw.text);
  if (!text) return null;

  let id = sanitizeId(raw.id ?? raw.unit_id ?? raw.unitId);
  if (!id || ctx.usedIds.has(id)) {
    id = makeUniqueId(ctx.usedIds, prefix);
  }
  ctx.usedIds.add(id);

  const unit: SubSentenceUnitData = {
    id,
    text,
  };

  const role = canonicalRole(raw.role ?? raw.syntactic_role ?? raw.function);
  if (role) unit.role = role;

  const semantics = canonicalSemantics(raw.semantics ?? raw.semantic_tag ?? raw.label);
  if (semantics) unit.semantics = semantics;

  const semRole = canonicalSemRole(raw.semRole ?? raw.sem_role ?? raw.semanticRole);
  if (semRole) unit.semRole = semRole;

  const confidence = clampConfidence(raw.confidence);
  if (typeof confidence === 'number') unit.confidence = confidence;

  unit.source = canonicalSource(raw.source) ?? 'model';

  if (isRecord(raw.meta) && Object.keys(raw.meta).length) {
    unit.meta = raw.meta;
  }

  const viewHint = sanitizeViewHint(raw.viewHint ?? raw.view_hint);
  if (viewHint) {
    unit.viewHint = viewHint;
  }

  if (depth + 1 < MAX_CLAUSE_DEPTH && Array.isArray(raw.children)) {
    const childContext: SanitizeContext = { ...ctx, usedIds: ctx.usedIds };
    const childUnits = sanitizeUnits(raw.children, childContext, depth + 1, `${id}.`, id);
    if (childUnits.length) {
      unit.children = childUnits;
    }
  }

  if (depth + 1 < MAX_CLAUSE_DEPTH && raw.clause) {
    const clauseCtx: SanitizeContext = {
      ...ctx,
      usedIds: new Set<string>(),
      fragmentText: text,
    };
    const clause = sanitizeAnalysis(raw.clause, clauseCtx, depth + 1, text);
    if (clause.units.length) {
      unit.clause = clause;
    }
  }

  return unit;
};

const sanitizeBackbone = (
  raw: unknown,
  units: SubSentenceUnitData[],
): SubSentenceAnalysisData['backbone'] | undefined => {
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

  if (!derived.subjectId && !derived.predicateId && !derived.objectId) return undefined;
  return {
    ...(derived.subjectId ? { subjectId: derived.subjectId } : {}),
    ...(derived.predicateId ? { predicateId: derived.predicateId } : {}),
    ...(derived.objectId ? { objectId: derived.objectId } : {}),
  };
};

const findUnitByRole = (role: SyntacticRole, units: SubSentenceUnitData[]): string | undefined => {
  for (const unit of units) {
    if (unit.role === role) return unit.id;
    if (unit.children) {
      const child = findUnitByRole(role, unit.children);
      if (child) return child;
    }
    if (unit.clause) {
      const clause = findUnitByRole(role, unit.clause.units);
      if (clause) return clause;
    }
  }
  return undefined;
};

function normalizeLegacyAnalysis(
  top: Record<string, unknown>,
  raw: Record<string, unknown>,
  ctx: SanitizeContext,
): Record<string, unknown> {
  const roles = extractLegacyRoles(top, raw);
  if (!roles.length) return raw;

  const baseText =
    asString(raw.text) ??
    ctx.fragmentText ??
    (ctx.sentenceText
      ? ctx.sentenceText.slice(
          Math.max(0, ctx.req.payload.span.start),
          Math.max(Math.max(0, ctx.req.payload.span.start), ctx.req.payload.span.end),
        )
      : '');

  const units: SubSentenceUnitData[] = [];
  let index = 1;
  for (const role of roles) {
    const unit = convertLegacyRole(role, ctx, index, baseText);
    if (!unit) continue;
    units.push(unit);
    index += 1;
  }

  if (!units.length) return raw;

  const normalized: Record<string, unknown> = { ...raw };
  normalized.text = baseText;
  normalized.units = units;
  normalized.sentenceId =
    asString(raw.sentenceId ?? raw.sentence_id) ?? ctx.req.payload.sentence_id;

  if (!isRecord(raw.backbone)) {
    const backbone = deriveBackboneFromUnits(units);
    if (backbone) normalized.backbone = backbone;
  }

  const meta = isRecord(raw.meta) ? { ...(raw.meta as Record<string, unknown>) } : {};
  normalized.meta = { ...meta, legacyTransformed: true };

  delete (normalized as { semantic_roles?: unknown }).semantic_roles;
  delete (normalized as { anchors?: unknown }).anchors;

  return normalized;
}

type LegacyRole = Record<string, unknown>;

function extractLegacyRoles(
  top: Record<string, unknown>,
  raw: Record<string, unknown>,
): LegacyRole[] {
  const fromRaw = Array.isArray((raw as { semantic_roles?: unknown }).semantic_roles)
    ? (raw as { semantic_roles: unknown[] }).semantic_roles
    : null;
  const fromTop = Array.isArray((top as { semantic_roles?: unknown }).semantic_roles)
    ? (top as { semantic_roles: unknown[] }).semantic_roles
    : null;
  const source = fromRaw ?? fromTop;
  if (!source) return [];
  return source.filter((item): item is LegacyRole => isRecord(item));
}

function convertLegacyRole(
  rawRole: LegacyRole,
  ctx: SanitizeContext,
  index: number,
  fallbackText: string,
): SubSentenceUnitData | null {
  const label = asString(rawRole.role);
  const span = coerceLegacySpan(rawRole.span);
  const text = pickTextForSpan(span, ctx, fallbackText);
  if (!text) return null;

  const id = `legacy-${index}`;
  const unit: SubSentenceUnitData = {
    id,
    text,
    source: 'model',
  };

  const semRole = label ? canonicalSemRole(label) : undefined;
  if (semRole) unit.semRole = semRole;

  const syntactic =
    label ? LEGACY_ROLE_TO_SYNTACTIC[asLower(label) ?? ''] ?? canonicalRole(label) : undefined;
  if (syntactic) unit.role = syntactic;
  if (!unit.role && semRole === 'Agent') unit.role = 'subject';
  if (!unit.role && semRole === 'Theme') unit.role = 'object';
  if (!unit.role) unit.role = 'token';

  const confidence = clampConfidence(rawRole.confidence);
  if (typeof confidence === 'number') unit.confidence = confidence;

  return unit;
}

function coerceLegacySpan(span: unknown): { start: number; end: number } | null {
  if (!isRecord(span)) return null;
  const start = asNumber(span.start);
  const end = asNumber(span.end);
  if (start === undefined || end === undefined) return null;
  const s = Math.floor(start);
  const e = Math.floor(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return { start: s, end: e };
}

function pickTextForSpan(
  span: { start: number; end: number } | null,
  ctx: SanitizeContext,
  fallback: string,
): string {
  const fragment = ctx.fragmentText ?? fallback;
  if (!span) return fragment;

  const sentence = ctx.sentenceText;
  const totalLength = sentence?.length ?? fragment.length;
  const start = clampIndex(span.start, totalLength);
  const end = clampIndex(span.end, totalLength);
  if (end <= start) return fragment;

  if (sentence) {
    const snippet = sentence.slice(start, end).trim();
    if (snippet) return snippet;
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
    if (clipped) return clipped;
  }

  const approxStart = Math.max(0, start - reqStart);
  const approxEnd = Math.max(approxStart, end - reqStart);
  const approx = fragment.slice(approxStart, approxEnd).trim();
  return approx || fragment;
}

function deriveBackboneFromUnits(
  units: SubSentenceUnitData[],
): SubSentenceAnalysisData['backbone'] | undefined {
  const queue = [...units];
  let subjectId: string | undefined;
  let predicateId: string | undefined;
  let objectId: string | undefined;

  while (queue.length) {
    const unit = queue.shift()!;
    if (!subjectId && unit.role === 'subject') subjectId = unit.id;
    if (!predicateId && unit.role === 'predicate') predicateId = unit.id;
    if (!objectId && unit.role === 'object') objectId = unit.id;
    if (unit.children) queue.push(...unit.children);
    if (unit.clause) queue.push(...unit.clause.units);
  }

  if (!subjectId && !predicateId && !objectId) return undefined;
  return {
    ...(subjectId ? { subjectId } : {}),
    ...(predicateId ? { predicateId } : {}),
    ...(objectId ? { objectId } : {}),
  };
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= max) return max;
  return Math.floor(value);
}

async function persistNormalizedSubSentence(
  req: RequestEnvelopeSubsentence,
  data: AnalyzeSubSentenceData,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const safeStamp = timestamp.replace(/[:.]/g, '-');
  const filename = `${safeStamp}_subsentence-normalized.json`;
  const payload = {
    timestamp,
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    span: req.payload.span,
    analysis: data.analysis,
    confidence: data.confidence,
  };

  await fs.mkdir(NORMALIZED_RESPONSE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(NORMALIZED_RESPONSE_DIR, filename),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

const sanitizeId = (value: unknown): string | undefined => {
  const str = asString(value);
  if (!str) return undefined;
  const cleaned = str.replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.length ? cleaned : undefined;
};

const makeUniqueId = (used: Set<string>, prefix: string): string => {
  let index = 1;
  let candidate = `${prefix}${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${prefix}${index}`;
  }
  return candidate;
};

const canonicalRole = (value: unknown): SyntacticRole | undefined => {
  const key = asLower(value);
  return key ? ROLE_ALIAS[key] : undefined;
};

const canonicalSemantics = (value: unknown): SemanticTag | undefined => {
  const key = asLower(value);
  return key ? SEMANTIC_ALIAS[key] : undefined;
};

const canonicalSemRole = (value: unknown): SemanticRoleName | undefined => {
  const key = asLower(value);
  return key ? SEMROLE_ALIAS[key] : undefined;
};

const canonicalSource = (value: unknown): UnitSource | undefined => {
  const key = asLower(value);
  if (!key) return undefined;
  if (SOURCE_SET.has(key as UnitSource)) {
    return key as UnitSource;
  }
  if (key.startsWith('model')) return 'model';
  return undefined;
};

const canonicalVariant = (value: unknown): ColorVariant | undefined => {
  const key = asLower(value);
  return key && VARIANTS.has(key as ColorVariant) ? (key as ColorVariant) : undefined;
};

const sanitizeViewHint = (value: unknown): SubSentenceUnitData['viewHint'] | undefined => {
  if (!isRecord(value)) return undefined;
  const variant = canonicalVariant(value.variant);
  const collapsed = typeof value.collapsed === 'boolean' ? value.collapsed : undefined;
  const label = asString(value.label);
  const order = asNumber(value.order);

  if (!variant && collapsed === undefined && !label && order === undefined) return undefined;
  return {
    ...(variant ? { variant } : {}),
    ...(collapsed !== undefined ? { collapsed } : {}),
    ...(label ? { label } : {}),
    ...(typeof order === 'number' ? { order: Math.trunc(order) } : {}),
  };
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asLower = (value: unknown): string | undefined => {
  const str = asString(value);
  return str ? str.toLowerCase() : undefined;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const clampConfidence = (value: unknown): number | undefined => {
  const num = asNumber(value);
  if (num === undefined) return undefined;
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return Number(Math.round(num * 1000) / 1000);
};

const asIsoString = (value: unknown): string | undefined => {
  const str = asString(value);
  if (!str) return undefined;
  const parsed = Date.parse(str);
  return Number.isNaN(parsed) ? undefined : str;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
