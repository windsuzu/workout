import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAPI } from '../src/server/api.js';
import { FileStore } from './file-store.mjs';
import { buildApp } from './build.mjs';

export function startServer({ api, directory = 'dist', port = 3000 } = {}) {
  const root = resolve(directory);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const origin = `http://${incoming.headers.host}`, url = new URL(incoming.url, origin);
      if (url.pathname.startsWith('/api/')) {
        const chunks = []; let size = 0;
        for await (const chunk of incoming) { size += chunk.length; if (size > 300000) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(chunk); }
        const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
        const response = await api(request); outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => { if (key !== 'set-cookie') outgoing.setHeader(key, value); });
        const cookie = response.headers.getSetCookie(); if (cookie.length) outgoing.setHeader('Set-Cookie', cookie);
        outgoing.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405); outgoing.end(); return; }
      const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + '/')) { outgoing.writeHead(403); outgoing.end(); return; }
      const data = await readFile(file);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[extname(file)] || 'application/octet-stream';
      outgoing.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); outgoing.end(incoming.method === 'HEAD' ? undefined : data);
    } catch (error) { outgoing.writeHead(error.code === 'ENOENT' ? 404 : 500); outgoing.end('Not available'); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.PORT || 3000), env = { ...process.env, APP_URL: process.env.APP_URL || `http://localhost:${port}` };
  await buildApp();
  await startServer({ api: createAPI({ store: new FileStore(), env }), port });
  console.log(`FORM available at http://localhost:${port}`);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.AUTH_SECRET) console.log('Local workout tracking is ready. Google sync needs the settings described in docs/google-setup.md.');
}
