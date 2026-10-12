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

const template = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const source = template.replace('__ASSETS__', JSON.stringify(assets));
await writeFile(new URL('../dist/worker.js', import.meta.url), source);
