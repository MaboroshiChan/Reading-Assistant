import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AnalyzeParagraphData,
  Anchor,
  RequestEnvelopeParagraph,
  ResponseEnvelopeParagraph,
} from '../../packages/contracts/src';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { createLLMClient, extractJsonFromText, type LLMUsage, type CallReturn } from '../services/llmService';
import {
  buildStableCacheKey,
  makeAnchor,
  sortAnchors,
  summarize,
  withBufferedStream,
} from './shared';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'paragraph';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'paragraph.v1.1';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'paragraph.txt');
const TASK_ORDER: readonly ParagraphTask[] = ['summary', 'roles', 'rhetoric', 'claims', 'tags'];

export type ParagraphTask = 'roles' | 'rhetoric' | 'claims' | 'summary' | 'tags';
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

interface LLMParagraphSentenceRelation {
  type?: string;
  targetSentenceId?: number;
}

interface LLMParagraphSentence {
  function?: string;
  type?: string;
  mood?: string;
  purpose?: string;
  relation?: LLMParagraphSentenceRelation;
  key_words?: Array<{ word?: string; color?: 'red' | 'green' | string }>;
}

interface LLMParagraphTopicSentence {
  is_implicit?: boolean;
  text?: string;
  id?: string | number;
}

interface LLMParagraphResponse {
  summary?: string;
  roles?: LLMParagraphRole[];
  rhetoric?: LLMParagraphRhetoric[];
  claims?: LLMParagraphClaim[];
  sentences?: LLMParagraphSentence[];
  anchors?: LLMParagraphAnchor[];
  tags?: { name: string; type: 'logic' | 'concept'; description?: string }[];
  topic_sentence?: LLMParagraphTopicSentence;
  confidence?: number;
}

/**
 * Builds a cache key for paragraph analysis requests.
 *
 * @param req - The request envelope.
 * @returns A stable cache key string.
 */
const buildCacheKey = (req: RequestEnvelopeParagraph): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.model,
  });
};

let cachedParagraphSystemPrompt: string | null = null;

/**
 * Loads the paragraph analysis prompt from the filesystem, with caching.
 *
 * @returns The prompt text.
 */
const loadParagraphSystemPrompt = async (): Promise<string> => {
  if (cachedParagraphSystemPrompt) return cachedParagraphSystemPrompt;
  cachedParagraphSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
  return cachedParagraphSystemPrompt;
};

/**
 * Determines and orders the analysis tasks for a paragraph.
 *
 * @param req - The request envelope.
 * @returns An ordered array of tasks.
 */
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

/**
 * Formats paragraph-level context (hierarchy, neighbors, entities) for the prompt.
 *
 * @param req - The request envelope.
 * @returns A formatted context string or null.
 */
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

/**
 * Builds the full LLM prompt for paragraph analysis.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the prompt string.
 */
const buildPrompt = (req: RequestEnvelopeParagraph): string => {
  const tasks = buildTasks(req);
  const sections: string[] = [
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

  sections.push(
    '',
    'Respond with JSON only. Do not wrap the JSON in markdown fences.',
  );

  return sections.join('\n');
};

/**
 * Orchestrates paragraph data collection from the LLM.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the call results.
 */
const buildParagraphData = async (
  req: RequestEnvelopeParagraph,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  const tasks = buildTasks(req);

  handlerLog('paragraph', 'building LLM prompt', {
    requestId: req.request_id,
    tasks,
    promptVersion: PROMPT_VERSION,
  });
  const [systemPrompt, userPrompt] = await Promise.all([
    loadParagraphSystemPrompt(),
    Promise.resolve(buildPrompt(req)),
  ]);
  const llmClient = createLLMClient({ systemPrompt });
  handlerLog('paragraph', 'LLM prompt prepared', {
    requestId: req.request_id,
    paragraphId: req.payload.paragraph_id,
    promptVersion: PROMPT_VERSION,
    tasks,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    prompt: userPrompt,
  });
  return llmClient.json(userPrompt, { signal });
};

/**
 * The main handler for paragraph analysis requests.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to the streaming response.
 */
export const handleParagraph = async (
  req: RequestEnvelopeParagraph,
  signal?: AbortSignal,
): Promise<CallReturn<string>> => {
  handlerLog('paragraph', 'request received', {
    requestId: req.request_id,
    paragraphId: req.payload.paragraph_id,
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
  const { data: stream, usage: usagePromise } = await buildParagraphData(req, signal);

  const tappedStream = withBufferedStream(stream, async ({ text, completed }) => {
    if (!completed) return;

    try {
      const usage = await usagePromise;
      const object = coerceParagraphResponse(extractJsonFromText(text));
      const data: AnalyzeParagraphData = mapParagraphResponse(object, req);

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
  });

  return { data: tappedStream, usage: usagePromise };
};

export { buildPrompt as buildParagraphPrompt, buildTasks as buildParagraphTasks };

/**
 * Coerces the raw LLM JSON response into a typed LLMParagraphResponse object.
 *
 * @param value - The raw JSON payload.
 * @returns A typed object with potential defaults.
 */
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
    sentences: Array.isArray(value.sentences)
      ? value.sentences
        .map(coerceSentence)
        .filter((item): item is LLMParagraphSentence => item !== null)
      : undefined,
    anchors: Array.isArray(value.anchors)
      ? coerceAnchorArray(value.anchors)
      : undefined,
    tags: Array.isArray(value.tags)
      ? value.tags.reduce((acc: { name: string; type: 'logic' | 'concept'; description?: string }[], tag: unknown) => {
        if (!isRecord(tag)) return acc;
        const name = asString(tag.name);
        const type = asString(tag.type) === 'logic' ? 'logic' : 'concept';
        const description = asString(tag.description);
        if (name) {
          acc.push({ name, type, description });
        }
        return acc;
      }, [])
      : undefined,
    topic_sentence: coerceTopicSentence(value.topic_sentence),
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

  const sentences = payload.sentences?.length
    ? payload.sentences
      .map((sentence) => {
        const keyWords = sentence.key_words
          ?.map((item) => {
            const word = asString(item.word);
            const color = item.color === 'green' ? 'green' : item.color === 'red' ? 'red' : undefined;
            if (!word || !color) return null;
            return { word, color };
          })
          .filter((item): item is { word: string; color: 'red' | 'green' } => item !== null);

        const relation = sentence.relation && (
          asString(sentence.relation.type) || typeof sentence.relation.targetSentenceId === 'number'
        )
          ? {
            type: asString(sentence.relation.type),
            targetSentenceId:
              typeof sentence.relation.targetSentenceId === 'number' &&
              Number.isFinite(sentence.relation.targetSentenceId)
                ? Math.trunc(sentence.relation.targetSentenceId)
                : undefined,
          }
          : undefined;

        return {
          function: asString(sentence.function),
          type: asString(sentence.type),
          mood: asString(sentence.mood),
          purpose: asString(sentence.purpose),
          relation,
          key_words: keyWords?.length ? keyWords : undefined,
        };
      })
      .filter((sentence) =>
        sentence.function ||
        sentence.type ||
        sentence.mood ||
        sentence.purpose ||
        sentence.relation ||
        sentence.key_words?.length,
      )
    : undefined;

  const anchorList = anchorIndex.size ? sortAnchors(Array.from(anchorIndex.values())) : undefined;

  return {
    summary,
    roles,
    rhetoric,
    claims,
    sentences: sentences?.length ? sentences : undefined,
    anchors: anchorList,
    tags: shouldInclude('tags') ? payload.tags : undefined,
    confidence: payload.confidence,
    topic_sentence: payload.topic_sentence,
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

/**
 * Validates and normalizes span indices within a maximum length.
 *
 * @param start - The raw start index.
 * @param end - The raw end index.
 * @param maxLength - The maximum allowed length.
 * @returns A validated span object or null.
 */
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

/** Checks if a value is a plain object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Casts unknown to trimmed string or undefined. */
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

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

/** Coerces a raw anchor object. */
const coerceAnchor = (value: unknown): LLMParagraphAnchor | null => {
  if (!isRecord(value)) return null;
  const start = asNumber(value.start);
  const end = asNumber(value.end);
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (end <= start) return null;
  const sentenceId = asString(value.sentence_id);
  return { start, end, sentence_id: sentenceId };
};

/** Coerces an array of raw anchors. */
const coerceAnchorArray = (value: unknown): LLMParagraphAnchor[] => {
  if (!Array.isArray(value)) return [];
  const output: LLMParagraphAnchor[] = [];
  for (const item of value) {
    const anchor = coerceAnchor(item);
    if (anchor) output.push(anchor);
  }
  return output;
};

/** Coerces a raw role object. */
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

/** Coerces a raw rhetoric object. */
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

/** Coerces a raw claim object. */
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

const coerceSentence = (value: unknown): LLMParagraphSentence | null => {
  if (!isRecord(value)) return null;

  const keyWords = Array.isArray(value.key_words)
    ? value.key_words
      .map((item) => {
        if (!isRecord(item)) return null;
        return {
          word: asString(item.word),
          color: asString(item.color),
        };
      })
      .filter((item) => item !== null)
    : undefined;

  const relation = isRecord(value.relation)
    ? {
      type: asString(value.relation.type),
      targetSentenceId:
        typeof value.relation.targetSentenceId === 'number' && Number.isFinite(value.relation.targetSentenceId)
          ? Math.trunc(value.relation.targetSentenceId)
          : undefined,
    }
    : undefined;

  const sentence: LLMParagraphSentence = {
    function: asString(value.function),
    type: asString(value.type),
    mood: asString(value.mood),
    purpose: asString(value.purpose),
    relation,
    key_words: keyWords,
  };

  if (
    !sentence.function &&
    !sentence.type &&
    !sentence.mood &&
    !sentence.purpose &&
    !sentence.relation &&
    !sentence.key_words?.length
  ) {
    return null;
  }

  return sentence;
};

const coerceTopicSentence = (value: unknown): LLMParagraphTopicSentence | undefined => {
  if (!isRecord(value)) return undefined;

  const isImplicit = typeof value.is_implicit === 'boolean' ? value.is_implicit : undefined;
  const text = asString(value.text);
  const id = typeof value.id === 'string' || typeof value.id === 'number' ? value.id : undefined;

  if (isImplicit === undefined && !text && id === undefined) {
    return undefined;
  }

  return {
    is_implicit: isImplicit,
    text,
    id,
  };
};

/** Normalizes polarity values. */
const normalizePolarity = (value: unknown): 'pos' | 'neg' | 'nu' => {
  const str = asString(value);
  if (str === 'pos' || str === 'neg' || str === 'nu') return str;
  return 'nu';
};

/** Normalizes support values. */
const normalizeSupport = (value: unknown): 'strong' | 'weak' | 'unspecified' => {
  const str = asString(value);
  if (str === 'strong' || str === 'weak' || str === 'unspecified') return str;
  return 'unspecified';
};
