export interface ConversionSuccess {
  ok: true;
  blob: Blob;
  fileName: string;
  title: string;
  durationSec: number | null;
  sizeBytes: number;
}

export interface ConversionFailure {
  ok: false;
  error: string;
  detail?: string;
}

export type ConversionOutcome = ConversionSuccess | ConversionFailure;

/**
 * Cliente real de POST /api/convert (ruta relativa al mismo origen — sin URL
 * hardcodeada ni variables de entorno en el frontend).
 */
export async function requestConversion(url: string): Promise<ConversionOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor de conversión (¿está en marcha el backend?).' };
  }

  if (!response.ok) {
    let error = `Error HTTP ${response.status}`;
    let detail: string | undefined;
    try {
      const data = (await response.json()) as { error?: unknown; detail?: unknown };
      if (typeof data.error === 'string' && data.error.length > 0) error = data.error;
      if (typeof data.detail === 'string' && data.detail.length > 0) detail = data.detail;
    } catch {
      /* respuesta no-JSON (proxy, HTML de error, etc.) — se usa el mensaje HTTP */
    }
    return { ok: false, error, detail };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('audio/mpeg')) {
    return { ok: false, error: 'La respuesta del servidor no contiene un archivo MP3.' };
  }
  const blob = await response.blob().catch(() => null);
  if (!blob || blob.size === 0) {
    return { ok: false, error: 'El servidor devolvió un archivo vacío.' };
  }

  const fileName = fileNameFromDisposition(response.headers.get('content-disposition')) ?? 'audio.mp3';
  const title = decodeSafe(response.headers.get('x-track-title')) ?? fileName.replace(/\.mp3$/i, '');
  const durationRaw = Number(response.headers.get('x-track-duration'));
  const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;
  return { ok: true, blob, fileName, title, durationSec, sizeBytes: blob.size };
}

/** Inicia la descarga real del MP3 y devuelve el object URL para el enlace manual. */
export function startDownload(blob: Blob, fileName: string): string {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return objectUrl;
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* nombre inválido — se usa el fallback */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

function decodeSafe(encoded: string | null): string | null {
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// ---------- FASE 5: fetch-audio (calidad preservada), match y Spotify ----------

export interface AudioQuality {
  format: string;
  codec: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  channels: number | null;
  /** true si el archivo llegó sin re-codificar desde la fuente. */
  preserved: boolean;
}

export interface AudioFetchSuccess {
  ok: true;
  blob: Blob;
  fileName: string;
  title: string;
  durationSec: number | null;
  sizeBytes: number;
  quality: AudioQuality;
}

export type AudioFetchOutcome = AudioFetchSuccess | ConversionFailure;

function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function strHeader(headers: Headers, name: string): string | null {
  const raw = headers.get(name);
  return raw ? decodeURIComponent(raw) : null;
}

/**
 * POST /api/fetch-audio — trae el audio de una URL.
 * mode 'original' conserva el archivo de la fuente SIN re-codificar;
 * mode 'mp3' es una conversión explícita a MP3 320 kbps elegida por el usuario.
 */
export async function requestAudio(url: string, mode: 'original' | 'mp3'): Promise<AudioFetchOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/fetch-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor (¿está en marcha el backend?).' };
  }
  if (!response.ok) {
    let error = `Error HTTP ${response.status}`;
    let detail: string | undefined;
    try {
      const data = (await response.json()) as { error?: unknown; detail?: unknown };
      if (typeof data.error === 'string' && data.error.length > 0) error = data.error;
      if (typeof data.detail === 'string' && data.detail.length > 0) detail = data.detail;
    } catch {
      /* respuesta no-JSON */
    }
    return { ok: false, error, detail };
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('audio/')) {
    return { ok: false, error: 'La respuesta del servidor no contiene un archivo de audio.' };
  }
  const blob = await response.blob().catch(() => null);
  if (!blob || blob.size === 0) return { ok: false, error: 'El servidor devolvió un archivo vacío.' };
  const fileName = fileNameFromDisposition(response.headers.get('content-disposition')) ?? 'audio';
  const durationRaw = intHeader(response.headers, 'x-track-duration');
  return {
    ok: true,
    blob,
    fileName,
    title: strHeader(response.headers, 'x-track-title') ?? fileName.replace(/\.[a-z0-9]+$/i, ''),
    durationSec: durationRaw,
    sizeBytes: blob.size,
    quality: {
      format: fileName.includes('.') ? (fileName.split('.').pop() ?? '').toUpperCase() : '—',
      codec: strHeader(response.headers, 'x-audio-codec') || null,
      bitrateKbps: intHeader(response.headers, 'x-audio-bitrate'),
      sampleRate: intHeader(response.headers, 'x-audio-samplerate'),
      channels: intHeader(response.headers, 'x-audio-channels'),
      preserved: response.headers.get('x-audio-preserved') === '1',
    },
  };
}

export interface MatchCandidate {
  title: string;
  url: string;
  durationSec: number | null;
  uploader: string | null;
}

/** POST /api/match — candidatos reales; el usuario elige la fuente explícitamente. */
export async function matchCandidates(query: string): Promise<{ ok: true; candidates: MatchCandidate[] } | ConversionFailure> {
  let response: Response;
  try {
    response = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; candidates?: MatchCandidate[]; error?: string; detail?: string }
    | null;
  if (!response.ok || !data?.ok) {
    return {
      ok: false,
      error: data?.error ?? `Error HTTP ${response.status}`,
      detail: data?.detail,
    };
  }
  return { ok: true, candidates: data.candidates ?? [] };
}

export interface SpotifyPlaylistResult {
  ok: true;
  playlist: {
    spotifyId: string;
    name: string;
    owner: string;
    coverUrl: string | null;
    trackTotal: number;
    tracks: {
      spotifyId: string;
      title: string;
      artists: string;
      album: string;
      durationMs: number;
      trackNumber: number | null;
      releaseDate: string;
      coverUrl: string | null;
      spotifyUrl: string;
    }[];
  };
}

/**
 * POST /api/spotify/playlist — metadatos oficiales de Spotify.
 * Sin credenciales en el servidor devuelve 501 con el requisito de autorización.
 */
export async function fetchSpotifyPlaylist(url: string): Promise<SpotifyPlaylistResult | ConversionFailure> {
  let response: Response;
  try {
    response = await fetch('/api/spotify/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; playlist?: SpotifyPlaylistResult['playlist']; error?: string; detail?: string }
    | null;
  if (!response.ok || !data?.ok || !data.playlist) {
    return { ok: false, error: data?.error ?? `Error HTTP ${response.status}`, detail: data?.detail };
  }
  return { ok: true, playlist: data.playlist };
}

/** Descarga (metadata portátil) de la biblioteca completa. */
export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}
