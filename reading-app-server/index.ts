// index.ts
import http from 'node:http';
import { handleMsg } from './http/router';

const server = http.createServer(async (req, res) => {
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
      res.setHeader('Content-Type', 'application/json');
      const statusCode = result.status === 'error'
        ? result.error?.http ?? 500
        : 200;
      res.writeHead(statusCode);
      res.end(JSON.stringify(result));
    });
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

server.listen(process.env.PORT ?? 8787, () => {
  console.log(`server on :${process.env.PORT ?? 8787}`);
});
