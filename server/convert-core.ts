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
  | 'RATE_LIMIT'
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

// ---------- Calidad real (ffprobe) y descarga sin re-codificar ----------

function ffprobeBin(): string {
  try {
    const installer = createRequire(import.meta.url)('@ffprobe-installer/ffprobe') as { path?: string };
    if (typeof installer.path === 'string') return installer.path;
  } catch {
    /* usa el del PATH */
  }
  return process.env.FFPROBE_PATH || 'ffprobe';
}

const FFPROBE_BIN = ffprobeBin();

export interface AudioQuality {
  format: string;
  codec: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  channels: number | null;
  durationSec: number | null;
}

interface FfprobeJson {
  streams?: { codec_name?: string; sample_rate?: string; channels?: number; bit_rate?: string }[];
  format?: { format_name?: string; bit_rate?: string; duration?: string };
}

/** Metadatos de calidad REALES con ffprobe (nunca inventados). */
export async function probeQuality(filePath: string): Promise<AudioQuality> {
  const result = await run(
    FFPROBE_BIN,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    PROBE_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new ConvertError('ENCODE_FAILED', 'ffprobe no pudo leer el archivo descargado.', {
      status: 502,
      detail: lastLines(result.stderr, 6),
    });
  }
  let data: FfprobeJson;
  try {
    data = JSON.parse(result.stdout) as FfprobeJson;
  } catch {
    throw new ConvertError('ENCODE_FAILED', 'ffprobe devolvió salida no interpretable.', { status: 502 });
  }
  const stream = data.streams?.find((st) => st.codec_name) ?? {};
  const kbps = (raw?: string): number | null => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n / 1000) : null;
  };
  const hz = Number(stream.sample_rate);
  const duration = Number(data.format?.duration);
  return {
    format: (data.format?.format_name ?? '').split(',')[0] ?? '',
    codec: stream.codec_name ?? null,
    bitrateKbps: kbps(stream.bit_rate) ?? kbps(data.format?.bit_rate),
    sampleRate: Number.isFinite(hz) && hz > 0 ? hz : null,
    channels: typeof stream.channels === 'number' ? stream.channels : null,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

export type FetchMode = 'original' | 'mp3';

export interface FetchResult {
  fileName: string;
  title: string;
  durationSec: number | null;
  bytes: Buffer;
  contentType: string;
  quality: AudioQuality;
  /** true si el archivo llegó tal cual la fuente (sin recomprimir). */
  preserved: boolean;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

function safeBaseName(title: string): string {
  // eslint-disable-next-line no-control-regex -- elimina caracteres de control reales del título
  const cleaned = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return cleaned.length > 0 ? cleaned : 'audio';
}

/**
 * Trae el audio de una URL conservando la MÁXIMA calidad disponible:
 * - mode 'original': sirve el archivo descargado por yt-dlp SIN recodificar.
 * - mode 'mp3': conversión explícita a MP3 320 kbps (elección del usuario).
 */
export async function fetchAudio(rawUrl: string, mode: FetchMode): Promise<FetchResult> {
  const check = validateConvertUrl(rawUrl);
  if (!check.ok) throw new ConvertError('BAD_URL', check.reason, { status: 400 });
  if (active >= MAX_CONCURRENT) {
    throw new ConvertError('BUSY', 'Hay una conversión en proceso; inténtalo de nuevo en unos segundos.', { status: 503 });
  }
  active += 1;
  const dir = await mkdtemp(path.join(tmpdir(), 'audiolad-fetch-'));
  try {
    const info = await probe(check.url);
    const sourcePath = await downloadAudio(check.url, dir);

    if (mode === 'original') {
      const bytes = await readFile(sourcePath);
      if (bytes.byteLength < 512) {
        throw new ConvertError('EMPTY_FILE', 'El archivo descargado está vacío.', { status: 502 });
      }
      const quality = await probeQuality(sourcePath);
      const ext = path.extname(sourcePath).toLowerCase() || '.bin';
      return {
        fileName: `${safeBaseName(info.title ?? 'audio')}${ext}`,
        title: info.title ?? 'audio',
        durationSec: quality.durationSec,
        bytes,
        contentType: CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream',
        quality,
        preserved: true,
      };
    }

    // Conversión explícita a MP3 320 kbps (solo cuando el usuario la pide).
    const outPath = path.join(dir, 'output.mp3');
    const result = await run(
      FFMPEG_BIN,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', outPath],
      ENCODE_TIMEOUT_MS,
    );
    if (result.code === -1) throw new ConvertError('TIMEOUT', 'La conversión a MP3 tardó demasiado.', { status: 504 });
    if (result.code !== 0) {
      throw new ConvertError('ENCODE_FAILED', 'FFmpeg no pudo convertir el audio a MP3.', {
        status: 500,
        detail: lastLines(result.stderr, 8),
      });
    }
    const bytes = await readFile(outPath);
    if (bytes.byteLength < 1024) throw new ConvertError('EMPTY_FILE', 'El MP3 resultante está vacío.', { status: 502 });
    const quality = await probeQuality(outPath);
    return {
      fileName: `${safeBaseName(info.title ?? 'audio')}.mp3`,
      title: info.title ?? 'audio',
      durationSec: quality.durationSec,
      bytes,
      contentType: 'audio/mpeg',
      quality,
      preserved: false,
    };
  } finally {
    active -= 1;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface MatchCandidate {
  title: string;
  url: string;
  durationSec: number | null;
  uploader: string | null;
}

/**
 * Búsqueda REAL de candidatos (yt-dlp ytsearch) para que el USUARIO elija
 * explícitamente la fuente; el sistema nunca sustituye versiones solo.
 */
export async function searchCandidates(query: string): Promise<MatchCandidate[]> {
  const q = query.trim();
  if (q.length === 0) throw new ConvertError('BAD_URL', 'Escribe el nombre de la pista a buscar.', { status: 400 });
  const result = await run(
    YT_DLP_BIN,
    ['--no-playlist', '--flat-playlist', '--dump-single-json', `ytsearch5:${q}`],
    PROBE_TIMEOUT_MS,
  );
  assertTool(result, YT_DLP_BIN);
  if (result.code === -1) throw new ConvertError('TIMEOUT', 'La búsqueda tardó demasiado.', { status: 504 });
  if (result.code !== 0) {
    throw new ConvertError('DOWNLOAD_FAILED', 'No se pudo buscar la pista (fallo de red hacia la fuente).', {
      status: 502,
      detail: lastLines(result.stderr, 6),
    });
  }
  let data: { entries?: { title?: string; url?: string; webpage_url?: string; duration?: number; uploader?: string }[] };
  try {
    data = JSON.parse(result.stdout) as typeof data;
  } catch {
    throw new ConvertError('PROBE_FAILED', 'No se pudo interpretar la búsqueda.', { status: 502 });
  }
  return (data.entries ?? [])
    .filter((e) => typeof e.url === 'string' || typeof e.webpage_url === 'string')
    .map((e) => ({
      title: e.title ?? '(sin título)',
      url: (e.webpage_url ?? e.url) as string,
      durationSec: typeof e.duration === 'number' ? Math.round(e.duration) : null,
      uploader: typeof e.uploader === 'string' ? e.uploader : null,
    }));
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
  const dir = await mkdtemp(path.join(tmpdir(), 'audiolad-convert-'));
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
