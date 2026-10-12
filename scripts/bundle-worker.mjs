import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files.push(path);
  }
}

await collect(root.pathname);
const assets = {};
for (const file of files) {
  if (file.endsWith('/worker.js')) continue;
  const path = `/${relative(root.pathname, file).split(sep).join('/')}`;
  const bytes = await readFile(file);
  const contentType = file.endsWith('.html') ? 'text/html; charset=utf-8'
    : file.endsWith('.css') ? 'text/css; charset=utf-8'
    : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : 'application/octet-stream';
  assets[path] = { body: bytes.toString('base64'), contentType };
}

const source = `const ASSETS = ${JSON.stringify(assets)};
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'microphone=(self)' };
export default { async fetch(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
  const path = new URL(request.url).pathname;
  const asset = ASSETS[path === '/' ? '/index.html' : path];
  if (!asset) return new Response('Not found', { status: 404, headers: HEADERS });
  const bytes = Uint8Array.from(atob(asset.body), c => c.charCodeAt(0));
  return new Response(request.method === 'HEAD' ? null : bytes, { headers: { ...HEADERS, 'Content-Type': asset.contentType, 'Cache-Control': path === '/' ? 'no-cache' : 'public, max-age=31536000, immutable' } });
} };\n`;
await writeFile(new URL('../dist/worker.js', import.meta.url), source);
