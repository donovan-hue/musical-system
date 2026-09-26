/**
 * Análisis de tonalidad REAL: perfil de cromas por correlación DFT en las 12
 * clases de pitch (4 octavas) y clasificación con perfiles de Krumhansl.
 * Puro y testeable — no usa Web Audio.
 */

export interface KeyInfo {
  tonic: string;
  mode: 'major' | 'minor';
  /** Ej. "Am", "C#m", "F". */
  label: string;
  confidence: number; // 0..1 (correlación normalizada)
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Perfiles de Krumhansl-Kessler (mayor, menor), rotados por tónica. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Acumula energía por clase de pitch (C..B) desde PCM mono. */
export function computeChroma(data: Float32Array, sampleRate: number): Float32Array {
  const chroma = new Float32Array(12);
  if (data.length < 8192 || sampleRate <= 0) return chroma;

  const win = 4096;
  const step = 2; // decimación para velocidad
  const midiLow = 45; // A2
  const midiHigh = 84; // C6
  const pitches: number[] = [];
  for (let midi = midiLow; midi <= midiHigh; midi++) pitches.push(midi);

  // Tablas de coseno/seno precalculadas (las frecuencias son fijas).
  const tables = pitches.map((midi) => {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const cos = new Float32Array(win);
    const sin = new Float32Array(win);
    for (let k = 0; k < win; k++) {
      const angle = (2 * Math.PI * freq * k) / sampleRate;
      cos[k] = Math.cos(angle);
      sin[k] = Math.sin(angle);
    }
    return { cos, sin, pc: midi % 12 };
  });

  const windowCount = Math.min(20, Math.floor(data.length / win));
  for (let w = 0; w < windowCount; w++) {
    const base = Math.floor((data.length - win) * (w / Math.max(1, windowCount - 1)));
    for (const { cos, sin, pc } of tables) {
      let re = 0;
      let im = 0;
      for (let k = 0; k < win; k += step) {
        const v = data[base + k]!;
        re += v * cos[k]!;
        im -= v * sin[k]!;
      }
      chroma[pc] = (chroma[pc] ?? 0) + re * re + im * im;
    }
  }

  // Normaliza a suma 1.
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i]!;
  if (total > 0) for (let i = 0; i < 12; i++) chroma[i] = (chroma[i] ?? 0) / total;
  return chroma;
}

function correlate(chroma: Float32Array, profile: number[], rotation: number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (chroma[(i + rotation) % 12] ?? 0) * profile[i]!;
  return sum;
}

/** Clasifica el perfil de cromas entre las 24 tonalidades mayores/menores. */
export function keyFromChroma(chroma: Float32Array): KeyInfo | null {
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i] ?? 0;
  if (total <= 0) return null;

  let best: KeyInfo | null = null;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  for (let rotation = 0; rotation < 12; rotation++) {
    const major = correlate(chroma, MAJOR_PROFILE, rotation);
    const minor = correlate(chroma, MINOR_PROFILE, rotation);
    for (const [score, mode] of [[major, 'major'], [minor, 'minor']] as const) {
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = { tonic: PITCH_NAMES[rotation]!, mode, label: '', confidence: 0 };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }
  if (!best) return null;
  // Confianza: separación relativa entre el mejor y el segundo mejor perfil.
  best.confidence = bestScore + secondScore !== 0 ? Math.min(1, (bestScore - secondScore) / bestScore + 0.5) : 0;
  best.label = best.mode === 'minor' ? `${best.tonic}m` : best.tonic;
  return best;
}

/** Atajo: tonalidad desde PCM (puede tardar ~100-400 ms en pistas largas). */
export function estimateKey(data: Float32Array, sampleRate: number): KeyInfo | null {
  return keyFromChroma(computeChroma(data, sampleRate));
}

// ---------- Beat grid / loops cuantizados (puro) ----------

/** Segundos por beat a BPM y rate dados (pitch y tempo acoplados). */
export function beatSeconds(bpm: number, rate: number): number | null {
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  return 60 / (bpm * rate);
}

/** Posición cuantizada al beat más cercano de una rejilla que empieza en `offset`. */
export function quantizeToBeat(position: number, beatSec: number, offset = 0): number {
  return offset + Math.round((position - offset) / beatSec) * beatSec;
}

export type LoopBeats = 0.5 | 1 | 2 | 4 | 8 | 16;

import type { LoopRegion } from './deck.js';
export type { LoopRegion };

/**
 * Loop de N beats cuantizado a la rejilla. Devuelve null si el loop quedaría
 * fuera de la pista.
 */
export function beatLoop(
  position: number,
  beatSec: number,
  beats: LoopBeats,
  durationSec: number,
  offset = 0,
): LoopRegion | null {
  if (beatSec <= 0 || durationSec <= 0) return null;
  const start = quantizeToBeat(position, beatSec, offset);
  const end = start + beats * beatSec;
  if (start < 0 || end > durationSec + beatSec / 2) return null;
  return { start: Math.max(0, start), end: Math.min(durationSec, end) };
}

/** Formato compacto de tonalidad para tablas y decks. */
export function formatKey(key: KeyInfo | null | undefined): string {
  return key?.label ?? '—';
}
