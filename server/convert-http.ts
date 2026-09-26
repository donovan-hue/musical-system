import type { IncomingMessage, ServerResponse } from 'node:http';
import { contentDisposition, convertToMp3, errorResponse, fetchAudio, searchCandidates, type FetchMode } from './convert-core.ts';
import { fetchSpotifyPlaylist, spotifyErrorPayload } from './spotify.ts';

const MAX_BODY_BYTES = 10_000;

// ---------- Limitador de peticiones por IP (Rate Limiter con ventana deslizante) ----------

interface RateBucket {
  tokens: number;
  lastRefill: number;
}
const RATE_LIMIT_CAPACITY = 30; // Máximo 30 peticiones por ráfaga
const RATE_LIMIT_REFILL_MS = 60_000; // Recarga por minuto
const RATE_LIMIT_REFILL_RATE = RATE_LIMIT_CAPACITY / RATE_LIMIT_REFILL_MS;
const ipBuckets = new Map<string, RateBucket>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = ipBuckets.get(ip);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_CAPACITY - 1, lastRefill: now };
    ipBuckets.set(ip, bucket);
    return true;
  }
  const delta = now - bucket.lastRefill;
  bucket.tokens = Math.min(RATE_LIMIT_CAPACITY, bucket.tokens + delta * RATE_LIMIT_REFILL_RATE);
  bucket.lastRefill = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

// Limpieza periódica de IPs inactivas para evitar fugas de memoria en el servidor
const rateCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [ip, b] of ipBuckets.entries()) {
    if (b.lastRefill < cutoff) ipBuckets.delete(ip);
  }
}, 180_000);
if (typeof rateCleanupTimer.unref === 'function') rateCleanupTimer.unref();

// ---------- Cabeceras de seguridad ----------

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

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

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  applySecurityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

async function readJsonField(req: IncomingMessage, res: ServerResponse, field: string): Promise<string | null> {
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: 'Cuerpo de la solicitud demasiado grande o ilegible.' });
    return null;
  }
  try {
    const value = (JSON.parse(body) as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      sendJson(res, 400, { ok: false, code: 'BAD_URL', error: `Falta el campo "${field}": envía JSON { "${field}": "…" }.` });
      return null;
    }
    return value;
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: `El cuerpo debe ser JSON con el campo "${field}".` });
    return null;
  }
}

/**
 * Éxito: el binario de audio con metadatos reales en cabeceras.
 * Error: JSON { ok:false, code, error, detail } con el estado correcto.
 */
async function handleFetchAudio(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // El cuerpo se lee UNA sola vez: { url, mode? }.
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: 'Cuerpo de la solicitud demasiado grande o ilegible.' });
    return;
  }
  let parsed: { url?: unknown; mode?: unknown };
  try {
    parsed = JSON.parse(body) as { url?: unknown; mode?: unknown };
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: 'El cuerpo debe ser JSON con el campo "url".' });
    return;
  }
  if (typeof parsed.url !== 'string' || parsed.url.trim().length === 0) {
    sendJson(res, 400, { ok: false, code: 'BAD_URL', error: 'Falta la URL: envía { "url": "…", "mode": "original"|"mp3" }.' });
    return;
  }
  const url = parsed.url;
  const mode: FetchMode = parsed.mode === 'mp3' ? 'mp3' : 'original';

  try {
    const result = await fetchAudio(url, mode);
    applySecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': result.contentType,
      'Content-Length': String(result.bytes.byteLength),
      'Content-Disposition': contentDisposition(result.fileName),
      'X-Track-Title': encodeURIComponent(result.title),
      'X-Track-Duration': result.durationSec !== null ? String(Math.round(result.durationSec)) : '',
      'X-Audio-Codec': encodeURIComponent(result.quality.codec ?? ''),
      'X-Audio-Bitrate': result.quality.bitrateKbps !== null ? String(result.quality.bitrateKbps) : '',
      'X-Audio-Samplerate': result.quality.sampleRate !== null ? String(result.quality.sampleRate) : '',
      'X-Audio-Channels': result.quality.channels !== null ? String(result.quality.channels) : '',
      'X-Audio-Preserved': result.preserved ? '1' : '0',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(result.bytes);
  } catch (err) {
    const payload = errorResponse(err);
    sendJson(res, payload.status, payload.body);
  }
}

/** POST /api/convert — alias histórico: MP3 explícito (mantenido por compatibilidad). */
async function handleConvertRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = await readJsonField(req, res, 'url');
  if (url === null) return;
  try {
    const result = await convertToMp3(url);
    applySecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(result.mp3.byteLength),
      'Content-Disposition': contentDisposition(result.fileName),
      'X-Track-Title': encodeURIComponent(result.title),
      'X-Track-Duration': result.durationSec !== null ? String(Math.round(result.durationSec)) : '',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(result.mp3);
  } catch (err) {
    const payload = errorResponse(err);
    sendJson(res, payload.status, payload.body);
  }
}

/** POST /api/match — candidatos REALES (yt-dlp ytsearch); el usuario elige. */
async function handleMatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const query = await readJsonField(req, res, 'query');
  if (query === null) return;
  try {
    const candidates = await searchCandidates(query);
    sendJson(res, 200, { ok: true, candidates });
  } catch (err) {
    const payload = errorResponse(err);
    sendJson(res, payload.status, payload.body);
  }
}

/** POST /api/spotify/playlist — metadatos oficiales; 501 sin credenciales. */
async function handleSpotifyPlaylist(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = await readJsonField(req, res, 'url');
  if (url === null) return;
  try {
    const playlist = await fetchSpotifyPlaylist(url);
    sendJson(res, 200, { ok: true, playlist });
  } catch (err) {
    const payload = spotifyErrorPayload(err);
    sendJson(res, payload.status, payload.body);
  }
}

/** Router de /api (mismo origen, sin proxies). */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = (req.url ?? '').split('?')[0] ?? '';
  if (!pathname.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Ruta no encontrada.' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, code: 'BAD_URL', error: 'Método no permitido: envía POST con JSON.' });
    return;
  }

  // Comprobación de Rate Limiting por IP del cliente
  const forwarded = req.headers['x-forwarded-for'];
  const clientIp = typeof forwarded === 'string'
    ? forwarded.split(',')[0]?.trim() || 'unknown'
    : req.socket.remoteAddress || 'unknown';

  if (!checkRateLimit(clientIp)) {
    sendJson(
      res,
      429,
      {
        ok: false,
        code: 'RATE_LIMIT',
        error: 'Demasiadas solicitudes al convertidor. Espera unos segundos antes de reintentar.',
      },
      { 'Retry-After': '10' },
    );
    return;
  }

  // Normaliza la ruta cuando el middleware ya consumió el prefijo.
  const route = pathname === '/api' || pathname === '/api/' ? pathname : pathname.replace(/^\/api\/?/, '');
  switch (route) {
    case '/api/convert':
    case 'convert':
      await handleConvertRequest(req, res);
      return;
    case '/api/fetch-audio':
    case 'fetch-audio':
      await handleFetchAudio(req, res);
      return;
    case '/api/match':
    case 'match':
      await handleMatch(req, res);
      return;
    case '/api/spotify/playlist':
    case 'spotify/playlist':
      await handleSpotifyPlaylist(req, res);
      return;
    default:
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: `Ruta desconocida: ${pathname}` });
  }
}
