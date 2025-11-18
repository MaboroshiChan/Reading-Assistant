import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AnalyzeSentenceData,
  Anchor,
  DependencyArc,
  DependencyLight,
  ModalMarker,
  RequestEnvelopeSentence,
  ResponseEnvelopeSentence,
  SentenceRole,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { json as llmJson, type LLMUsage } from '../services/llmService';
import { buildStableCacheKey, makeAnchor, sortAnchors } from './shared';
import { buildMockSentenceData } from './mock/sentenceMock';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'sentence';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'sentence.v1';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'sentence.txt');
const TASK_ORDER: readonly SentenceTask[] = ['semantic_roles', 'discourse_function', 'dependency_light', 'modal_markers'];

export type SentenceTask = 'semantic_roles' | 'discourse_function' | 'dependency_light' | 'modal_markers';
export { PROMPT_VERSION as SENTENCE_PROMPT_VERSION };

interface LLMSentenceSpan {
  start: number;
  end: number;
}

interface LLMSentenceAnchor extends LLMSentenceSpan {
  sentence_id?: string;
}

interface LLMSentenceRole {
  role?: string;
  span?: LLMSentenceSpan;
  anchors?: LLMSentenceAnchor[];
  confidence?: number;
}

interface LLMSentenceModalMarker {
  type?: string;
  span?: LLMSentenceSpan;
  cue?: string;
}

interface LLMSentenceDependencyArc {
  head?: number;
  dep?: number;
  label?: string;
}

interface LLMSentenceDependencyLight {
  head_indexed?: boolean;
  arcs?: LLMSentenceDependencyArc[];
}

interface LLMSentenceResponse {
  semantic_roles?: LLMSentenceRole[];
  discourse_function?: string;
  dependency_light?: LLMSentenceDependencyLight;
  modal_markers?: LLMSentenceModalMarker[];
  anchors?: LLMSentenceAnchor[];
  confidence?: number;
}

interface SentenceBuildResult {
  data: AnalyzeSentenceData;
  usage?: LLMUsage;
}

const ROLE_ALIAS: Record<string, string> = {
  subject: 'subject',
  predicate: 'predicate',
  object: 'object',
  agent: 'subject',
  patient: 'object',
  topic: 'topic',
  claim: 'claim',
  evidence: 'evidence',
  concession: 'concession',
  support: 'support',
  counter: 'counter',
  background: 'background',
  summary: 'summary',
};

const MODAL_TYPE_CANONICAL: Record<string, ModalMarker['type']> = {
  must: 'necessity',
  should: 'necessity',
  shall: 'necessity',
  ought: 'necessity',
  need: 'necessity',
  needs: 'necessity',
  needed: 'necessity',
  can: 'possibility',
  could: 'possibility',
  might: 'possibility',
  may: 'possibility',
  possibly: 'possibility',
  perhaps: 'possibility',
  maybe: 'possibility',
  likely: 'possibility',
  will: 'certainty',
  would: 'volition',
  desire: 'volition',
  want: 'volition',
};

const normalizeRoleLabel = (value: string): string => {
  const key = value.trim().toLowerCase();
  const candidate = ROLE_ALIAS[key] ?? key;
  return candidate || 'unknown';
};

/**
 * TODO: Write description 
 * The purpose of this function is to ...
 * @param value 
 * @returns TODO
 */
const normalizeModalType = (value: string): ModalMarker['type'] => {
  const key = value.trim().toLowerCase();
  return MODAL_TYPE_CANONICAL[key] ?? (key || 'unknown');
};

const buildCacheKey = (req: RequestEnvelopeSentence): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.useMockLLM ? `mock:${config.model}` : config.model,
  });
};

let cachedSentencePrompt: string | null = null;

const loadSentencePrompt = async (): Promise<string> => {
  if (cachedSentencePrompt) return cachedSentencePrompt;
  cachedSentencePrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedSentencePrompt;
};

const buildTasks = (req: RequestEnvelopeSentence): SentenceTask[] => {
  const requested = req.payload.options?.tasks ?? TASK_ORDER;
  const normalized = new Set<SentenceTask>();
  for (const rawTask of requested) {
    if (!TASK_ORDER.includes(rawTask as SentenceTask)) continue;
    normalized.add(rawTask as SentenceTask);
  }
  const ordered = TASK_ORDER.filter((task) => normalized.size === 0 || normalized.has(task));
  return ordered.length ? ordered : [...TASK_ORDER];
};

const formatContext = (req: RequestEnvelopeSentence): string | null => {
  const ctx = req.context;
  if (!ctx) return null;

  const lines: string[] = [];

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
      .slice(0, 6)
      .map((entity) => `${entity.id} [${entity.type}]: ${entity.canonical}`);
    lines.push('Known entities:');
    lines.push(...entityLines);
  }

  if (!lines.length) return null;
  return lines.join('\n');
};

const buildPrompt = async (req: RequestEnvelopeSentence): Promise<string> => {
  const basePrompt = (await loadSentencePrompt()).trim();
  const tasks = buildTasks(req);

  const sections: string[] = [
    basePrompt,
    '',
    `Document ID: ${req.payload.doc_id}`,
    `Sentence ID: ${req.payload.sentence_id}`,
    `Prompt Version: ${PROMPT_VERSION}`,
    `Requested tasks: ${tasks.join(', ')}`,
    '',
    'Sentence text (0-based offsets):',
    '```text',
    req.payload.sentence_text,
    '```',
  ];

  const contextBlock = formatContext(req);
  if (contextBlock) {
    sections.push('', 'Additional context:', contextBlock);
  }

  sections.push(
    '',
    'Respond with JSON only. Do not wrap the JSON in markdown fences.',
  );

  return sections.join('\n');
};

const buildSentenceData = async (
  req: RequestEnvelopeSentence,
): Promise<SentenceBuildResult> => {
  const tasks = buildTasks(req);

  if (config.useMockLLM) {
    handlerLog('sentence', 'building mock payload', {
      requestId: req.request_id,
      sentenceId: req.payload.sentence_id,
      promptVersion: PROMPT_VERSION,
      mock: true,
    });
    return { data: await buildMockSentenceData(req) };
  }

  handlerLog('sentence', 'building LLM payload', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: PROMPT_VERSION,
    tasks,
  });
  const prompt = await buildPrompt(req);
  handlerLog('sentence', 'LLM prompt prepared', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: PROMPT_VERSION,
    tasks,
    promptLength: prompt.length,
    prompt,
    mock: false,
  });
  const { object, usage } = await llmJson(prompt, coerceSentenceResponse);
  handlerLog('sentence', 'LLM response received', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    model: usage?.modelId,
    tokensIn: usage?.inputTokens,
    tokensOut: usage?.outputTokens,
    promptVersion: PROMPT_VERSION,
  });
  const data = mapSentenceResponse(object, req);
  const hasContent =
    (object.semantic_roles?.length ?? 0) > 0 ||
    (object.modal_markers?.length ?? 0) > 0 ||
    (object.dependency_light?.arcs?.length ?? 0) > 0 ||
    Boolean(object.discourse_function);
  if (!hasContent) {
    handlerLog(
      'sentence',
      'LLM payload missing expected fields; using fallbacks',
      { requestId: req.request_id, promptVersion: PROMPT_VERSION },
      'warn',
    );
  }
  return { data, usage };
};

export const handleSentence = async (
  req: RequestEnvelopeSentence,
): Promise<ResponseEnvelopeSentence> => {
  handlerLog('sentence', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
    promptVersion: PROMPT_VERSION,
  });
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSentence>(cacheKey);
  if (cached) {
    handlerLog('sentence', 'cache hit', {
      requestId: req.request_id,
      cacheKey,
      promptVersion: PROMPT_VERSION,
    });
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const { data, usage } = await buildSentenceData(req);
  handlerLog('sentence', 'data prepared', {
    requestId: req.request_id,
    source: config.useMockLLM ? 'mock' : 'llm',
    promptVersion: PROMPT_VERSION,
    roles: data.semantic_roles?.length ?? 0,
    modalMarkers: data.modal_markers?.length ?? 0,
  });
  const response: ResponseEnvelopeSentence = {
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

  cache.set(cacheKey, response, config.cacheTtlMs);
  handlerLog('sentence', 'response cached', {
    requestId: req.request_id,
    latencyMs: Date.now() - started,
    cacheKey,
    promptVersion: PROMPT_VERSION,
  });
  return response;
};

export { buildPrompt as buildSentencePrompt, buildTasks as buildSentenceTasks };

const coerceSentenceResponse = (value: unknown): LLMSentenceResponse => {
  if (!isRecord(value)) return {};
  return {
    semantic_roles: Array.isArray(value.semantic_roles)
      ? value.semantic_roles
          .map(coerceRole)
          .filter((role): role is LLMSentenceRole => role !== null)
      : undefined,
    discourse_function: asLowercaseString(value.discourse_function),
    dependency_light: isRecord(value.dependency_light)
      ? coerceDependencyLight(value.dependency_light)
      : undefined,
    modal_markers: Array.isArray(value.modal_markers)
      ? value.modal_markers
          .map(coerceModalMarker)
          .filter((marker): marker is LLMSentenceModalMarker => marker !== null)
      : undefined,
    anchors: Array.isArray(value.anchors)
      ? coerceAnchorArray(value.anchors)
      : undefined,
    confidence: asConfidence(value.confidence),
  };
};

const mapSentenceResponse = (
  payload: LLMSentenceResponse,
  req: RequestEnvelopeSentence,
): AnalyzeSentenceData => {
  const text = req.payload.sentence_text;
  const sentenceId = req.payload.sentence_id;
  const tasks = new Set<SentenceTask>(buildTasks(req));

  const shouldInclude = (task: SentenceTask): boolean =>
    req.payload.options?.tasks ? tasks.has(task) : true;

  const anchorIndex = new Map<string, Anchor>();
  const baseAnchor =
    text.length > 0
      ? makeAnchor({
          sentenceId,
          span: { start: 0, end: text.length },
          text,
        })
      : null;

  if (baseAnchor) {
    anchorIndex.set(baseAnchor.anchor_hash, baseAnchor);
  }

  const collectAnchors = (rawAnchors: LLMSentenceAnchor[] | undefined, fallback = false): Anchor[] => {
    const anchors: Anchor[] = [];
    const seen = new Set<string>();

    if (rawAnchors) {
      for (const raw of rawAnchors) {
        const anchor = anchorFromSpan(raw, text, sentenceId);
        if (anchor && !seen.has(anchor.anchor_hash)) {
          anchors.push(anchor);
          seen.add(anchor.anchor_hash);
          anchorIndex.set(anchor.anchor_hash, anchor);
        }
      }
    }

    if (!anchors.length && fallback && baseAnchor) {
      anchors.push(baseAnchor);
    }

    return anchors;
  };

  const semanticRoles = shouldInclude('semantic_roles') && payload.semantic_roles
    ? (() => {
        const roles: SentenceRole[] = [];
        for (const role of payload.semantic_roles) {
          if (!role.role) continue;
          const span = role.span ? normalizeSpan(role.span.start, role.span.end, text.length) : null;
          const anchors = collectAnchors(role.anchors, true);
          roles.push({
            role: normalizeRoleLabel(role.role),
            span: span ?? undefined,
            anchors: anchors.length ? anchors : undefined,
            confidence: role.confidence,
          });
        }
        return roles.length ? roles : undefined;
      })()
    : undefined;

  const discourseFunction = shouldInclude('discourse_function')
    ? payload.discourse_function
    : undefined;

  const dependencyLight = shouldInclude('dependency_light') && payload.dependency_light
    ? mapDependencyLight(payload.dependency_light)
    : undefined;

  const modalMarkers = shouldInclude('modal_markers') && payload.modal_markers
    ? (() => {
        const markers: ModalMarker[] = [];
        const seen = new Set<string>();
        for (const marker of payload.modal_markers) {
          if (!marker.type || !marker.cue) continue;
          const span = marker.span ? normalizeSpan(marker.span.start, marker.span.end, text.length) : null;
          if (!span) continue;
          const normalizedType = normalizeModalType(marker.type);
          const key = `${normalizedType}:${span.start}:${span.end}:${marker.cue.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          markers.push({
            type: normalizedType,
            cue: marker.cue,
            span,
          });
          const anchor = makeAnchor({
            sentenceId,
            span,
            text: text.slice(span.start, span.end),
          });
          anchorIndex.set(anchor.anchor_hash, anchor);
        }
        return markers.length ? markers : undefined;
      })()
    : undefined;

  if (payload.anchors) {
    collectAnchors(payload.anchors, true);
  }

  const anchorList = anchorIndex.size ? sortAnchors(Array.from(anchorIndex.values())) : undefined;

  return {
    semantic_roles: semanticRoles,
    discourse_function: discourseFunction ?? undefined,
    dependency_light: dependencyLight,
    modal_markers: modalMarkers,
    anchors: anchorList,
    confidence: payload.confidence,
  };
};

const mapDependencyLight = (raw: LLMSentenceDependencyLight): DependencyLight | undefined => {
  const arcs = raw.arcs?.map((arc) => {
    const head = typeof arc.head === 'number' && Number.isFinite(arc.head) ? Math.trunc(arc.head) : null;
    const dep = typeof arc.dep === 'number' && Number.isFinite(arc.dep) ? Math.trunc(arc.dep) : null;
    const label = asString(arc.label);
    if (head === null || dep === null || !label) return null;
    if (head === dep) return null;
    return { head, dep, label: label.toLowerCase() } satisfies DependencyArc;
  }).filter((arc): arc is DependencyArc => arc !== null);

  if (!arcs || arcs.length === 0) {
    if (!raw.head_indexed) return undefined;
    return { head_indexed: !!raw.head_indexed };
  }

  const deduped = new Map<string, DependencyArc>();
  for (const arc of arcs) {
    const key = `${arc.head}:${arc.dep}:${arc.label}`;
    if (!deduped.has(key)) {
      deduped.set(key, arc);
    }
  }

  return {
    head_indexed: raw.head_indexed ?? true,
    arcs: Array.from(deduped.values()).sort((a, b) => {
      if (a.head !== b.head) return a.head - b.head;
      if (a.dep !== b.dep) return a.dep - b.dep;
      return a.label.localeCompare(b.label);
    }),
  };
};

const anchorFromSpan = (
  anchor: LLMSentenceAnchor,
  sentenceText: string,
  sentenceId: string,
): Anchor | null => {
  const span = normalizeSpan(anchor.start, anchor.end, sentenceText.length);
  if (!span) return null;
  const snippet = sentenceText.slice(span.start, span.end);
  if (!snippet) return null;

  return makeAnchor({
    sentenceId,
    span,
    text: snippet,
  });
};

const normalizeSpan = (start: number, end: number, maxLength: number) => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  let s = Math.floor(start);
  let e = Math.floor(end);
  if (e < s) {
    const tmp = s;
    s = e;
    e = tmp;
  }
  s = Math.max(0, Math.min(s, maxLength));
  e = Math.max(0, Math.min(e, maxLength));
  if (e <= s) return null;
  return { start: s, end: e };
};

const coerceRole = (value: unknown): LLMSentenceRole | null => {
  if (!isRecord(value)) return null;
  return {
    role: asString(value.role),
    span: coerceSpan(value.span),
    anchors: coerceAnchorArray(value.anchors),
    confidence: asConfidence(value.confidence),
  };
};

const coerceModalMarker = (value: unknown): LLMSentenceModalMarker | null => {
  if (!isRecord(value)) return null;
  const type = asString(value.type);
  const cue = asString(value.cue);
  const span = coerceSpan(value.span);
  if (!type || !cue || !span) return null;
  return {
    type: normalizeModalType(type),
    cue,
    span,
  };
};

const coerceDependencyLight = (value: Record<string, unknown>): LLMSentenceDependencyLight => {
  const headIndexed = typeof value.head_indexed === 'boolean' ? value.head_indexed : undefined;
  const arcs = Array.isArray(value.arcs)
    ? value.arcs
        .map((arc): LLMSentenceDependencyArc | null => {
          if (!isRecord(arc)) return null;
          const head = asNumber(arc.head);
          const dep = asNumber(arc.dep);
          const label = asString(arc.label);
          if (typeof head !== 'number' || typeof dep !== 'number' || !label) {
            return null;
          }
          return { head, dep, label };
        })
        .filter((arc): arc is LLMSentenceDependencyArc => arc !== null)
    : undefined;
  return {
    head_indexed: headIndexed,
    arcs,
  };
};

const coerceSpan = (value: unknown): LLMSentenceSpan | undefined => {
  if (!isRecord(value)) return undefined;
  const start = asNumber(value.start);
  const end = asNumber(value.end);
  if (typeof start !== 'number' || typeof end !== 'number') return undefined;
  if (end <= start) return undefined;
  return { start, end };
};

const coerceAnchor = (value: unknown): LLMSentenceAnchor | null => {
  const span = coerceSpan(value);
  if (!span) return null;
  const sentenceId =
    isRecord(value) && typeof value.sentence_id === 'string'
      ? value.sentence_id
      : undefined;
  return { ...span, sentence_id: sentenceId };
};

const coerceAnchorArray = (value: unknown): LLMSentenceAnchor[] => {
  if (!Array.isArray(value)) return [];
  const anchors: LLMSentenceAnchor[] = [];
  for (const item of value) {
    const anchor = coerceAnchor(item);
    if (anchor) anchors.push(anchor);
  }
  return anchors;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asLowercaseString = (value: unknown): string | undefined => {
  const str = asString(value);
  return str ? str.toLowerCase() : undefined;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asConfidence = (value: unknown): number | undefined => {
  const num = asNumber(value);
  if (typeof num !== 'number') return undefined;
  if (num < 0 || num > 1) return undefined;
  return num;
};
