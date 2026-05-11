// Minimal Node 22 proxy for the `server` agent provider.
//
//   ANTHROPIC_API_KEY=sk-ant-... node server/agent-proxy.example.mjs
//
// Then in the browser's chat settings, switch the provider to
// "Server proxy" and point the endpoint at http://localhost:8787/api/agent
// (CSP also permits same-origin /api/agent if you mount this under the same
//  host as the Vite dev server via a reverse proxy).
//
// This file is deliberately dependency-free and not part of the bundled app.

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'http://localhost:5173';

if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY is required');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  // CORS preflight / response headers.
  res.setHeader('access-control-allow-origin', ALLOW_ORIGIN);
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  if (req.method !== 'POST' || req.url !== '/api/agent') {
    res.writeHead(404).end('not found');
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body, // forward verbatim — same shape as the Messages API
  });

  // Stream the SSE response straight through.
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'text/event-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': ALLOW_ORIGIN,
  });
  const reader = upstream.body?.getReader();
  if (!reader) { res.end(); return; }
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
});

server.listen(PORT, () => {
  console.log(`agent-proxy listening on http://localhost:${PORT}/api/agent`);
});
