import NetworkClient, { type SendOptions } from './networkClient';
import type { RequestEnvelope, ResponseEnvelope } from './envelopes';

/**
 * Specialized network client that supports partial JSON streaming for real-time UI updates.
 */
export default class StreamingNetworkClient extends NetworkClient {
  private _baseUrl: string;
  private _apiPath: string;
  private _defaultHeaders: Record<string, string>;

  constructor(config: { baseUrl: string; apiPath: string; defaultHeaders?: Record<string, string> }) {
    super(config);
    // Capture config locally since we can't access private properties of the parent
    this._baseUrl = config.baseUrl;
    this._apiPath = config.apiPath;
    this._defaultHeaders = config.defaultHeaders || {};
  }

  /**
   * Sends an envelope with streaming support.
   * If onPartial is provided, it attempts to parse and emit incomplete JSON chunks.
   *
   * @param envelope - The request data.
   * @param options - Transport and streaming callbacks.
   * @returns The final assembled response.
   */
  override async send<TRes extends ResponseEnvelope, TReq extends RequestEnvelope, TFrame = unknown, TPartial = unknown>(
    envelope: TReq,
    options?: SendOptions<TFrame, TPartial>
  ): Promise<TRes> {
    // If no streaming callback is provided, delegate to the standard client logic
    if (!options?.onFrame && !options?.onPartial) {
      return super.send<TRes, TReq, TFrame, TPartial>(envelope, options);
    }

    const url = `${this._baseUrl}${this._apiPath}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this._defaultHeaders,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`Streaming request failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    // Mode 1: Raw JSON Streaming (Partial Parsing)
    if (options.onPartial) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          buffer += chunk;
          try {
            const fixed = fixJson(buffer);
            const parsed = JSON.parse(fixed);
            // console.log("streamingNetworkClient.onPartial chunk", parsed); 
            options.onPartial(parsed as TPartial);
          } catch {
            // ignore parse errors on incomplete chunks
          }
        }
        if (done) break;
      }

      // Return the final full response
      const finalJson = JSON.parse(buffer);
      // Heuristic: if valid JSON helps but lacks 'status', wrap it
      // Note: This assumes the server streams raw data (AnalyzeSubSentenceData) instead of an Envelope.
      const isEnvelope = finalJson && typeof finalJson === 'object' && 'status' in finalJson;

      if (isEnvelope) {
        return finalJson as TRes;
      }

      // valid raw data
      return {
        request_id: envelope.request_id,
        status: 'ok',
        data: finalJson,
        served_from: 'fresh',
      } as unknown as TRes;
    }

    // Mode 2: Frame-based Streaming (NDJSON / stream-json)
    // Note: stream-json is not browser-compatible.
    if (options.onFrame) {
      console.warn('onFrame (Mode 2) is not supported in this browser build. Use onPartial (Mode 1).');
    }

    // Fallback: parse the whole body as JSON if streaming wasn't handled
    return response.json() as Promise<TRes>;
  }
}

/**
 * Heuristic to close open JSON structures (objects, arrays, strings)
 * so that a partial JSON string can be parsed as a valid (though incomplete) object.
 *
 * @param input - The partial JSON string.
 * @returns A string with matched closing brackets and quotes.
 */
function fixJson(input: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}' || char === ']') {
        if (stack.length && stack[stack.length - 1] === char) {
          stack.pop();
        }
      }
    }
  }

  let res = input;
  if (inString) res += '"';
  while (stack.length) {
    res += stack.pop();
  }
  return res;
}
