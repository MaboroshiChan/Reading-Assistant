/*
 * networkClient.ts — Transport for Envelope Messages (v1)
 *
 * Responsibilities
 * - POST unified Envelope messages to a single /msg endpoint
 * - Attach auth, default headers, idempotency key (if provided)
 * - Timeouts via AbortController
 * - Retries with exponential backoff + jitter on retriable errors
 * - Cancellation by request_id
 * - Optional streaming support for NDJSON/SSE-like responses (onFrame callback)
 * - Strict typing against envelopes.ts contracts (no `any`)
 */

import type {
  RequestEnvelope,
  ResponseEnvelope,
  EnvelopeError,
  EnvelopeFrame,
  CacheHint,
  Priority,
} from './envelopes';

// -----------------------------
// Utility: IDs & timing
// -----------------------------

const randomId = (): string => {
  const cr = (globalThis as { crypto?: Crypto }).crypto;
  if (cr && typeof cr.randomUUID === 'function') {
    return cr.randomUUID();
  }
  return `req_${Math.random().toString(36).slice(2)}_${Date.now()}`;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

// -----------------------------
// Errors & predicates
// -----------------------------

export class NetworkError extends Error {
  readonly cause?: unknown;
  readonly http?: number;
  constructor(message: string, cause?: unknown, http?: number) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
    this.http = http;
  }
}

const RETRIABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

function isRetriable(http?: number, ee?: EnvelopeError): boolean {
  if (ee?.retriable) return true;
  if (http && RETRIABLE_HTTP.has(http)) return true;
  return false;
}

// -----------------------------
// Client options
// -----------------------------

export interface NetworkClientOptions {
  baseUrl: string;               // e.g., https://api.example.com
  apiPath?: string;              // default '/msg'
  getAuthToken?: () => Promise<string | null> | string | null; // optional supplier
  defaultHeaders?: Record<string, string>;
  defaultTimeoutMs?: number;     // per attempt timeout (default 15000)
  maxRetries?: number;           // default 3
  backoffBaseMs?: number;        // default 250
}

export interface SendOptions<TFrame = unknown> {
  signal?: AbortSignal;          // external cancel signal
  timeoutMs?: number;            // per attempt
  cacheHint?: CacheHint;         // override envelope.cache_hint
  priority?: Priority;           // override envelope.priority
  onFrame?: (frame: EnvelopeFrame<TFrame>) => void; // NDJSON/SSE streaming callback
}

// -----------------------------
// NetworkClient implementation
// -----------------------------

export class NetworkClient {
  private readonly baseUrl: string;
  private readonly apiPath: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly controllers = new Map<string, AbortController>();
  private getAuthToken?: () => Promise<string | null> | string | null;

  constructor(opts: NetworkClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiPath = opts.apiPath ?? '/msg';
    this.defaultHeaders = { 'Content-Type': 'application/json', ...(opts.defaultHeaders ?? {}) };
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 15000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 3);
    this.backoffBaseMs = opts.backoffBaseMs ?? 250;
    this.getAuthToken = opts.getAuthToken;
  }

  /**
   * Send a single Envelope to the service. Supports retries and optional streaming (NDJSON/SSE).
   */
  async send<
    TRes extends ResponseEnvelope,
    TReq extends RequestEnvelope = RequestEnvelope,
    TFrame = unknown
  >(
    envelope: TReq,
    options: SendOptions<TFrame> = {},
  ): Promise<TRes> {
    // Ensure request_id & timestamp & optional overrides
    const req = {
      ...envelope,
      request_id: (envelope.request_id ?? randomId()) as TReq['request_id'],
      timestamp: (envelope as RequestEnvelope).timestamp ?? nowIso(),
      cache_hint: options.cacheHint ?? envelope.cache_hint ?? 'prefer',
      priority: options.priority ?? envelope.priority ?? 'normal',
    } as TReq;

    const url = `${this.baseUrl}${this.apiPath}`;
    const maxAttempts = this.maxRetries + 1; // initial + retries

    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const signal = this.chainWith(controller, options.signal);
      this.controllers.set(String(req.request_id), controller);
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.defaultTimeoutMs);

      try {
        const authHeader = await this.resolveAuthHeader();
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            ...this.defaultHeaders,
            ...(authHeader ? { Authorization: authHeader } : {}),
            'x-request-id': String(req.request_id),
            ...(req.idempotency_key ? { 'Idempotency-Key': req.idempotency_key } : {}),
          },
          body: JSON.stringify(req),
          signal,
        });

        const ct = res.headers.get('Content-Type') || '';
        if (res.ok && options.onFrame && /ndjson|event-stream/i.test(ct)) {
          await this.consumeStream(res, options.onFrame);
          // In pure streaming mode, servers may not send a final JSON body.
          // We return a minimal partial envelope to indicate frames were delivered.
          clearTimeout(timeout);
          this.controllers.delete(String(req.request_id));
          return { request_id: req.request_id, status: 'partial' } as TRes;
        }

        const http = res.status;
        let payload: unknown;
        try {
          payload = await res.json();
        } catch (e) {
          throw new NetworkError(`Non-JSON response (HTTP ${http})`, e, http);
        }

        clearTimeout(timeout);
        this.controllers.delete(String(req.request_id));

        if (!res.ok) {
          const envAny = payload as { error?: EnvelopeError } | undefined;
          const envErr = envAny?.error;
          if (isRetriable(http, envErr) && attempt < maxAttempts - 1) {
            await this.backoff(attempt);
            continue;
          }
          throw new NetworkError(envErr?.message ?? `HTTP ${http}`, envErr, http);
        }

        return payload as TRes;
      } catch (err) {
        lastErr = err;
        clearTimeout(timeout);
        this.controllers.delete(String(req.request_id));

        const nerr = err instanceof NetworkError ? err : undefined;
        const http = nerr?.http;
        const cause = nerr?.cause as EnvelopeError | undefined;
        if (isRetriable(http, cause) && attempt < maxAttempts - 1) {
          await this.backoff(attempt);
          continue;
        }
        throw err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new NetworkError('Request failed', lastErr);
  }

  /** Cancel an in-flight request by request_id */
  cancel(requestId: string): void {
    const ac = this.controllers.get(String(requestId));
    if (ac) ac.abort();
    this.controllers.delete(String(requestId));
  }

  /** Replace or install a token supplier */
  setAuthTokenSupplier(supplier: NetworkClientOptions['getAuthToken']): void {
    this.getAuthToken = supplier;
  }

  // -----------------------------
  // Internals
  // -----------------------------

  private async resolveAuthHeader(): Promise<string | null> {
    if (!this.getAuthToken) return null;
    const value = typeof this.getAuthToken === 'function' ? await this.getAuthToken() : this.getAuthToken;
    return value ? `Bearer ${value}` : null;
  }

  private async backoff(attempt: number): Promise<void> {
    const exp = Math.min(8, 2 ** (attempt + 1));
    const jitter = Math.random() + 0.5; // 0.5—1.5x
    const ms = this.backoffBaseMs * exp * jitter;
    await sleep(ms);
  }

  /** Wire two AbortSignals together so that cancelling either cancels the fetch. */
  private chainWith(controller: AbortController, outer?: AbortSignal): AbortSignal {
    if (!outer) return controller.signal;
    if (outer.aborted) {
      controller.abort();
      return controller.signal;
    }
    const onAbort = () => controller.abort();
    outer.addEventListener('abort', onAbort, { once: true });
    return controller.signal;
  }

  /** Parse a streaming response as NDJSON or event-stream-like lines and emit frames. */
  private async consumeStream<T>(res: Response, onFrame: (f: EnvelopeFrame<T>) => void): Promise<void> {
    const reader = res.body?.getReader?.();
    if (!reader) return; // environment doesn't support streaming

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            'seq' in parsed &&
            'chunk_type' in parsed
          ) {
            onFrame(parsed as EnvelopeFrame<T>);
          }
        } catch {
          // ignore malformed lines
        }
      }
    }

    const tail = buffer.trim();
    if (tail) {
      try {
        const parsed: unknown = JSON.parse(tail);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'seq' in parsed &&
          'chunk_type' in parsed
        ) {
          onFrame(parsed as EnvelopeFrame<T>);
        }
      } catch {
        // ignore
      }
    }
  }
}

export default NetworkClient;