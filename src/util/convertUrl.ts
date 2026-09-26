export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Detecta direcciones IP o nombres de host privados, de loopback o reservados
 * para mitigar ataques de falsificación de peticiones en el servidor (SSRF).
 */
export function isPrivateOrReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host === '0.0.0.0'
  ) {
    return true;
  }

  // Comprobación de formato IPv4
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [b0, b1, b2, b3] = ipv4Match.slice(1).map(Number);
    if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return true;
    if (b0 > 255 || b1 > 255 || b2 > 255 || b3 > 255) return true;

    // 0.0.0.0/8 (red actual)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (RFC 1918)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (RFC 1918)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (RFC 1918)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local / AWS & Cloud Metadata)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (Carrier-Grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // Redes reservadas y de documentación (RFC 5737 / RFC 2544)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;
    // Multicast (224.0.0.0/4) y clase E reservada (240.0.0.0/4)
    if (b0 >= 224) return true;
  }

  // Comprobación de formato IPv6
  if (
    host === '::1' ||
    host === '::' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc00:') ||
    host.startsWith('fd00:') ||
    host.startsWith('::ffff:')
  ) {
    return true;
  }

  return false;
}

/**
 * Validación de la URL del convertidor, compartida por el frontend y el
 * backend para que ambos rechacen exactamente lo mismo y prevengan SSRF.
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
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'La URL no debe contener credenciales de autenticación.' };
  }
  if (isPrivateOrReservedHost(parsed.hostname)) {
    return { ok: false, reason: 'No se permiten URLs que apunten a redes locales o privadas (SSRF protegido).' };
  }
  return { ok: true, url: parsed.toString() };
}
