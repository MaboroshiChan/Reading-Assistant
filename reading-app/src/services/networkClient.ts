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
 * - Strict typing against envelopes.ts contracts
 */

import type {
  RequestEnvelope,
  ResponseEnvelope,
  EnvelopeError,
  EnvelopeFrame,
  CacheHint,
  Priority,
  ISO8601,
} from './envelopes';

// -----------------------------
// Utility: IDs & timing
// -----------------------------

type RequestId = RequestEnvelope['request_id'];
type EnvelopeInit<T extends RequestEnvelope> =
  Omit<T, 'request_id' | 'timestamp' | 'cache_hint' | 'priority'> &
  Partial<Pick<T, 'request_id' | 'timestamp' | 'cache_hint' | 'priority'>>;

const randomId = (): RequestId => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID() as RequestId;
  }
  return `req_${Math.random().toString(36).slice(2)}_${Date.now()}` as RequestId;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const nowIso = (): ISO8601 => new Date().toISOString() as ISO8601;

// -----------------------------
// Errors & predicates
// -----------------------------

export class NetworkError extends Error {
  public readonly cause?: unknown;
  public readonly http?: number;

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
    this.defaultHeaders = Object.assign({ 'Content-Type': 'application/json' }, opts.defaultHeaders);
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
    TFrame = unknown,
  >(
    envelope: EnvelopeInit<TReq>,
    options: SendOptions<TFrame> = {},
  ): Promise<TRes> {
    // Ensure request_id & timestamp & optional overrides
    const requestId: RequestId = envelope.request_id ?? randomId();
    const timestamp: ISO8601 = envelope.timestamp ?? nowIso();
    const cacheHint: CacheHint = options.cacheHint ?? envelope.cache_hint ?? 'prefer';
    const priority: Priority = options.priority ?? envelope.priority ?? 'normal';

    const req = {
      ...envelope,
      request_id: requestId,
      timestamp,
      cache_hint: cacheHint,
      priority,
    } as unknown as TReq;

    const url = `${this.baseUrl}${this.apiPath}`;
    const max = this.maxRetries + 1; // attempts = initial + retries

    let lastErr: unknown;
    for (let attempt = 0; attempt < max; attempt++) {
      const ac = new AbortController();
      const cleanupSignal = this.chainWith(ac, options.signal);
      const requestKey = String(req.request_id);
      this.controllers.set(requestKey, ac);

      const timeout = setTimeout(() => ac.abort(), options.timeoutMs ?? this.defaultTimeoutMs);
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        clearTimeout(timeout);
        cleanupSignal();
        this.controllers.delete(requestKey);
      };

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
          signal: ac.signal,
        });

        // Stream handling if NDJSON or event-stream
        const ct = res.headers.get('Content-Type') || '';
        if (res.ok && options.onFrame && /ndjson|event-stream/i.test(ct)) {
          await this.consumeStream(res.clone(), options.onFrame);
          // After stream, try to parse final JSON payload if provided
          // Some servers end with a final envelope JSON; if not, we throw to allow consumer to resolve themselves
          try {
            const json = await res.json() as TRes;
            finalize();
            return json;
          } catch {
            finalize();
            const partial = {
              request_id: req.request_id,
              status: 'partial' as const,
            };
            return partial as TRes;
          }
        }

        // Non-stream JSON path
        const http = res.status;
        let payload: TRes;
        try {
          payload = await res.json() as TRes;
        } catch (e) {
          // If server didn't send JSON, raise protocol error
          throw new NetworkError(`Non-JSON response (HTTP ${http})`, e, http);
        }

        if (!res.ok) {
          const envErr: EnvelopeError | undefined = payload?.error;
          if (isRetriable(http, envErr) && attempt < max - 1) {
            finalize();
            await this.backoff(attempt);
            continue;
          }
          finalize();
          throw new NetworkError(envErr?.message || `HTTP ${http}`, envErr, http);
        }

        finalize();
        // OK
        return payload as TRes;
      } catch (err: unknown) {
        lastErr = err;
        finalize();

        const http = err instanceof NetworkError ? err.http : undefined;
        const envErr = err instanceof NetworkError ? (err.cause as EnvelopeError | undefined) : undefined;
        if (isRetriable(http, envErr) && attempt < max - 1) {
          await this.backoff(attempt);
          continue;
        }
        throw err;
      }
    }

    // Exhausted retries
    throw lastErr instanceof Error ? lastErr : new NetworkError('Request failed', lastErr);
  }

  /** Cancel an in-flight request by request_id */
  cancel(requestId: string) {
    const ac = this.controllers.get(String(requestId));
    if (ac) ac.abort();
    this.controllers.delete(String(requestId));
  }

  /** Replace or install a token supplier */
  setAuthTokenSupplier(supplier: NetworkClientOptions['getAuthToken']) {
    this.getAuthToken = supplier;
  }

  // -----------------------------
  // Internals
  // -----------------------------

  private async resolveAuthHeader(): Promise<string | null> {
    if (!this.getAuthToken) return null;
    const supplier = this.getAuthToken;
    const token = typeof supplier === 'function' ? await supplier() : supplier;
    const trimmed = token?.trim();
    if (!trimmed) return null;
    return `Bearer ${trimmed}`;
  }

  private async backoff(attempt: number) {
    const exp = Math.min(8, 2 ** (attempt + 1));
    const jitter = Math.random() + 0.5; // 0.5—1.5x
    const ms = this.backoffBaseMs * exp * jitter;
    await sleep(ms);
  }

  /**
   * Bridge the request controller to an external AbortSignal so either can cancel the fetch.
   * Returns a cleanup function that removes any event listeners; callers should invoke it
   * when the request finishes to avoid leaking the event listener.
   */
  private chainWith(controller: AbortController, outer?: AbortSignal): () => void {
    if (!outer) return () => {};
    if (outer.aborted) {
      controller.abort();
      return () => {};
    }
    const onAbort = () => controller.abort();
    outer.addEventListener('abort', onAbort, { once: true });
    return () => {
      try {
        outer.removeEventListener('abort', onAbort);
      } catch {
        /* ignore cleanup errors */
      }
    };
  }


  /**
   * Parse a streaming response as NDJSON or event-stream-like lines and emit frames.
   */
  private async consumeStream<T>(res: Response, onFrame: (f: EnvelopeFrame<T>) => void) {
    const reader = res.body?.getReader?.();
    if (!reader) return; // environment doesn't support streaming

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          // Each line is expected to be a JSON frame: { seq, of?, chunk_type, data }
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && 'seq' in parsed && 'chunk_type' in parsed) {
            onFrame(parsed as EnvelopeFrame<T>);
          }
        } catch { /* ignore malformed lines */ }
      }
    }

    // flush remaining buffer
    const tail = buffer.trim();
    if (tail) {
      try {
        const parsed = JSON.parse(tail);
        if (parsed && typeof parsed === 'object' && 'seq' in parsed && 'chunk_type' in parsed) {
          onFrame(parsed as EnvelopeFrame<T>);
        }
      } catch { /* ignore */ }
    }
  }
}

export default NetworkClient;
