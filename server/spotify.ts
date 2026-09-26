import { createRequire } from 'node:module';
import { parseSpotifyPlaylistUrl, joinArtists, type SpotifyPlaylistMeta } from '../src/library/spotify.ts';

/**
 * Integración legítima con Spotify: SOLO metadatos vía la API oficial con
 * Client Credentials (SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET). Nunca se
 * extrae audio protegido. Sin credenciales, el endpoint responde 501 con el
 * requisito claro — no se simula nada.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

let cachedToken: { token: string; expiresAt: number } | null = null;

function credentials(): { id: string; secret: string } | null {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

export function spotifyConfigured(): boolean {
  return credentials() !== null;
}

async function accessToken(): Promise<string> {
  const creds = credentials();
  if (!creds) {
    throw Object.assign(new Error('SPOTIFY_NOT_CONFIGURED'), { code: 'SPOTIFY_NOT_CONFIGURED' });
  }
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (response.status === 401 || response.status === 400) {
    throw Object.assign(new Error('SPOTIFY_BAD_CREDENTIALS'), { code: 'SPOTIFY_BAD_CREDENTIALS' });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`SPOTIFY_TOKEN_HTTP_${response.status}`), { code: 'SPOTIFY_UNAVAILABLE' });
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (typeof data.access_token !== 'string') {
    throw Object.assign(new Error('SPOTIFY_TOKEN_MISSING'), { code: 'SPOTIFY_UNAVAILABLE' });
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.token;
}

interface ApiTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  track_number?: number;
  artists?: { name?: string }[];
  album?: { name?: string; release_date?: string; images?: { url?: string }[] };
  external_urls?: { spotify?: string };
  is_local?: boolean;
}

interface ApiPlaylist {
  id?: string;
  name?: string;
  owner?: { display_name?: string };
  images?: { url?: string }[];
  tracks?: { total?: number; items?: { track?: ApiTrack }[]; next?: string | null };
}

/** Trae la playlist (hasta 500 pistas, con paginación real de la API). */
export async function fetchSpotifyPlaylist(rawUrl: string): Promise<SpotifyPlaylistMeta> {
  const check = parseSpotifyPlaylistUrl(rawUrl);
  if (!check.ok) {
    throw Object.assign(new Error(check.reason), { code: 'BAD_URL', status: 400 });
  }
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}` };

  const first = await fetchApi<ApiPlaylist>(`${API_BASE}/playlists/${check.playlistId}`, headers);
  const tracks: NonNullable<ApiPlaylist['tracks']> = { ...(first.tracks ?? {}) };
  // Paginación real (limit=100 por página).
  let next = tracks.next ?? null;
  let guard = 0;
  while (next && guard < 5) {
    const page = await fetchApi<ApiPlaylist['tracks']>(next, headers);
    tracks.items = [...(tracks.items ?? []), ...(page?.items ?? [])];
    next = page?.next ?? null;
    guard += 1;
  }

  const items = tracks.items ?? [];
  return {
    spotifyId: first.id ?? check.playlistId,
    name: first.name ?? 'Playlist de Spotify',
    owner: first.owner?.display_name ?? '—',
    coverUrl: first.images?.[0]?.url ?? null,
    trackTotal: tracks.total ?? items.length,
    tracks: items.map((item, index) => {
      const t = item.track ?? {};
      return {
        spotifyId: typeof t.id === 'string' ? t.id : `local_${index}`,
        title: t.name ?? `Pista ${index + 1}`,
        artists: joinArtists(t.artists ?? []),
        album: t.album?.name ?? '',
        durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : 0,
        trackNumber: typeof t.track_number === 'number' ? t.track_number : null,
        releaseDate: t.album?.release_date ?? '',
        coverUrl: t.album?.images?.[0]?.url ?? null,
        spotifyUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id ?? ''}`,
      };
    }),
  };
}

async function fetchApi<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers });
  if (response.status === 401) {
    cachedToken = null;
    throw Object.assign(new Error('SPOTIFY_BAD_CREDENTIALS'), { code: 'SPOTIFY_BAD_CREDENTIALS' });
  }
  if (response.status === 404) {
    throw Object.assign(new Error('Playlist no encontrada en Spotify.'), { code: 'SPOTIFY_NOT_FOUND', status: 404 });
  }
  if (response.status === 429) {
    throw Object.assign(new Error('Límite de peticiones de Spotify alcanzado; reintenta en unos segundos.'), {
      code: 'SPOTIFY_RATE_LIMIT',
      status: 503,
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Spotify respondió HTTP ${response.status}.`), {
      code: 'SPOTIFY_UNAVAILABLE',
      status: 502,
      detail: `GET ${url} → ${response.status}`,
    });
  }
  return (await response.json()) as T;
}

/** Mapa de error → payload HTTP honesto. */
export function spotifyErrorPayload(err: unknown): { status: number; body: Record<string, unknown> } {
  const code = (err as { code?: string }).code;
  switch (code) {
    case 'BAD_URL':
      return { status: 400, body: { ok: false, code: 'BAD_URL', error: (err as Error).message } };
    case 'SPOTIFY_NOT_CONFIGURED':
      return {
        status: 501,
        body: {
          ok: false,
          code: 'SPOTIFY_NOT_CONFIGURED',
          error:
            'Autorización requerida: el servidor necesita credenciales de la API de Spotify (SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET) para leer metadatos de playlists.',
          detail: 'Créelas en developer.spotify.com/dashboard y defínelas como variables de entorno del servidor.',
        },
      };
    case 'SPOTIFY_BAD_CREDENTIALS':
      return {
        status: 502,
        body: {
          ok: false,
          code: 'SPOTIFY_BAD_CREDENTIALS',
          error: 'Spotify rechazó las credenciales configuradas (revisa SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).',
        },
      };
    case 'SPOTIFY_NOT_FOUND':
      return { status: 404, body: { ok: false, code: 'SPOTIFY_NOT_FOUND', error: (err as Error).message } };
    case 'SPOTIFY_RATE_LIMIT':
      return { status: 503, body: { ok: false, code: 'SPOTIFY_RATE_LIMIT', error: (err as Error).message } };
    default:
      return {
        status: 502,
        body: {
          ok: false,
          code: 'SPOTIFY_UNAVAILABLE',
          error: 'No se pudo contactar la API de Spotify.',
          detail: String(err),
        },
      };
  }
}

// Evita el warning de import sin uso si el bundler lo marca.
void createRequire;
