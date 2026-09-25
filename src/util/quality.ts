/**
 * Información de calidad REAL de una pista. Nada se inventa:
 * - sampleRate y canales vienen del AudioBuffer decodificado.
 * - bitrate efectivo = bytes × 8 / duración (el bitrate real del archivo).
 * - formato desde la extensión; códec solo cuando una herramienta real
 *   (ffprobe) lo reporta; si no, null y la UI lo muestra como "—".
 */

export interface QualityInfo {
  /** Contenedor/formato: WAV, MP3, FLAC, OPUS, M4A… */
  format: string;
  /** Códec reportado por ffprobe (o null si se desconoce). */
  codec: string | null;
  /** Bitrate efectivo en kbps (o null si no se puede calcular). */
  bitrateKbps: number | null;
  sampleRate: number | null;
  channels: number | null;
}

const FORMAT_BY_EXT: Record<string, string> = {
  mp3: 'MP3',
  wav: 'WAV',
  wave: 'WAV',
  flac: 'FLAC',
  ogg: 'OGG',
  oga: 'OGG',
  opus: 'OPUS',
  m4a: 'M4A',
  m4b: 'M4A',
  aac: 'AAC',
  weba: 'WEBM',
  webm: 'WEBM',
  aif: 'AIFF',
  aiff: 'AIFF',
  wma: 'WMA',
};

export function formatFromFileName(fileName: string): string {
  const ext = fileName.includes('.') ? (fileName.split('.').pop() ?? '').toLowerCase() : '';
  return FORMAT_BY_EXT[ext] ?? (ext ? ext.toUpperCase() : '—');
}

interface BufferFacts {
  sampleRate: number;
  channels: number;
  durationSec: number;
}

/** Calidad deducida del archivo decodificado (navegador; sin ffprobe). */
export function computeQuality(fileName: string, sizeBytes: number, facts: BufferFacts): QualityInfo {
  const bitrateKbps =
    facts.durationSec > 0 && sizeBytes > 0 ? Math.round((sizeBytes * 8) / facts.durationSec / 1000) : null;
  return {
    format: formatFromFileName(fileName),
    codec: null, // Sin ffprobe en el navegador: honestamente desconocido.
    bitrateKbps,
    sampleRate: Number.isFinite(facts.sampleRate) ? facts.sampleRate : null,
    channels: facts.channels > 0 ? facts.channels : null,
  };
}

/** Calidad desde los X-Audio-* headers reales de /api/fetch-audio. */
export function qualityFromHeaders(
  fileName: string,
  sizeBytes: number,
  durationSec: number | null,
  headers: { codec?: string | null; bitrateKbps?: number | null; sampleRate?: number | null; channels?: number | null },
): QualityInfo {
  const fallbackBitrate =
    durationSec && durationSec > 0 && sizeBytes > 0 ? Math.round((sizeBytes * 8) / durationSec / 1000) : null;
  return {
    format: formatFromFileName(fileName),
    codec: headers.codec || null,
    bitrateKbps: headers.bitrateKbps ?? fallbackBitrate,
    sampleRate: headers.sampleRate ?? null,
    channels: headers.channels ?? null,
  };
}

/** "MP3 · 320 kbps · 44.1 kHz · 2ch" — con — en lo desconocido. */
export function describeQuality(q: QualityInfo | null | undefined): string {
  if (!q) return '—';
  const parts = [q.format];
  if (q.bitrateKbps != null) parts.push(`${q.bitrateKbps} kbps`);
  if (q.sampleRate != null) parts.push(`${(q.sampleRate / 1000).toFixed(1)} kHz`);
  if (q.channels != null) parts.push(`${q.channels}ch`);
  if (q.codec) parts.push(q.codec);
  return parts.join(' · ');
}
