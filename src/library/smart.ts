import type { TrackMeta } from './library.js';

/**
 * Playlists inteligentes: una especificación persistida (reglas) que se
 * evalúa SIEMPRE contra las pistas actuales — nunca materializa una copia.
 * Puramente funcional y testeable.
 */

export type SmartField =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'key'
  | 'bpm'
  | 'durationSec'
  | 'addedAt'
  | 'source'
  | 'format'
  | 'favorite';

export type SmartOp = 'contains' | 'equals' | 'gte' | 'lte';

export interface SmartRule {
  field: SmartField;
  op: SmartOp;
  value: string;
}

export interface SmartPlaylist {
  id: string;
  name: string;
  /** 'all' = AND, 'any' = OR. */
  match: 'all' | 'any';
  rules: SmartRule[];
}

/** Valor textual/numérico de un campo para comparar (null si no aplica). */
function fieldValue(track: TrackMeta, field: SmartField): string | number | boolean | null {
  switch (field) {
    case 'title':
      return track.title;
    case 'artist':
      return track.artist;
    case 'album':
      return track.album;
    case 'genre':
      return track.genre ?? '';
    case 'key':
      return track.key?.label ?? '';
    case 'bpm':
      return track.bpm;
    case 'durationSec':
      return track.durationSec;
    case 'addedAt':
      return track.addedAt;
    case 'source':
      return track.origin?.type ?? 'import';
    case 'format':
      return track.quality?.format ?? '';
    case 'favorite':
      return !!track.favorite;
  }
}

function ruleMatches(track: TrackMeta, rule: SmartRule): boolean {
  const value = fieldValue(track, rule.field);
  const raw = rule.value.trim();
  if (value === null || value === undefined) return false;

  if (typeof value === 'boolean') {
    return raw === 'sí' || raw === 'si' || raw === 'true' || raw === '1' ? value : !value;
  }

  if (typeof value === 'number') {
    const num = Number(raw);
    if (!Number.isFinite(num)) return false;
    if (rule.op === 'gte') return value >= num;
    if (rule.op === 'lte') return value <= num;
    return value === num;
  }

  const text = value.toLowerCase();
  const target = raw.toLowerCase();
  if (rule.op === 'contains') return text.includes(target);
  if (rule.op === 'gte' || rule.op === 'lte') {
    // Comparación lexicográfica (fechas ISO y textos ordenables).
    if (raw.length === 0) return false;
    return rule.op === 'gte' ? text >= target : text <= target;
  }
  return text === target;
}

/** Pistas que cumplen la especificación (evaluación fresca, sin copias). */
export function evaluateSmart(playlist: SmartPlaylist, tracks: readonly TrackMeta[]): TrackMeta[] {
  return tracks.filter((track) => {
    if (playlist.rules.length === 0) return false;
    return playlist.match === 'all'
      ? playlist.rules.every((rule) => ruleMatches(track, rule))
      : playlist.rules.some((rule) => ruleMatches(track, rule));
  });
}

const OPS_BY_FIELD: Record<SmartField, SmartOp[]> = {
  title: ['contains', 'equals'],
  artist: ['contains', 'equals'],
  album: ['contains', 'equals'],
  genre: ['contains', 'equals'],
  key: ['equals', 'contains'],
  bpm: ['gte', 'lte', 'equals'],
  durationSec: ['gte', 'lte'],
  addedAt: ['gte', 'lte'],
  source: ['equals', 'contains'],
  format: ['equals', 'contains'],
  favorite: ['equals'],
};

/** Operadores válidos por campo (para construir la UI sin inventar reglas). */
export function opsForField(field: SmartField): SmartOp[] {
  return OPS_BY_FIELD[field] ?? ['equals'];
}

export const SMART_FIELDS: SmartField[] = [
  'artist',
  'genre',
  'bpm',
  'key',
  'durationSec',
  'addedAt',
  'source',
  'format',
  'album',
  'title',
  'favorite',
];

export const FIELD_LABELS: Record<SmartField, string> = {
  title: 'Título',
  artist: 'Artista',
  album: 'Álbum',
  genre: 'Género',
  key: 'Tonalidad',
  bpm: 'BPM',
  durationSec: 'Duración (s)',
  addedAt: 'Fecha de incorporación',
  source: 'Fuente',
  format: 'Formato',
  favorite: 'Favorita',
};
