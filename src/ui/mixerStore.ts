import type { MixerState } from '../audio/settings.js';
import { DEFAULT_MIXER_STATE } from '../audio/settings.js';

const KEY = 'musical-system.mixer.v1';

/**
 * Mixer settings survive page reloads: faders, EQ, crossfader, master,
 * limiter and pitch. Loading a track onto a deck never resets them — they are
 * restored from here at boot and re-applied on every load.
 */
export function loadMixerState(): MixerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_MIXER_STATE);
    const parsed = JSON.parse(raw) as Partial<MixerState>;
    return {
      master: numberOr(parsed.master, DEFAULT_MIXER_STATE.master),
      limiterEnabled: typeof parsed.limiterEnabled === 'boolean' ? parsed.limiterEnabled : true,
      crossfader: numberOr(parsed.crossfader, DEFAULT_MIXER_STATE.crossfader),
      decks: {
        A: mergeDeck(parsed.decks?.A, DEFAULT_MIXER_STATE.decks.A),
        B: mergeDeck(parsed.decks?.B, DEFAULT_MIXER_STATE.decks.B),
      },
    };
  } catch {
    return structuredClone(DEFAULT_MIXER_STATE);
  }
}

export function saveMixerState(state: MixerState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode etc. — settings just won't persist */
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mergeDeck(value: unknown, fallback: { volume: number; eq: { low: number; mid: number; high: number }; pitch: number }) {
  const v = (value ?? {}) as Record<string, unknown>;
  const eq = (v.eq ?? {}) as Record<string, unknown>;
  return {
    volume: numberOr(v.volume, fallback.volume),
    pitch: numberOr(v.pitch, fallback.pitch),
    eq: {
      low: numberOr(eq.low, fallback.eq.low),
      mid: numberOr(eq.mid, fallback.eq.mid),
      high: numberOr(eq.high, fallback.eq.high),
    },
  };
}
