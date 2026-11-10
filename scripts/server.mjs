import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from './build-desktop.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 4273);
const base = await prepare(`browser-dev-${port}`, true, true);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
createServer(async (req, res) => {
  try {
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host) || req.method !== 'GET') {
      res.writeHead(403).end('Forbidden'); return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const name = pathname === '/' ? '/index.html' : pathname;
    const fromSource = /^\/(?:index\.html|editor\.html|StoryForge\.png|js\/theme\.js|css\/[\w-]+\.css)$/.test(name);
    const root = fromSource ? resolve(source) : base;
    const path = resolve(root, `.${name}`);
    if (!path.startsWith(root + sep) || (!fromSource && !/^\/app\/[\w.-]+$/.test(name))) {
      res.writeHead(404).end('Not found'); return;
    }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'",
    }).end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`StoryForge Browser Dev is available at http://localhost:${port}`));
