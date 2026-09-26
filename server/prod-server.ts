import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './convert-http.ts';

/**
 * Servidor de producción mínimo: sirve dist/ estático + POST /api/convert
 * con el mismo handler que usa el middleware de Vite. `npm run start`.
 */

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStatic(url: string, res: import('node:http').ServerResponse): Promise<void> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    pathname = '/';
  }
  let target = path.normalize(path.join(distDir, pathname));
  if (!target.startsWith(distDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    target = path.join(distDir, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const port = Number(process.env.PORT ?? 8080);
createServer((req, res) => {
  if (req.url?.startsWith('/api')) {
    void handleApiRequest(req, res);
    return;
  }
  void serveStatic(req.url ?? '/', res);
}).listen(port, '0.0.0.0', () => {
  console.log(`musical-system (producción) en http://0.0.0.0:${port}`);
});
