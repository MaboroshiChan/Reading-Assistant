import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AnalyzeParagraphData,
  Anchor,
  RequestEnvelopeParagraph,
  ResponseEnvelopeParagraph,
} from '../../reading-app/src/services/envelopes';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { json as llmJson, extractJsonFromText, type LLMUsage, type CallReturn } from '../services/llmService';
import {
  buildStableCacheKey,
  makeAnchor,
  sortAnchors,
  summarize,
} from './shared';
import { buildMockParagraphData } from './mock/paragraphMock';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'paragraph';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'paragraph.v1';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'paragraph.txt');
const TASK_ORDER: readonly ParagraphTask[] = ['summary', 'roles', 'rhetoric', 'claims'];

export type ParagraphTask = 'roles' | 'rhetoric' | 'claims' | 'summary';
export { PROMPT_VERSION as PARAGRAPH_PROMPT_VERSION };

interface LLMParagraphAnchor {
  start: number;
  end: number;
  sentence_id?: string;
}

interface LLMParagraphRole {
  role: string;
  anchors: LLMParagraphAnchor[];
  confidence?: number;
}

interface LLMParagraphRhetoric {
  label: string;
  evidence_anchors: LLMParagraphAnchor[];
  confidence?: number;
}

interface LLMParagraphClaim {
  text: string;
  polarity?: 'pos' | 'neg' | 'nu';
  support?: 'strong' | 'weak' | 'unspecified';
  anchors: LLMParagraphAnchor[];
  entity_links?: string[];
}

interface LLMParagraphResponse {
  summary?: string;
  roles?: LLMParagraphRole[];
  rhetoric?: LLMParagraphRhetoric[];
  claims?: LLMParagraphClaim[];
  anchors?: LLMParagraphAnchor[];
  confidence?: number;
}

const buildCacheKey = (req: RequestEnvelopeParagraph): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.useMockLLM ? `mock:${config.model}` : config.model,
  });
};

let cachedParagraphPrompt: string | null = null;

const loadParagraphPrompt = async (): Promise<string> => {
  if (cachedParagraphPrompt) return cachedParagraphPrompt;
  cachedParagraphPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedParagraphPrompt;
};

const buildTasks = (req: RequestEnvelopeParagraph): ParagraphTask[] => {
  const requested = req.payload.options?.tasks ?? TASK_ORDER;
  const normalized = new Set<ParagraphTask>();
  for (const rawTask of requested) {
    if (!TASK_ORDER.includes(rawTask as ParagraphTask)) continue;
    normalized.add(rawTask as ParagraphTask);
  }
  const ordered = TASK_ORDER.filter((task) => normalized.size === 0 || normalized.has(task));
  return ordered.length ? ordered : [...TASK_ORDER];
};

const formatContext = (req: RequestEnvelopeParagraph): string | null => {
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
      .slice(0, 8)
      .map((entity) => `${entity.id} [${entity.type}]: ${entity.canonical}`);
    lines.push('Known entities:');
    lines.push(...entityLines);
  }

  if (!lines.length) return null;
  return lines.join('\n');
};

const buildPrompt = async (req: RequestEnvelopeParagraph): Promise<string> => {
  const basePrompt = (await loadParagraphPrompt()).trim();
  const tasks = buildTasks(req);
  const sections: string[] = [
    basePrompt,
    '',
    `Document ID: ${req.payload.doc_id}`,
    `Paragraph ID: ${req.payload.paragraph_id}`,
    `Prompt Version: ${PROMPT_VERSION}`,
    `Requested tasks: ${tasks.join(', ')}`,
    '',
    'Paragraph text (0-based offsets):',
    '```text',
    req.payload.paragraph_text,
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

const buildParagraphData = async (
  req: RequestEnvelopeParagraph,
): Promise<CallReturn<string>> => {
  const tasks = buildTasks(req);

  if (config.useMockLLM) {
    handlerLog('paragraph', 'building mock payload', {
      requestId: req.request_id,
      paragraphId: req.payload.paragraph_id,
      promptVersion: PROMPT_VERSION,
      mock: true,
    });
    const mockData = await buildMockParagraphData(req);
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

  handlerLog('paragraph', 'building LLM prompt', {
    requestId: req.request_id,
    tasks,
    promptVersion: PROMPT_VERSION,
  });
  const prompt = await buildPrompt(req);
  handlerLog('paragraph', 'LLM prompt prepared', {
    requestId: req.request_id,
    paragraphId: req.payload.paragraph_id,
    promptVersion: PROMPT_VERSION,
    tasks,
    promptLength: prompt.length,
    prompt,
    mock: false,
  });
  return llmJson(prompt);
};

export const handleParagraph = async (
  req: RequestEnvelopeParagraph,
): Promise<CallReturn<string>> => {
  handlerLog('paragraph', 'request received', {
    requestId: req.request_id,
    paragraphId: req.payload.paragraph_id,
    mock: config.useMockLLM,
    promptVersion: PROMPT_VERSION,
  });
  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeParagraph>(cacheKey);
  if (cached) {
    handlerLog('paragraph', 'cache hit', {
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
      let data: AnalyzeParagraphData;
      if (config.useMockLLM) {
        data = JSON.parse(text) as AnalyzeParagraphData;
      } else {
        const object = coerceParagraphResponse(extractJsonFromText(text));
        data = mapParagraphResponse(object, req);
      }

      const response: ResponseEnvelopeParagraph = {
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
      console.warn('[paragraph] failed to cache response', error);
    }
  })();

  return { data: tappedStream, usage: usagePromise };
};

export { buildPrompt as buildParagraphPrompt, buildTasks as buildParagraphTasks };

const coerceParagraphResponse = (value: unknown): LLMParagraphResponse => {
  if (!isRecord(value)) return {};
  return {
    summary: asString(value.summary),
    roles: Array.isArray(value.roles)
      ? value.roles
          .map(coerceRole)
          .filter((role): role is LLMParagraphRole => role !== null)
      : undefined,
    rhetoric: Array.isArray(value.rhetoric)
      ? value.rhetoric
          .map(coerceRhetoric)
          .filter((item): item is LLMParagraphRhetoric => item !== null)
      : undefined,
    claims: Array.isArray(value.claims)
      ? value.claims
          .map(coerceClaim)
          .filter((item): item is LLMParagraphClaim => item !== null)
      : undefined,
    anchors: Array.isArray(value.anchors)
      ? coerceAnchorArray(value.anchors)
      : undefined,
    confidence: asConfidence(value.confidence),
  };
};

const mapParagraphResponse = (
  payload: LLMParagraphResponse,
  req: RequestEnvelopeParagraph,
): AnalyzeParagraphData => {
  const text = req.payload.paragraph_text;
  const paragraphId = req.payload.paragraph_id;
  const tasks = new Set<ParagraphTask>(buildTasks(req));

  const shouldInclude = (task: ParagraphTask): boolean =>
    req.payload.options?.tasks ? tasks.has(task) : true;

  const anchorIndex = new Map<string, Anchor>();
  const baseAnchor =
    text.length > 0
      ? makeAnchor({
          paragraphId,
          span: { start: 0, end: text.length },
          text,
        })
      : null;

  if (baseAnchor) {
    anchorIndex.set(baseAnchor.anchor_hash, baseAnchor);
  }

  const collectAnchors = (
    rawAnchors: LLMParagraphAnchor[] | undefined,
    fallbackToParagraph = false,
  ): Anchor[] => {
    const anchors: Anchor[] = [];
    const seen = new Set<string>();

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
            if (!role.role) return null;
            return {
              role: role.role,
              anchors,
              confidence: role.confidence,
            };
          })
          .filter((role): role is { role: string; anchors: Anchor[]; confidence: number | undefined } => role !== null)
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
            if (!label) return null;
            return {
              label,
              evidence_anchors: collectAnchors(item.evidence_anchors),
              confidence: item.confidence,
            };
          })
          .filter(
            (entry): entry is {
              label: string;
              evidence_anchors: Anchor[];
              confidence: number | undefined;
            } => entry !== null,
          )
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
            if (!textValue) return null;
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
          .filter(
            (entry): entry is {
              text: string;
              polarity: 'pos' | 'neg' | 'nu';
              support: 'strong' | 'weak' | 'unspecified';
              anchors: Anchor[];
              entity_links: string[] | undefined;
            } => entry !== null,
          );
        return items.length ? items : undefined;
      })()
    : undefined;

  if (payload.anchors) {
    collectAnchors(payload.anchors);
  }

  const summary = shouldInclude('summary')
    ? payload.summary ?? summarize(text)
    : undefined;

  const anchorList = anchorIndex.size ? sortAnchors(Array.from(anchorIndex.values())) : undefined;

  return {
    summary,
    roles,
    rhetoric,
    claims,
    anchors: anchorList,
    confidence: payload.confidence,
  };
};

const anchorFromSpan = (
  anchor: LLMParagraphAnchor,
  paragraphText: string,
  paragraphId: string,
): Anchor | null => {
  const span = normalizeSpan(anchor.start, anchor.end, paragraphText.length);
  if (!span) return null;

  const snippet = paragraphText.slice(span.start, span.end);
  if (!snippet) return null;

  return makeAnchor({
    paragraphId,
    sentenceId: anchor.sentence_id,
    span,
    text: snippet,
  });
};

const normalizeSpan = (
  start: number,
  end: number,
  maxLength: number,
) => {
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asConfidence = (value: unknown): number | undefined => {
  const num = asNumber(value);
  if (typeof num !== 'number') return undefined;
  if (num < 0 || num > 1) return undefined;
  return num;
};

const coerceAnchor = (value: unknown): LLMParagraphAnchor | null => {
  if (!isRecord(value)) return null;
  const start = asNumber(value.start);
  const end = asNumber(value.end);
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (end <= start) return null;
  const sentenceId = asString(value.sentence_id);
  return { start, end, sentence_id: sentenceId };
};

const coerceAnchorArray = (value: unknown): LLMParagraphAnchor[] => {
  if (!Array.isArray(value)) return [];
  const output: LLMParagraphAnchor[] = [];
  for (const item of value) {
    const anchor = coerceAnchor(item);
    if (anchor) output.push(anchor);
  }
  return output;
};

const coerceRole = (value: unknown): LLMParagraphRole | null => {
  if (!isRecord(value)) return null;
  const role = asString(value.role);
  if (!role) return null;
  return {
    role,
    anchors: coerceAnchorArray(value.anchors),
    confidence: asConfidence(value.confidence),
  };
};

const coerceRhetoric = (value: unknown): LLMParagraphRhetoric | null => {
  if (!isRecord(value)) return null;
  const label = asString(value.label);
  if (!label) return null;
  return {
    label,
    evidence_anchors: coerceAnchorArray(value.evidence_anchors),
    confidence: asConfidence(value.confidence),
  };
};

const coerceClaim = (value: unknown): LLMParagraphClaim | null => {
  if (!isRecord(value)) return null;
  const text = asString(value.text);
  if (!text) return null;
  return {
    text,
    polarity: normalizePolarity(value.polarity),
    support: normalizeSupport(value.support),
    anchors: coerceAnchorArray(value.anchors),
    entity_links: Array.isArray(value.entity_links)
      ? value.entity_links
          .map(asString)
          .filter((id): id is string => typeof id === 'string')
      : undefined,
  };
};

const normalizePolarity = (value: unknown): 'pos' | 'neg' | 'nu' => {
  const str = asString(value);
  if (str === 'pos' || str === 'neg' || str === 'nu') return str;
  return 'nu';
};

const normalizeSupport = (value: unknown): 'strong' | 'weak' | 'unspecified' => {
  const str = asString(value);
  if (str === 'strong' || str === 'weak' || str === 'unspecified') return str;
  return 'unspecified';
};
