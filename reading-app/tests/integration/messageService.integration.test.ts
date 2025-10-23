import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import MessageService from '../../src/services/messageService';
import NetworkClient from '../../src/services/networkClient';
import type { AnalyzeSkeletonPayload } from '../../src/services/envelopes';
import { handleMsg } from '../../../reading-app-server/http/router';

describe('MessageService integration (real server)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.MOCK_LLM = '1';

    server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/ping') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', serverTime: new Date().toISOString() }));
        return;
      }

      if (req.method === 'POST' && req.url === '/msg') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          const result = await handleMsg(body);
          res.setHeader('Content-Type', 'application/json');
          const statusCode = result.status === 'error'
            ? result.error?.http ?? 500
            : 200;
          res.writeHead(statusCode);
          res.end(JSON.stringify(result));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  test('ping returns ok from live server', async () => {
    const client = new NetworkClient({ baseUrl });
    const service = new MessageService(client);

    const result = await service.ping();

    expect(result.status).toBe('ok');
    expect(result.serverTime).toBeDefined();
  });

  test('fetchSkeleton hits server and returns structured data', async () => {
    const client = new NetworkClient({ baseUrl });
    const service = new MessageService(client, {
      locale: 'en-US',
      apiVersion: 'v1',
    });

    const payload: AnalyzeSkeletonPayload = {
      doc_id: 'doc-123',
      content_hash: 'hash-abc',
      sections: [
        {
          id: 's1',
          text: 'First sentence. Second sentence.',
        },
      ],
    };

    const response = await service.fetchSkeleton(payload);

    expect(response.status).toBe('ok');
    expect(response.data?.paragraphs).toHaveLength(1);
    expect(response.data?.sentences).toHaveLength(2);
    expect(response.served_from).toBeDefined();
  });
});
