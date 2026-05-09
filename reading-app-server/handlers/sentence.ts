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
} from '../../packages/contracts/src';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { createLLMClient, extractJsonFromText, type LLMUsage, type CallReturn } from '../services/llmService';
import { buildStableCacheKey, makeAnchor, sortAnchors, withBufferedStream } from './shared';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'sentence';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'sentence.v5';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'sentence.txt');
const TASK_ORDER: readonly SentenceTask[] = ['semantic_roles', 'key_words', 'discourse_function', 'dependency_light', 'modal_markers'];

export type SentenceTask = 'semantic_roles' | 'key_words' | 'discourse_function' | 'dependency_light' | 'modal_markers';
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
  key_phrase?: string | string[];
  function?: string;
  type?: string;
  mood?: string;
  purpose?: string;
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

/**
 * Normalizes a role label using aliases if available.
 *
 * @param value - The raw role label.
 * @returns The canonical role label.
 */
const normalizeRoleLabel = (value: string): string => {
  const key = value.trim().toLowerCase();
  const candidate = ROLE_ALIAS[key] ?? key;
  return candidate || 'unknown';
};

/**
 * Maps a modal verb or cue to its canonical modal type.
 *
 * @param value - The raw modal cue or type string.
 * @returns The canonical ModalMarker type.
 */
const normalizeModalType = (value: string): ModalMarker['type'] => {
  const key = value.trim().toLowerCase();
  return MODAL_TYPE_CANONICAL[key] ?? (key || 'unknown');
};

/**
 * Builds a cache key for sentence analysis requests.
 *
 * @param req - The request envelope.
 * @returns A stable cache key string.
 */
const buildCacheKey = (req: RequestEnvelopeSentence): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.model,
  });
};

let cachedSentenceSystemPrompt: string | null = null;

/**
 * Loads the sentence analysis prompt from the filesystem, with caching.
 *
 * @returns The prompt text.
 */
const loadSentenceSystemPrompt = async (): Promise<string> => {
  if (cachedSentenceSystemPrompt) return cachedSentenceSystemPrompt;
  cachedSentenceSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
  return cachedSentenceSystemPrompt;
};

/**
 * Determines and orders the analysis tasks to be performed.
 *
 * @param req - The request envelope containing optional task preferences.
 * @returns An ordered array of tasks.
 */
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

/**
 * Formats contextual information (hierarchy, neighbors, entities) into a string for the LLM prompt.
 *
 * @param req - The request envelope.
 * @returns A formatted context string or null if no context is available.
 */
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

/**
 * Builds the full LLM prompt for sentence analysis.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the prompt string.
 */
const buildPrompt = (req: RequestEnvelopeSentence): string => {
  const tasks = buildTasks(req);

  const sections: string[] = [
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

/**
 * Orchestrates the data collection for sentence analysis.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the LLM call return (stream and usage).
 */
const buildSentenceData = async (
  req: RequestEnvelopeSentence,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  const tasks = buildTasks(req);

  handlerLog('sentence', 'building LLM payload', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: PROMPT_VERSION,
    tasks,
  });
  const [systemPrompt, userPrompt] = await Promise.all([
    loadSentenceSystemPrompt(),
    Promise.resolve(buildPrompt(req)),
  ]);
  const llmClient = createLLMClient({ systemPrompt });
  handlerLog('sentence', 'LLM prompt prepared', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: PROMPT_VERSION,
    tasks,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    prompt: userPrompt,
  });
  return llmClient.json(userPrompt, { signal });
};

/**
 * The main handler for sentence analysis requests.
 * Handles caching, LLM interaction, and result mapping.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the streaming response.
 */
export const handleSentence = async (
  req: RequestEnvelopeSentence,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('sentence', 'request received', {
    requestId: req.request_id,
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
  const { data: stream, usage: usagePromise } = await buildSentenceData(req, signal);

  const tappedStream = withBufferedStream(stream, async ({ text, completed }) => {
    if (!completed) return;

    try {
      const usage = await usagePromise;
      const object = coerceSentenceResponse(extractJsonFromText(text));
      const data: AnalyzeSentenceData = mapSentenceResponse(object, req);

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
  });

  return { data: tappedStream, usage: usagePromise };
};

export { buildPrompt as buildSentencePrompt, buildTasks as buildSentenceTasks };

/**
 * Coerces the raw LLM JSON response into a typed LLMSentenceResponse object.
 *
 * @param value - The raw JSON payload.
 * @returns A typed object with potential defaults.
 */
const coerceSentenceResponse = (value: unknown): LLMSentenceResponse => {
  if (!isRecord(value)) return {};
  return {
    semantic_roles: Array.isArray(value.semantic_roles)
      ? value.semantic_roles
        .map(coerceRole)
        .filter((role): role is LLMSentenceRole => role !== null)
      : undefined,
    key_phrase: value.key_phrase as (string | string[]),
    function: asString(value.function),
    type: asString(value.type),
    mood: asString(value.mood),
    purpose: asString(value.purpose),
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

/**
 * Maps the coerced LLM response into the final AnalyzeSentenceData structure.
 *
 * @param payload - The typed LLM response payload.
 * @param req - The original request envelope.
 * @returns The final sanitized analysis data.
 */
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

  const keyWords = shouldInclude('key_words') && payload.key_phrase
    ? (() => {
      const words: Array<{ word: string; color: 'red' | 'green' }> = [];
      // Support both string (legacy/single) and array
      const raw = payload.key_phrase;
      const candidates = Array.isArray(raw) ? raw : [raw];

      for (const phrase of candidates) {
        if (!phrase || typeof phrase !== 'string') continue;
        words.push({ word: phrase, color: 'green' });
        const span = findSpan(text, phrase);
        if (span) {
          const anchor = makeAnchor({ sentenceId, span, text: phrase });
          anchorIndex.set(anchor.anchor_hash, anchor);
        }
      }
      return words.length ? words : undefined;
    })()
    : undefined;

  // Map 'discourse_function' task to the new classification fields
  const classification = shouldInclude('discourse_function') ? {
    discourse_function: payload.function,
    function: payload.function,
    type: payload.type,
    mood: payload.mood,
    purpose: payload.purpose,
  } : {};

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
    key_words: keyWords,
    ...classification,
    dependency_light: dependencyLight,
    modal_markers: modalMarkers,
    anchors: anchorList,
    confidence: payload.confidence,
  };
};

/**
 * Maps and validates the dependency arcs into the internal model.
 *
 * @param raw - The raw dependency light data from the LLM.
 * @returns The sanitized DependencyLight object or undefined.
 */
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

/**
 * Helper to find the start and end offsets of a substring within a text.
 *
 * @param text - The full text to search.
 * @param substring - The substring to find.
 * @returns An object with start and end offsets, or null if not found.
 */
const findSpan = (text: string, substring: string) => {
  const start = text.indexOf(substring);
  if (start === -1) return null;
  return { start, end: start + substring.length };
};

/** Coerces a raw role object. */
const coerceRole = (value: unknown): LLMSentenceRole | null => {
  if (!isRecord(value)) return null;
  return {
    role: asString(value.role),
    text: asString(value.text),
    confidence: asConfidence(value.confidence),
  };
};

/** Coerces a raw modal marker object. */
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

/** Coerces a raw dependency light object. */
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

/** Checks if a value is a plain object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Casts unknown to trimmed string or undefined. */
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Casts unknown to lowercase trimmed string or undefined. */
const asLowercaseString = (value: unknown): string | undefined => {
  const str = asString(value);
  return str ? str.toLowerCase() : undefined;
};

/** Casts unknown to finite number or undefined. */
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Validates and returns a number between 0 and 1. */
const asConfidence = (value: unknown): number | undefined => {
  const num = asNumber(value);
  if (typeof num !== 'number') return undefined;
  if (num < 0 || num > 1) return undefined;
  return num;
};
