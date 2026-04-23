import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AnalyzeKnowledgeExtractionData,
  KnowledgeEntity,
  KnowledgeEvent,
  KnowledgeEvidence,
  KnowledgeIdea,
  KnowledgePerson,
  KnowledgeRelation,
  KnowledgeTheme,
  RequestEnvelopeKnowledgeExtraction,
  ResponseEnvelopeKnowledgeExtraction,
} from '../../packages/contracts/src';
import { config } from '../services/config';
import * as cache from '../services/cache';
import { createLLMClient, extractJsonFromText, type CallReturn } from '../services/llmService';
import { buildStableCacheKey, summarize } from './shared';
import { handlerLog } from './logger';

const CACHE_PREFIX = 'knowledge-extraction';
const CACHE_VERSION = 'v2';
const PROMPT_VERSION = 'knowledge_extraction.v2.0';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'v1', 'knowledge_extraction.txt');

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const sanitizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(asString).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
};

const sanitizeEvidence = (value: unknown): KnowledgeEvidence[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const evidence = value
    .map((item): KnowledgeEvidence | null => {
      if (!isRecord(item)) return null;
      const quote = asString(item.quote);
      if (!quote) return null;
      return { quote };
    })
    .filter((item): item is KnowledgeEvidence => item !== null);
  return evidence.length ? evidence : undefined;
};

const sanitizePeople = (value: unknown): KnowledgePerson[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const people = value
    .map((item, index): KnowledgePerson | null => {
      if (!isRecord(item)) return null;
      const name = asString(item.name);
      if (!name) return null;
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
    .filter((item): item is KnowledgePerson => item !== null);
  return people.length ? people : undefined;
};

const sanitizeIdeas = (value: unknown): KnowledgeIdea[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const ideas = value
    .map((item, index): KnowledgeIdea | null => {
      if (!isRecord(item)) return null;
      const label = asString(item.label);
      if (!label) return null;
      const kind = asString(item.kind);
      return {
        local_id: asString(item.local_id) ?? `i${index + 1}`,
        label,
        description: asString(item.description),
        kind: kind && IDEA_KINDS.has(kind) ? kind : 'claim',
        evidence: sanitizeEvidence(item.evidence),
      };
    })
    .filter((item): item is KnowledgeIdea => item !== null);
  return ideas.length ? ideas : undefined;
};

const sanitizeEvents = (value: unknown): KnowledgeEvent[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const events = value
    .map((item, index): KnowledgeEvent | null => {
      if (!isRecord(item)) return null;
      const label = asString(item.label);
      if (!label) return null;
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
    .filter((item): item is KnowledgeEvent => item !== null);
  return events.length ? events : undefined;
};

const sanitizeEntities = (value: unknown): KnowledgeEntity[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const entities = value
    .map((item, index): KnowledgeEntity | null => {
      if (!isRecord(item)) return null;
      const label = asString(item.label);
      const type = asString(item.type);
      if (!label || !type) return null;
      return {
        local_id: asString(item.local_id) ?? `n${index + 1}`,
        label,
        type: ENTITY_TYPES.has(type) ? type : 'other',
        description: asString(item.description),
        evidence: sanitizeEvidence(item.evidence),
      };
    })
    .filter((item): item is KnowledgeEntity => item !== null);
  return entities.length ? entities : undefined;
};

const sanitizeThemes = (value: unknown): KnowledgeTheme[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const themes = value
    .map((item, index): KnowledgeTheme | null => {
      if (!isRecord(item)) return null;
      const label = asString(item.label);
      if (!label) return null;
      const strength = asNumber(item.strength);
      return {
        local_id: asString(item.local_id) ?? `t${index + 1}`,
        label,
        strength: typeof strength === 'number' ? Math.max(0, Math.min(1, strength)) : undefined,
        description: asString(item.description),
        evidence: sanitizeEvidence(item.evidence),
      };
    })
    .filter((item): item is KnowledgeTheme => item !== null);
  return themes.length ? themes : undefined;
};

const sanitizeRelations = (value: unknown): KnowledgeRelation[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const relations = value
    .map((item, index): KnowledgeRelation | null => {
      if (!isRecord(item)) return null;
      const fromId = asString(item.from_id);
      const fromType = asString(item.from_type);
      const toId = asString(item.to_id);
      const toType = asString(item.to_type);
      if (!fromId || !fromType || !toId || !toType) return null;
      const relationType = asString(item.relation_type);
      const confidence = asNumber(item.confidence);
      return {
        local_id: asString(item.local_id) ?? `r${index + 1}`,
        from_id: fromId,
        from_type: NODE_TYPES.has(fromType) ? fromType : 'entity',
        to_id: toId,
        to_type: NODE_TYPES.has(toType) ? toType : 'entity',
        relation_type: relationType && RELATION_TYPES.has(relationType) ? relationType : 'related_to',
        description: asString(item.description),
        confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : undefined,
        evidence: sanitizeEvidence(item.evidence),
      };
    })
    .filter((item): item is KnowledgeRelation => item !== null);
  return relations.length ? relations : undefined;
};

const buildFallbackKnowledge = (req: RequestEnvelopeKnowledgeExtraction): AnalyzeKnowledgeExtractionData => ({
  title: req.payload.chapter_title ?? `Chapter ${req.payload.chapter_id}`,
  summary: summarize(req.payload.chapter_text, 240),
  people: [],
  ideas: [],
  events: [],
  entities: [],
  themes: [],
  relations: [],
});

const sanitizeKnowledgeExtraction = (
  raw: unknown,
  req: RequestEnvelopeKnowledgeExtraction,
): AnalyzeKnowledgeExtractionData => {
  const record = isRecord(raw) ? raw : {};

  return {
    title: asString(record.title) ?? req.payload.chapter_title ?? `Chapter ${req.payload.chapter_id}`,
    summary: asString(record.summary) ?? summarize(req.payload.chapter_text, 240),
    people: sanitizePeople(record.people) ?? [],
    ideas: sanitizeIdeas(record.ideas) ?? [],
    events: sanitizeEvents(record.events) ?? [],
    entities: sanitizeEntities(record.entities) ?? [],
    themes: sanitizeThemes(record.themes) ?? [],
    relations: sanitizeRelations(record.relations) ?? [],
  };
};

const buildCacheKey = (req: RequestEnvelopeKnowledgeExtraction): string => {
  return buildStableCacheKey(CACHE_PREFIX, CACHE_VERSION, {
    payload: req.payload,
    context: req.context ?? {},
    prompt_version: PROMPT_VERSION,
    model: config.model,
  });
};

let cachedSystemPrompt: string | null = null;

const loadSystemPrompt = async (): Promise<string> => {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = (await fs.readFile(PROMPT_PATH, 'utf8')).trim();
  return cachedSystemPrompt;
};

const buildPrompt = (req: RequestEnvelopeKnowledgeExtraction): string => {
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

const buildKnowledgeExtractionData = async (
  req: RequestEnvelopeKnowledgeExtraction,
): Promise<CallReturn<string>> => {
  handlerLog('knowledge_extraction', 'building LLM prompt', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
  });

  const [systemPrompt, userPrompt] = await Promise.all([
    loadSystemPrompt(),
    Promise.resolve(buildPrompt(req)),
  ]);
  const llmClient = createLLMClient({ systemPrompt });
  handlerLog('knowledge_extraction', 'LLM prompt prepared', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    promptVersion: PROMPT_VERSION,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
  });

  return llmClient.json(userPrompt);
};

export const handleKnowledgeExtraction = async (
  req: RequestEnvelopeKnowledgeExtraction,
): Promise<CallReturn<string>> => {
  handlerLog('knowledge_extraction', 'request received', {
    requestId: req.request_id,
    chapterId: req.payload.chapter_id,
    chunkId: req.payload.chunk_id,
    promptVersion: PROMPT_VERSION,
  });

  const cacheKey = buildCacheKey(req);
  const cached = cache.get<ResponseEnvelopeKnowledgeExtraction>(cacheKey);
  if (cached) {
    handlerLog('knowledge_extraction', 'cache hit', {
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
      const raw = extractJsonFromText(text);
      const data = sanitizeKnowledgeExtraction(raw, req);

      const response: ResponseEnvelopeKnowledgeExtraction = {
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
      console.warn('[knowledge_extraction] failed to cache response', error);
      const fallback = buildFallbackKnowledge(req);
      const response: ResponseEnvelopeKnowledgeExtraction = {
        request_id: req.request_id,
        status: 'ok',
        served_from: 'fresh',
        data: fallback,
        usage: {
          latency_ms: Date.now() - started,
        },
      };
      cache.set(cacheKey, response, config.cacheTtlMs);
    }
  })();

  return { data: tappedStream, usage: usagePromise };
};
