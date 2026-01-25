/*
 * envelopes.ts — Client↔Service Envelope Types (v1)
 * Contract-only TypeScript types for your reading-app network layer.
 * These mirror the “Envelope v1” spec we agreed on: a unified message envelope,
 * standardized context, four analysis message types, frames for partial results,
 * error semantics, caching hints, and observability fields.
 */

// -----------------------------
// Shared primitives
// -----------------------------

export type ISO8601 = string & { __brand?: 'ISO8601' };
export type UUID = string & { __brand?: 'UUID' };
export type ULID = string & { __brand?: 'ULID' };

export type Priority = 'high' | 'normal' | 'low'; // QUESTION: What is this for?
export type CacheHint = 'prefer' | 'only' | 'bypass';
export type ApiVersion = 'v1';

export interface ClientInfo {
  app: string;            // e.g., "reading-app"
  platform: string;       // e.g., "web|extension|electron|ios|android"
  version: string;        // semver
  client_id?: string;     // install/session identifier
}

export interface QualityPolicy {
  model_tier: 'mid' | 'high';
  confidence_threshold?: number; // 0..1 (optional)
}

export interface DocRef {
  doc_id: string;
  content_hash: string; // hash of full content that the client currently sees
}

export interface HierarchyCtx {
  heading_chain: string[]; // e.g., ["Ch.1", "Section 1.2"]
  paragraph_index?: number; // 0-based index within the document
}

export interface NeighborsCtx {
  paragraph?: { prev_summary?: string; next_summary?: string };
  sentence?: { prev_text?: string; next_text?: string };
}

export interface EntityLight {
  id: string;
  type: 'PERSON' | 'ORG' | 'LOC' | 'TERM' | string;
  canonical: string;
  aliases?: string[];
  freq?: number;
}

export interface GlobalEntitiesCtx {
  entities: EntityLight[]; // pre-trimmed to relevant subset
}

export interface StandardContext {
  doc: DocRef;
  hierarchy?: HierarchyCtx;
  neighbors?: NeighborsCtx;
  global_entities?: GlobalEntitiesCtx;
  prompt_version?: string; // used for cache invalidation + reproducibility
  quality_policy?: QualityPolicy;
}

/**
 * What purpose is this? is this even necessary? Or Should let the local machine calculate AnchorSpan?
 */
export interface AnchorSpan { start: number; end: number } // indices in sentence/paragraph text

export interface Anchor {
  paragraph_id?: string;
  sentence_id?: string;
  span?: AnchorSpan;
  anchor_hash: string; // fingerprint of text[span]
}

// -----------------------------
// Envelope-level error and usage
// -----------------------------

export type EnvelopeStatus = 'ok' | 'partial' | 'error';

export type ErrorCode =
  | 'E.AUTH'
  | 'E.RATE'
  | 'E.TIMEOUT'
  | 'E.SERVER'
  | 'E.BAD_REQUEST'
  | 'E.CONTEXT_MISMATCH'
  | 'E.MODEL_OVERLOADED'
  | 'E.CANCELLED';

export interface EnvelopeError {
  code: ErrorCode;
  http?: number;       // mirrored HTTP status (e.g., 401, 429, 500, 412, ...)
  retriable?: boolean; // client may retry with backoff
  message?: string;    // human-readable summary (for logs/devtools)
  details?: unknown;   // structured details (kept machine-readable)
}

// Usage metadata mirrors what the backend reports for cost/latency tracking.
export interface UsageMeta {
  tokens_in?: number;
  tokens_out?: number;
  model_id?: string;    // the concrete model that served the request
  latency_ms?: number;  // end-to-end server latency
}

// -----------------------------
// Frames (partial/streamed responses)
// -----------------------------

// Each frame represents a single streamed chunk in partial responses (NDJSON/SSE).
export interface EnvelopeFrame<T = unknown> {
  seq: number;               // sequence number (1-based)
  of?: number | null;        // optional total frames (null if unknown/open-ended)
  chunk_type: string;        // e.g., "skeleton" | "labels" | "details"
  data: T;                   // frame payload (must be JSON-serializable)
}

// -----------------------------
// Message Types (namespace.action.version)
// -----------------------------

export type AnalyzeMessageType =
  | 'analyze.skeleton.v1'
  | 'analyze.paragraph.v1'
  | 'analyze.sentence.v1'
  | 'analyze.sentence-structure.v1';

export type MessageType = AnalyzeMessageType; // extend here in the future

// -----------------------------
// Payload/Data schemas per message type
// -----------------------------

// 1) analyze.skeleton.v1
export interface AnalyzeSkeletonPayload {
  doc_id: string;
  content_hash: string; // of the whole doc on client
  sections: Array<{ id: string; text: string }>; // may be paged/chunked
  options?: { do_embeddings?: boolean; max_entities?: number };
}

export interface SkeletonParagraph {
  paragraph_id: string;
  text_hash: string;
  sentence_ids: string[];
  brief_summary?: string;
}

export interface SkeletonSentence {
  sentence_id: string;
  paragraph_id: string;
  text: string;
  text_hash: string;
  char_start: number;
  char_end: number;
}

export interface SkeletonHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  paragraph_index_start: number;
}

export interface AnalyzeSkeletonData {
  paragraphs: SkeletonParagraph[];
  sentences: SkeletonSentence[];
  headings?: SkeletonHeading[];
  entity_index?: Array<{
    id: string;
    type: 'PERSON' | 'ORG' | 'LOC' | 'TERM' | string;
    canonical: string;
    aliases?: string[];
    spans?: Array<{ sentence_id: string; span: AnchorSpan }>; // optional light anchoring
  }>;
  embeddings_meta?: { dim: number; chunking: 'sentence' | 'paragraph'; index_id: string };
}

// 2) analyze.paragraph.v1
export interface AnalyzeParagraphPayload {
  doc_id: string;
  paragraph_id: string;
  paragraph_text: string;
  options?: { tasks?: Array<'roles' | 'rhetoric' | 'claims' | 'summary'> };
}

export interface ParagraphRole { role: string; anchors: Anchor[]; confidence?: number }
export interface ParagraphRhetoric { label: string; evidence_anchors?: Anchor[]; confidence?: number }
export interface ParagraphClaim {
  text: string;
  polarity: 'pos' | 'neg' | 'nu';
  support: 'strong' | 'weak' | 'unspecified';
  anchors: Anchor[];
  entity_links?: string[]; // entity ids
}

export interface AnalyzeParagraphData {
  summary?: string;
  roles?: ParagraphRole[];
  rhetoric?: ParagraphRhetoric[];
  claims?: ParagraphClaim[];
  anchors?: Anchor[];
  topic_sentence?: { is_implicit: boolean; text: string };
  confidence?: number; // aggregate
}

// 3) analyze.sentence.v1
export interface AnalyzeSentencePayload {
  doc_id: string;
  sentence_id: string;
  sentence_text: string;
  options?: { tasks?: Array<'semantic_roles' | 'key_words' | 'discourse_function' | 'dependency_light' | 'modal_markers'> };
}

export interface SentenceRole { role: string; span?: AnchorSpan; anchors?: Anchor[]; confidence?: number }
export interface DependencyArc { head: number; dep: number; label: string }
export interface DependencyLight { head_indexed?: boolean; arcs?: DependencyArc[] }
export interface ModalMarker { type: 'hedge' | 'necessity' | 'possibility' | 'certainty' | 'volition' | string; span: AnchorSpan; cue: string }

export interface AnalyzeSentenceData {
  semantic_roles?: SentenceRole[];
  discourse_function?: string; // e.g., thesis|support|counter|definition|example|...
  dependency_light?: DependencyLight;
  modal_markers?: ModalMarker[];
  anchors?: Anchor[];
  confidence?: number;
  key_words?: string[];
}

// 4) analyze.sentence-structure.v1
export interface AnalyzeSentenceStructurePayload {
  doc_id: string;
  sentence_id: string;
  span: AnchorSpan; // subspan within sentence_text
  options?: { tasks?: Array<'micro_roles' | 'cue_interaction' | 'contrast_resolution'> };
}

export interface SentenceStructureUnitData {
  id: string;
  text: string;
  role?: string;
  semantics?: string;
  semRole?: string;
  confidence?: number;
  source?: 'manual' | 'model' | 'hybrid';
  children?: SentenceStructureUnitData[];
  clause?: SentenceStructureAnalysisData;
  meta?: Record<string, unknown>;
  viewHint?: {
    variant?: string;
    collapsed?: boolean;
    label?: string;
    order?: number;
  };
}

export interface SentenceStructureAnalysisData {
  sentenceId: string;
  text: string;
  units: SentenceStructureUnitData[];
  backbone?: {
    subjectId?: string;
    predicateId?: string;
    objectId?: string;
  };
  legend?: {
    semanticsToVariant?: Record<string, string>;
    roleToVariant?: Record<string, string>;
    semRoleToVariant?: Record<string, string>;
    variantPalette?: Record<string, { bg: string; fg: string; dot: string }>;
  };
  layoutHint?: {
    density?: 'normal' | 'dense';
    highlightStrategy?: 'semantics-first' | 'role-first' | 'semantic-role' | 'mixed';
    showLabels?: boolean;
    showCaret?: boolean;
    cardMaxWidth?: number;
  };
  analyzedAt?: string;
  version?: number;
  confidence?: number;
  issues?: Array<{
    type: string;
    message: string;
    unitIds?: string[];
  }>;
  annotations?: Array<{
    userId: string;
    note: string;
    createdAt: string;
    targetUnitId?: string;
  }>;
  meta?: Record<string, unknown>;
}

export interface AnalyzeSentenceStructureData {
  analysis: SentenceStructureAnalysisData;
  confidence?: number;
}

// -----------------------------
// Union helpers per message type
// -----------------------------

// Base fields shared by all outgoing envelopes regardless of analysis task.
export interface StandardEnvelopeBase {
  api_version: ApiVersion;      // "v1"
  request_id: UUID | ULID;      // caller-provided
  idempotency_key?: string;     // for paid/write operations
  priority?: Priority;          // default: "normal"
  client?: ClientInfo;
  // auth is usually added by transport, not included here
  locale?: string;              // e.g., "zh-CN"
  cache_hint?: CacheHint;       // default: "prefer"
  stream?: boolean;             // signal to server to stream partial results
  context?: StandardContext;    // standardized context block
  meta?: Record<string, unknown>;
  timestamp?: ISO8601;          // client-side timestamp for audit
}

export interface RequestEnvelopeSkeleton extends StandardEnvelopeBase {
  type: 'analyze.skeleton.v1';
  payload: AnalyzeSkeletonPayload;
}

export interface RequestEnvelopeParagraph extends StandardEnvelopeBase {
  type: 'analyze.paragraph.v1';
  payload: AnalyzeParagraphPayload;
}

export interface RequestEnvelopeSentence extends StandardEnvelopeBase {
  type: 'analyze.sentence.v1';
  payload: AnalyzeSentencePayload;
}

export interface RequestEnvelopeSentenceStructure extends StandardEnvelopeBase {
  type: 'analyze.sentence-structure.v1';
  payload: AnalyzeSentenceStructurePayload;
}

// Union of every request envelope so transports can accept a single type.
export type RequestEnvelope =
  | RequestEnvelopeSkeleton
  | RequestEnvelopeParagraph
  | RequestEnvelopeSentence
  | RequestEnvelopeSentenceStructure;

// Response envelopes
// Every response echoes back tracking fields so clients can correlate requests.
export interface ResponseEnvelopeBase {
  request_id: UUID | ULID; // echo from request
  status: EnvelopeStatus;
  served_from?: 'fresh' | 'cache';
  error?: EnvelopeError;
  usage?: UsageMeta | Promise<UsageMeta>;
  etag?: string;            // for client-side caching of results
  cursor?: string;          // reserved for future incremental sync
  stream?: AsyncIterable<string>;
}

export interface ResponseEnvelopeSkeleton extends ResponseEnvelopeBase {
  // When status=partial, `data` may contain a schema subset
  data?: AnalyzeSkeletonData;
  frames?: EnvelopeFrame<Partial<AnalyzeSkeletonData>>[];
}

export interface ResponseEnvelopeParagraph extends ResponseEnvelopeBase {
  data?: AnalyzeParagraphData;
  frames?: EnvelopeFrame<Partial<AnalyzeParagraphData>>[];
}

export interface ResponseEnvelopeSentence extends ResponseEnvelopeBase {
  data?: AnalyzeSentenceData;
  frames?: EnvelopeFrame<Partial<AnalyzeSentenceData>>[];
}

export interface ResponseEnvelopeSentenceStructure extends ResponseEnvelopeBase {
  data?: AnalyzeSentenceStructureData;
  frames?: EnvelopeFrame<Partial<AnalyzeSentenceStructureData>>[];
}

export type ResponseEnvelope =
  | ResponseEnvelopeSkeleton
  | ResponseEnvelopeParagraph
  | ResponseEnvelopeSentence
  | ResponseEnvelopeSentenceStructure;

// -----------------------------
// Utility guards (optional)
// -----------------------------

// Quick predicate for narrowing string -> AnalyzeMessageType.
export const isAnalyzeType = (t: string): t is AnalyzeMessageType =>
  t === 'analyze.skeleton.v1' ||
  t === 'analyze.paragraph.v1' ||
  t === 'analyze.sentence.v1' ||
  t === 'analyze.sentence-structure.v1';

// Type guards that help SDK callers branch on response status.
export const isPartial = (r: ResponseEnvelope): r is ResponseEnvelope & { status: 'partial' } => r.status === 'partial';
export const isError = (r: ResponseEnvelope): r is ResponseEnvelope & { status: 'error'; error: EnvelopeError } => r.status === 'error';
export const isOk = (r: ResponseEnvelope): r is ResponseEnvelope & { status: 'ok' } => r.status === 'ok';
