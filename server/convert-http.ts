import type { IncomingMessage, ServerResponse } from 'node:http';
import { contentDisposition, convertToMp3, errorResponse } from './convert-core.ts';

const MAX_BODY_BYTES = 10_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Handler de POST /api/convert.
 * Éxito: el binario MP3 (audio/mpeg) con metadatos en cabeceras.
 * Error: JSON { ok:false, code, error, detail } con el estado HTTP correcto.
 */
export async function handleConvertRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, code: 'BAD_URL', error: 'Método no permitido: envía POST con JSON { "url": "…" }.' });
    return;
  }
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: 'Cuerpo de la solicitud demasiado grande o ilegible.' });
    return;
  }
  let url: unknown;
  try {
    url = (JSON.parse(body) as { url?: unknown }).url;
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: 'El cuerpo debe ser JSON con el campo "url".' });
    return;
  }
  if (typeof url !== 'string' || url.trim().length === 0) {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: 'Falta la URL: envía { "url": "…" }.' });
    return;
  }

  try {
    const result = await convertToMp3(url);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(result.mp3.byteLength),
      'Content-Disposition': contentDisposition(result.fileName),
      'X-Track-Title': encodeURIComponent(result.title),
      'X-Track-Duration': result.durationSec !== null ? String(Math.round(result.durationSec)) : '',
      'Cache-Control': 'no-store',
    });
    res.end(result.mp3);
  } catch (err) {
    const payload = errorResponse(err);
    sendJson(res, payload.status, payload.body);
  }
}
