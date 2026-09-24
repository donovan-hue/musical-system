import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validateConvertUrl } from '../src/util/convertUrl.ts';

/**
 * Conversión REAL url → MP3: yt-dlp descarga el mejor audio y FFmpeg lo
 * codifica a MP3 192 kbps. Sin mocks: si algo falla, se lanza ConvertError
 * con el detalle real (stderr) de la herramienta que falló.
 */

export type ConvertErrorCode =
  | 'BAD_URL'
  | 'BUSY'
  | 'TOOLS_MISSING'
  | 'PROBE_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'ENCODE_FAILED'
  | 'TIMEOUT'
  | 'EMPTY_FILE'
  | 'INTERNAL';

export class ConvertError extends Error {
  readonly code: ConvertErrorCode;
  readonly status: number;
  readonly detail: string | undefined;

  constructor(code: ConvertErrorCode, message: string, options: { status?: number; detail?: string } = {}) {
    super(message);
    this.name = 'ConvertError';
    this.code = code;
    this.status = options.status ?? 500;
    this.detail = options.detail;
  }
}

// ---------- Binarios (configurables por entorno; PASO 5) ----------

function ffmpegFromInstaller(): string | null {
  try {
    const installer = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg') as { path?: string };
    return typeof installer.path === 'string' ? installer.path : null;
  } catch {
    return null;
  }
}

const YT_DLP_BIN = process.env.YT_DLP_PATH || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegFromInstaller() || 'ffmpeg';

// ---------- Límites ----------

const PROBE_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;
const ENCODE_TIMEOUT_MS = 180_000;
const MAX_CONCURRENT = 2;
let active = 0;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (err) => {
      const enoent = (err as NodeJS.ErrnoException).code === 'ENOENT';
      finish({
        code: null,
        stdout,
        stderr: enoent ? `TOOL_MISSING:${bin}` : String(err),
      });
    });
    child.on('close', (code) => {
      finish({
        code: timedOut ? -1 : code,
        stdout,
        stderr: timedOut ? `${stderr}\n[proceso terminado por timeout]` : stderr,
      });
    });
  });
}

function assertTool(result: RunResult, bin: string): void {
  if (result.code === null && result.stderr.startsWith('TOOL_MISSING:')) {
    throw new ConvertError(
      'TOOLS_MISSING',
      `La herramienta "${bin}" no está disponible en el servidor. Instálala (pip install yt-dlp · ffmpeg) o define YT_DLP_PATH / FFMPEG_PATH.`,
      { status: 503 },
    );
  }
}

function lastLines(text: string, count: number): string {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-count).join('\n').slice(-1000);
}

function safeFileName(title: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex -- elimina caracteres de control reales
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return `${cleaned.length > 0 ? cleaned : 'audio'}.mp3`;
}

export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// ---------- Pasos de la conversión ----------

interface ProbeInfo {
  title?: string;
  duration?: number;
}

function classifyProbeFailure(stderr: string): ConvertError {
  const detail = lastLines(stderr, 8);
  if (/unsupported url|is not a valid url/i.test(stderr)) {
    return new ConvertError('BAD_URL', 'La URL no es válida o el sitio no está soportado.', { status: 400, detail });
  }
  if (/sign in to confirm|private video|video unavailable|has been removed|not available|age.restrict/i.test(stderr)) {
    return new ConvertError('DOWNLOAD_FAILED', 'El video no está disponible (privado, eliminado o requiere inicio de sesión).', { status: 502, detail });
  }
  if (/failed to|unable to download|getaddrinfo|connection|timed out|network|urerror/i.test(stderr)) {
    return new ConvertError('DOWNLOAD_FAILED', 'No se pudo contactar el sitio de origen (fallo de red).', { status: 502, detail });
  }
  return new ConvertError('PROBE_FAILED', 'No se pudo leer la información de esa URL.', { status: 502, detail });
}

async function probe(url: string): Promise<ProbeInfo> {
  const result = await run(YT_DLP_BIN, ['--no-playlist', '--skip-download', '--dump-single-json', url], PROBE_TIMEOUT_MS);
  assertTool(result, YT_DLP_BIN);
  if (result.code === -1) {
    throw new ConvertError('TIMEOUT', 'El sondeo de la URL tardó demasiado.', { status: 504 });
  }
  if (result.code !== 0) throw classifyProbeFailure(result.stderr);
  try {
    return JSON.parse(result.stdout) as ProbeInfo;
  } catch {
    throw new ConvertError('PROBE_FAILED', 'No se pudo interpretar la información de la URL.', {
      status: 502,
      detail: lastLines(result.stdout, 5),
    });
  }
}

async function downloadAudio(url: string, dir: string): Promise<string> {
  const result = await run(
    YT_DLP_BIN,
    ['--no-playlist', '--no-progress', '-f', 'bestaudio/best', '-o', path.join(dir, 'source.%(ext)s'), url],
    DOWNLOAD_TIMEOUT_MS,
  );
  assertTool(result, YT_DLP_BIN);
  if (result.code === -1) {
    throw new ConvertError('TIMEOUT', 'La descarga del audio tardó demasiado.', { status: 504 });
  }
  if (result.code !== 0) {
    throw new ConvertError('DOWNLOAD_FAILED', 'yt-dlp no pudo descargar el audio de esa URL.', {
      status: 502,
      detail: lastLines(result.stderr, 8),
    });
  }
  const files = await readdir(dir);
  const source = files.find((f) => f.startsWith('source.'));
  if (!source) {
    throw new ConvertError('DOWNLOAD_FAILED', 'La descarga no produjo ningún archivo de audio.', { status: 502 });
  }
  return path.join(dir, source);
}

async function encodeMp3(sourcePath: string, dir: string): Promise<Buffer> {
  const outPath = path.join(dir, 'output.mp3');
  const result = await run(
    FFMPEG_BIN,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', outPath],
    ENCODE_TIMEOUT_MS,
  );
  assertTool(result, FFMPEG_BIN);
  if (result.code === -1) {
    throw new ConvertError('TIMEOUT', 'La conversión a MP3 tardó demasiado.', { status: 504 });
  }
  if (result.code !== 0) {
    throw new ConvertError('ENCODE_FAILED', 'FFmpeg no pudo convertir el audio a MP3.', {
      status: 500,
      detail: lastLines(result.stderr, 8),
    });
  }
  const mp3 = await readFile(outPath);
  if (mp3.byteLength < 1024) {
    throw new ConvertError('EMPTY_FILE', 'El MP3 resultante está vacío.', { status: 502 });
  }
  return mp3;
}

export interface ConvertResult {
  fileName: string;
  title: string;
  durationSec: number | null;
  mp3: Buffer;
}

/** Flujo completo: sondeo → descarga (yt-dlp) → codificación (FFmpeg) → MP3. */
export async function convertToMp3(rawUrl: string): Promise<ConvertResult> {
  const check = validateConvertUrl(rawUrl);
  if (!check.ok) throw new ConvertError('BAD_URL', check.reason, { status: 400 });

  if (active >= MAX_CONCURRENT) {
    throw new ConvertError('BUSY', 'Hay una conversión en proceso; inténtalo de nuevo en unos segundos.', { status: 503 });
  }
  active += 1;
  const dir = await mkdtemp(path.join(tmpdir(), 'musical-convert-'));
  try {
    const info = await probe(check.url);
    const sourcePath = await downloadAudio(check.url, dir);
    const mp3 = await encodeMp3(sourcePath, dir);
    return {
      fileName: safeFileName(info.title ?? 'audio'),
      title: info.title ?? 'audio',
      durationSec: typeof info.duration === 'number' && Number.isFinite(info.duration) ? info.duration : null,
      mp3,
    };
  } finally {
    active -= 1;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ConvertErrorPayload {
  status: number;
  body: { ok: false; code: ConvertErrorCode; error: string; detail?: string };
}

export function errorResponse(err: unknown): ConvertErrorPayload {
  if (err instanceof ConvertError) {
    const body: ConvertErrorPayload['body'] = { ok: false, code: err.code, error: err.message };
    if (err.detail) body.detail = err.detail;
    return { status: err.status, body };
  }
  return {
    status: 500,
    body: { ok: false, code: 'INTERNAL', error: 'Error interno del servidor de conversión.', detail: String(err) },
  };
}
