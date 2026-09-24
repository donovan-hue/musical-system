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
