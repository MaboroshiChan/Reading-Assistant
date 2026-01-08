import { Readable } from 'node:stream';
import Chain from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';

import NetworkClient, { type SendOptions } from './networkClient';
import type { EnvelopeFrame, RequestEnvelope, ResponseEnvelope } from './envelopes';

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

  override async send<TRes extends ResponseEnvelope, TReq extends RequestEnvelope, TFrame = unknown>(
    envelope: TReq,
    options?: SendOptions<TFrame>
  ): Promise<TRes> {
    // If no streaming callback is provided, delegate to the standard client logic
    if (!options?.onFrame) {
      return super.send(envelope, options);
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

    // Convert Web ReadableStream to Node Readable for stream-json compatibility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(response.body as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline = new (Chain as any)([
      nodeStream,
      parser(),
      pick({ filter: 'frames' }),
      streamArray(),
    ]);

    const frames: TFrame[] = [];

    return new Promise((resolve, reject) => {
      pipeline.on('data', (data: { value: TFrame; }) => {
        // stream-json/streamers/StreamArray emits objects like { key: number, value: T }
        const frame = data.value as TFrame;
        frames.push(frame);
        try {
          options.onFrame?.({ data: frame } as EnvelopeFrame<TFrame>);
        } catch (err) {
          console.error('Error in onFrame callback:', err);
        }
      });

      pipeline.on('end', () => {
        // Construct a partial response with the accumulated frames
        const res: Partial<ResponseEnvelope> = {
          status: 'ok',
          request_id: envelope.request_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          frames: frames as any,
        };
        resolve(res as TRes);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipeline.on('error', (err: any) => reject(err));
    });
  }
}
