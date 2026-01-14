/*
 * messageService.ts — Semantic API over NetworkClient (v1)
 *
 * Role:
 *  - Thin service layer wrapping NetworkClient to send well-typed Envelope messages
 *  - Provides semantic methods for your app: fetchSkeleton, analyzeParagraph, analyzeSentence, analyzeSubsentence
 *  - Centralizes default context (locale, client info, prompt_version, quality policy)
 *  - Keeps surface stable even if transport (fetch/WS) changes
 */

import type {
  RequestEnvelope,
  ResponseEnvelope,
  ResponseEnvelopeSkeleton,
  ResponseEnvelopeParagraph,
  ResponseEnvelopeSentence,
  ResponseEnvelopeSubSentence as ResponseEnvelopeSubSentence,
  AnalyzeSkeletonPayload,
  AnalyzeSkeletonData,
  AnalyzeParagraphPayload,
  AnalyzeParagraphData,
  AnalyzeSentencePayload,
  AnalyzeSentenceData,
  AnalyzeSubSentencePayload as AnalyzeSubSentencePayload,
  AnalyzeSubSentenceData as AnalyzeSubSentenceData,
  StandardContext,
  ApiVersion,
  Priority,
  CacheHint,
} from './envelopes';

import NetworkClient, { type SendOptions } from './networkClient';

// -----------------------------
// Defaults & helpers
// -----------------------------

export interface MessageServiceDefaults {
  apiVersion?: ApiVersion;                 // default 'v1'
  locale?: string;                         // e.g., 'zh-CN'
  clientInfo?: { app: string; platform: string; version: string; client_id?: string };
  promptVersion?: string;                  // your current prompt bundle version
  modelTier?: 'mid' | 'high';              // default model tier for analysis
  defaultPriority?: Priority;              // default 'normal'
  defaultCacheHint?: CacheHint;            // default 'prefer'
}

const ensure = <T>(v: T | undefined, fb: T): T => (v === undefined ? fb : v);

function buildContext(base: Partial<StandardContext> | undefined, defaults?: MessageServiceDefaults): StandardContext | undefined {
  if (!base && !defaults?.promptVersion && !defaults?.modelTier) return base as StandardContext | undefined;
  const quality_policy: StandardContext['quality_policy'] = {
    model_tier: ensure(defaults?.modelTier, 'mid'),
    ...(base?.quality_policy ?? {}),
  };
  const ctx = {
    ...base,
    prompt_version: base?.prompt_version ?? defaults?.promptVersion,
    quality_policy,
  } as Partial<StandardContext>;
  return ctx as StandardContext;
}

// -----------------------------
// Service
// -----------------------------

export class MessageService {
  private readonly client: NetworkClient;
  private readonly defaults: MessageServiceDefaults;

  constructor(client: NetworkClient, defaults: MessageServiceDefaults = {}) {
    this.client = client;
    this.defaults = defaults;
  }

  getClient(): NetworkClient {
    return this.client;
  }

  getDefaults(): MessageServiceDefaults {
    return this.defaults;
  }

  /** Generic sender (escape hatch) */
  async send<TRes extends ResponseEnvelope, TFrame = unknown, TPartial = unknown>(
    envelope: RequestEnvelope,
    sendOptions?: SendOptions<TFrame, TPartial>,
  ): Promise<TRes> {
    // Fill defaults
    if (!('api_version' in envelope)) {
      (envelope as RequestEnvelope).api_version = this.defaults.apiVersion ?? 'v1';
    }
    if (!('locale' in envelope)) {
      (envelope as RequestEnvelope).locale = this.defaults.locale;
    }
    if (!('priority' in envelope)) {
      (envelope as RequestEnvelope).priority = this.defaults.defaultPriority ?? 'normal';
    }
    if (!('cache_hint' in envelope)) {
      (envelope as RequestEnvelope).cache_hint = this.defaults.defaultCacheHint ?? 'prefer';
    }

    if (envelope.context) {
      envelope.context = buildContext(envelope.context, this.defaults);
    }

    // Automatically enable streaming mode if a frame callback is provided
    if (sendOptions && ((sendOptions).onFrame || (sendOptions).onPartial)) {
      envelope.stream = true;
    }

    const res = await this.client.send<TRes, RequestEnvelope, TFrame, TPartial>(envelope, sendOptions);
    return res;
  }

  /**
   * Run global lightweight preprocessing (skeleton) for a document
   */
  async fetchSkeleton(
    payload: AnalyzeSkeletonPayload,
    ctx?: Partial<StandardContext>,
    sendOptions?: SendOptions<Partial<AnalyzeSkeletonData>>
  ): Promise<ResponseEnvelopeSkeleton> {
    const env: RequestEnvelope = {
      type: 'analyze.skeleton.v1',
      api_version: this.defaults.apiVersion ?? 'v1',
      request_id: crypto.randomUUID(),
      locale: this.defaults.locale,
      priority: this.defaults.defaultPriority ?? 'low',
      cache_hint: this.defaults.defaultCacheHint ?? 'prefer',
      context: buildContext(ctx, this.defaults),
      payload,
    } as RequestEnvelope;

    return this.send<ResponseEnvelopeSkeleton, Partial<AnalyzeSkeletonData>>(env, sendOptions);
  }

  /** Analyze a paragraph on click */
  async analyzeParagraph(
    payload: AnalyzeParagraphPayload,
    ctx: Partial<StandardContext> & { doc: StandardContext['doc'] },
    sendOptions?: SendOptions<Partial<AnalyzeParagraphData>>
  ): Promise<ResponseEnvelopeParagraph> {
    const env: RequestEnvelope = {
      type: 'analyze.paragraph.v1',
      api_version: this.defaults.apiVersion ?? 'v1',
      request_id: crypto.randomUUID(),
      locale: this.defaults.locale,
      priority: this.defaults.defaultPriority ?? 'high',
      cache_hint: this.defaults.defaultCacheHint ?? 'prefer',
      context: buildContext(ctx, this.defaults),
      payload,
    } as RequestEnvelope;

    return this.send<ResponseEnvelopeParagraph, Partial<AnalyzeParagraphData>>(env, sendOptions);
  }

  /** Analyze a sentence on click */
  async analyzeSentence(
    payload: AnalyzeSentencePayload,
    ctx: Partial<StandardContext> & { doc: StandardContext['doc'] },
    sendOptions?: SendOptions<Partial<AnalyzeSentenceData>>
  ): Promise<ResponseEnvelopeSentence> {
    const env: RequestEnvelope = {
      type: 'analyze.sentence.v1',
      api_version: this.defaults.apiVersion ?? 'v1',
      request_id: crypto.randomUUID(),
      locale: this.defaults.locale,
      priority: this.defaults.defaultPriority ?? 'high',
      cache_hint: this.defaults.defaultCacheHint ?? 'prefer',
      context: buildContext(ctx, this.defaults),
      payload,
    } as RequestEnvelope;

    return this.send<ResponseEnvelopeSentence, Partial<AnalyzeSentenceData>>(env, sendOptions);
  }

  /** Analyze a sub-sentence span within a sentence */
  async analyzeSubSentence(
    payload: AnalyzeSubSentencePayload,
    ctx: Partial<StandardContext> & { doc: StandardContext['doc'] },
    meta?: Record<string, unknown>,
    sendOptions?: SendOptions<Partial<AnalyzeSubSentenceData>, Partial<AnalyzeSubSentenceData>>
  ): Promise<ResponseEnvelopeSubSentence> {
    const env: RequestEnvelope = {
      type: 'analyze.subsentence.v1',
      api_version: this.defaults.apiVersion ?? 'v1',
      request_id: crypto.randomUUID(),
      locale: this.defaults.locale,
      priority: this.defaults.defaultPriority ?? 'high',
      cache_hint: this.defaults.defaultCacheHint ?? 'prefer',
      context: buildContext(ctx, this.defaults),
      payload,
      meta,
    } as RequestEnvelope;

    console.log("analyzeSubSentence");
    return this.send<ResponseEnvelopeSubSentence, Partial<AnalyzeSubSentenceData>, Partial<AnalyzeSubSentenceData>>(env, sendOptions);
  }

  /** Health check helper that proxies through to the underlying NetworkClient. */
  async ping(signal?: AbortSignal): Promise<{ status: string; serverTime: string }> {
    return this.client.ping(signal);
  }

  /** Cancel in-flight request by request_id */
  cancel(requestId: string): void {
    this.client.cancel(requestId);
  }

  /** Replace or install a token supplier */
  setAuthTokenSupplier(supplier: Parameters<NetworkClient['setAuthTokenSupplier']>[0]): void {
    this.client.setAuthTokenSupplier(supplier);
  }
}

export default MessageService;
