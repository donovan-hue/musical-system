export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Validación de la URL del convertidor, compartida por el frontend y el
 * backend para que ambos rechacen exactamente lo mismo.
 */
export function validateConvertUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Introduce una URL.' };
  }
  if (trimmed.length > 2048) {
    return { ok: false, reason: 'La URL es demasiado larga.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'La URL no es válida.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'La URL debe empezar por http:// o https://.' };
  }
  return { ok: true, url: parsed.toString() };
}
