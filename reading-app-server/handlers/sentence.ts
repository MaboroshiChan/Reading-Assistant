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
import { json as llmJson, extractJsonFromText, type LLMUsage, type CallReturn } from '../services/llmService';
import { buildStableCacheKey, makeAnchor, sortAnchors } from './shared';
import { buildMockSentenceData } from './mock/sentenceMock';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'sentence';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'sentence.v2';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'sentence.txt');
const TASK_ORDER: readonly SentenceTask[] = ['semantic_roles', 'discourse_function', 'dependency_light', 'modal_markers'];

export type SentenceTask = 'semantic_roles' | 'discourse_function' | 'dependency_light' | 'modal_markers';
export { PROMPT_VERSION as SENTENCE_PROMPT_VERSION };

interface LLMSentenceRole {
  role?: string;
  text?: string;
  confidence?: number;
}

interface LLMSentenceModalMarker {
  type?: string;
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
  confidence?: number;
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
): Promise<CallReturn<string>> => {
  const tasks = buildTasks(req);

  if (config.useMockLLM) {
    handlerLog('sentence', 'building mock payload', {
      requestId: req.request_id,
      sentenceId: req.payload.sentence_id,
      promptVersion: PROMPT_VERSION,
      mock: true,
    });
    const mockData = await buildMockSentenceData(req);
    const text = JSON.stringify(mockData);
    const stream = (async function* () {
      yield text;
    })();
    return {
      data: stream,
      usage: Promise.resolve({
        modelId: `mock:${config.model}`,
        inputTokens: 0,
        outputTokens: 0,
      }),
    };
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
  return llmJson(prompt);
};

export const handleSentence = async (
  req: RequestEnvelopeSentence,
): Promise<CallReturn<string>> => {
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
  const { data: stream, usage: usagePromise } = await buildSentenceData(req);

  const tappedStream = (async function* () {
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      yield chunk;
    }

    // Background processing: parse, map, and cache
    try {
      const usage = await usagePromise;
      let data: AnalyzeSentenceData;
      if (config.useMockLLM) {
        data = JSON.parse(text) as AnalyzeSentenceData;
      } else {
        const object = coerceSentenceResponse(extractJsonFromText(text));
        data = mapSentenceResponse(object, req);
      }

      const response: ResponseEnvelopeSentence = {
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
      cache.set(cacheKey, response, config.cacheTtlMs);
    } catch (error) {
      console.warn('[sentence] failed to cache response', error);
    }
  })();

  return { data: tappedStream, usage: usagePromise };
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

  const semanticRoles = shouldInclude('semantic_roles') && payload.semantic_roles
    ? (() => {
        const roles: SentenceRole[] = [];
        for (const role of payload.semantic_roles) {
          if (!role.role || !role.text) continue;
          const span = findSpan(text, role.text);
          const anchors = span ? [makeAnchor({ sentenceId, span, text: role.text })] : undefined;

          if (anchors) {
            for (const a of anchors) anchorIndex.set(a.anchor_hash, a);
          }

          roles.push({
            role: normalizeRoleLabel(role.role),
            span: span ?? undefined,
            anchors,
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
          const span = findSpan(text, marker.cue);
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

const findSpan = (text: string, substring: string) => {
  const start = text.indexOf(substring);
  if (start === -1) return null;
  return { start, end: start + substring.length };
};

const coerceRole = (value: unknown): LLMSentenceRole | null => {
  if (!isRecord(value)) return null;
  return {
    role: asString(value.role),
    text: asString(value.text),
    confidence: asConfidence(value.confidence),
  };
};

const coerceModalMarker = (value: unknown): LLMSentenceModalMarker | null => {
  if (!isRecord(value)) return null;
  const type = asString(value.type);
  const cue = asString(value.cue);
  if (!type || !cue) return null;
  return {
    type: normalizeModalType(type),
    cue,
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
