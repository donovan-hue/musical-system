/**
 * Tipos y utilidades de la integración con Spotify.
 *
 * REGLA: Spotify se usa SOLO como fuente de identificación/metadatos vía su
 * API oficial (Client Credentials). NUNCA se extrae audio protegido de
 * Spotify; una pista de Spotify es una referencia que requiere una fuente de
 * audio autorizada para materializarse físicamente.
 */

export interface SpotifyTrackMeta {
  spotifyId: string;
  title: string;
  artists: string;
  album: string;
  durationMs: number;
  trackNumber: number | null;
  releaseDate: string;
  coverUrl: string | null;
  /** URL pública de la pista en Spotify (identificación exacta). */
  spotifyUrl: string;
}

export interface SpotifyPlaylistMeta {
  spotifyId: string;
  name: string;
  owner: string;
  coverUrl: string | null;
  trackTotal: number;
  tracks: SpotifyTrackMeta[];
}

export type SpotifyUrlCheck = { ok: true; playlistId: string } | { ok: false; reason: string };

/** Acepta open.spotify.com/playlist/ID (con o sin query) y spotify:playlist:ID. */
export function parseSpotifyPlaylistUrl(raw: string): SpotifyUrlCheck {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'Introduce la URL de la playlist de Spotify.' };

  const uri = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(trimmed);
  if (uri?.[1]) return { ok: true, playlistId: uri[1] };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'La URL no es válida.' };
  }
  const hostOk = parsed.hostname === 'open.spotify.com' || parsed.hostname === 'play.spotify.com';
  const match = /\/playlist\/([A-Za-z0-9]+)/.exec(parsed.pathname);
  if (!hostOk || !match?.[1]) {
    return { ok: false, reason: 'No es una URL de playlist de Spotify (open.spotify.com/playlist/…).' };
  }
  return { ok: true, playlistId: match[1] };
}

/** "Artista A, Artista B" a partir del array de la API. */
export function joinArtists(artists: { name?: unknown }[]): string {
  return artists
    .map((a) => (typeof a.name === 'string' ? a.name : ''))
    .filter((name) => name.length > 0)
    .join(', ');
}
