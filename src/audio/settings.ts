import type { DeckId } from './deck.js';
import type { FxKind } from './fx.js';

export type EqBand = 'low' | 'mid' | 'high';

/** EQ fader span, DJM-style: from -26 dB (near-kill) to +9 dB. */
export const EQ_MIN_DB = -26;
export const EQ_MAX_DB = 9;

export interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

export interface DeckFxSettings {
  kind: FxKind;
  amount: number; // 0..1
}

export interface DeckSettings {
  volume: number; // 0..1 fader position (applied perceptually as v^2)
  eq: EqSettings;
  pitch: number; // playback rate, 1 ± PITCH_RANGE
  trim?: number; // 0..2, default 1
  filter?: number; // -1..1, default 0
  fx?: DeckFxSettings | null;
  cueEnabled?: boolean;
}

export interface MixerState {
  master: number;
  limiterEnabled: boolean;
  crossfader: number;
  cueMix: number; // 0 = master, 1 = cue
  decks: Record<DeckId, DeckSettings>;
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  volume: 0.8,
  eq: { low: 0, mid: 0, high: 0 },
  pitch: 1,
  trim: 1,
  filter: 0,
  fx: null,
  cueEnabled: false,
};

export const DEFAULT_MIXER_STATE: MixerState = {
  master: 0.8,
  limiterEnabled: true,
  crossfader: 0.5,
  cueMix: 0,
  decks: {
    A: { ...DEFAULT_DECK_SETTINGS, eq: { ...DEFAULT_DECK_SETTINGS.eq } },
    B: { ...DEFAULT_DECK_SETTINGS, eq: { ...DEFAULT_DECK_SETTINGS.eq } },
  },
};
