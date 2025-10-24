import path from 'path';
import { promises as fs } from 'fs';
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
import { hashString, makeAnchor } from './shared';
import { buildMockSentenceData } from './mock/sentenceMock';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'sentence';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'sentence.txt');
const DEFAULT_TASKS: SentenceTask[] = ['semantic_roles', 'discourse_function', 'dependency_light', 'modal_markers'];

type SentenceTask = 'semantic_roles' | 'discourse_function' | 'dependency_light' | 'modal_markers';

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

const buildCacheKey = (req: RequestEnvelopeSentence): string => {
  const payloadKey = hashString(JSON.stringify(req.payload));
  const contextKey = hashString(JSON.stringify(req.context ?? {}));
  return `${CACHE_PREFIX}:${payloadKey}:${contextKey}`;
};

let cachedSentencePrompt: string | null = null;

const loadSentencePrompt = async (): Promise<string> => {
  if (cachedSentencePrompt) return cachedSentencePrompt;
  cachedSentencePrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedSentencePrompt;
};

const buildTasks = (req: RequestEnvelopeSentence): SentenceTask[] => {
  return (req.payload.options?.tasks?.length
    ? req.payload.options.tasks
    : DEFAULT_TASKS) as SentenceTask[];
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
  if (config.useMockLLM) {
    handlerLog('sentence', 'building mock payload', {
      requestId: req.request_id,
      sentenceId: req.payload.sentence_id,
    });
    return { data: buildMockSentenceData(req) };
  }

  handlerLog('sentence', 'building LLM payload', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
  });
  const prompt = await buildPrompt(req);
  const { object, usage } = await llmJson(prompt, coerceSentenceResponse);
  const data = mapSentenceResponse(object, req);
  return { data, usage };
};

export const handleSentence = async (
  req: RequestEnvelopeSentence,
): Promise<ResponseEnvelopeSentence> => {
  handlerLog('sentence', 'request received', {
    requestId: req.request_id,
    mock: config.useMockLLM,
  });
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeSentence>(cacheKey);
  if (cached) {
    handlerLog('sentence', 'cache hit', { requestId: req.request_id });
    return { ...cached, served_from: 'cache' };
  }

  const started = Date.now();
  const { data, usage } = await buildSentenceData(req);
  handlerLog('sentence', 'data prepared', {
    requestId: req.request_id,
    source: config.useMockLLM ? 'mock' : 'llm',
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
  });
  return response;
};

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
            role: role.role,
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
        for (const marker of payload.modal_markers) {
          if (!marker.type || !marker.cue) continue;
          const span = marker.span ? normalizeSpan(marker.span.start, marker.span.end, text.length) : null;
          if (!span) continue;
          markers.push({
            type: marker.type as ModalMarker['type'],
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

  const anchorList = anchorIndex.size ? Array.from(anchorIndex.values()) : undefined;

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
    return { head, dep, label } satisfies DependencyArc;
  }).filter((arc): arc is DependencyArc => arc !== null);

  if (!arcs || arcs.length === 0) {
    if (!raw.head_indexed) return undefined;
    return { head_indexed: !!raw.head_indexed };
  }

  return {
    head_indexed: raw.head_indexed ?? true,
    arcs,
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
  let s = Math.round(start);
  let e = Math.round(end);
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
    type,
    cue,
    span,
  };
};

const coerceDependencyLight = (value: Record<string, unknown>): LLMSentenceDependencyLight => {
  const headIndexed = typeof value.head_indexed === 'boolean' ? value.head_indexed : undefined;
  const arcs = Array.isArray(value.arcs)
    ? value.arcs
        .map((arc) => (isRecord(arc) ? {
          head: typeof arc.head === 'number' ? arc.head : undefined,
          dep: typeof arc.dep === 'number' ? arc.dep : undefined,
          label: asString(arc.label),
        } : null))
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
