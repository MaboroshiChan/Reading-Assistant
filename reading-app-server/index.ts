// index.ts
import http from 'node:http';
import { handleMsg, handleStream } from './http/router';
import { config } from './services/config';

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id, Idempotency-Key, X-App-Client');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/ping') {
    const remote = req.socket.remoteAddress ?? 'unknown';
    console.log(`[server] ping received from ${remote} @ ${new Date().toISOString()}`);
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

      if (result.stream) {
        let text = '';
        for await (const chunk of result.stream) {
          text += chunk;
        }
        const data = JSON.parse(text);
        const usage = await result.usage;
        const buffered = {
          ...result,
          stream: undefined,
          data,
          usage,
        };
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(buffered));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      const statusCode = result.status === 'error'
        ? result.error?.http ?? 500
        : 200;
      res.writeHead(statusCode);
      res.end(JSON.stringify(result));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/stream') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const result = await handleStream(body);

      if ('status' in result && result.status === 'error') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(result.error?.http ?? 500);
        res.end(JSON.stringify(result));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      if (result.stream) {
        for await (const chunk of result.stream) {
          res.write(chunk);
        }
      }
      res.end();
    });
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

const port = process.env.PORT ?? 8787;
const mode = config.useMockLLM ? 'MOCK_LLM' : 'LIVE_LLM';

server.listen(port, () => {
  console.log(`server on :${port} (${mode})`);
});