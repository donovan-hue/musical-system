import type { DeckFxSettings, DeckSettings, MixerState } from '../audio/settings.js';
import { DEFAULT_MIXER_STATE } from '../audio/settings.js';
import type { FxKind } from '../audio/fx.js';

const KEY = 'musical-system.mixer.v1';

/**
 * Mixer settings survive page reloads: faders, EQ, trim, filtro, FX, cue mix,
 * crossfader, master, limitador y pitch. Loading a track never resets them.
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
      cueMix: numberOr(parsed.cueMix, DEFAULT_MIXER_STATE.cueMix),
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

function mergeFx(value: unknown): DeckFxSettings | null {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.kind === 'string' && typeof v.amount === 'number') {
      return { kind: v.kind as FxKind, amount: v.amount };
    }
  }
  return null;
}

function mergeDeck(value: unknown, fallback: DeckSettings): DeckSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const eq = (v.eq ?? {}) as Record<string, unknown>;
  return {
    volume: numberOr(v.volume, fallback.volume),
    pitch: numberOr(v.pitch, fallback.pitch),
    trim: numberOr(v.trim, fallback.trim ?? 1),
    filter: numberOr(v.filter, fallback.filter ?? 0),
    fx: mergeFx(v.fx),
    cueEnabled: typeof v.cueEnabled === 'boolean' ? v.cueEnabled : false,
    eq: {
      low: numberOr(eq.low, fallback.eq.low),
      mid: numberOr(eq.mid, fallback.eq.mid),
      high: numberOr(eq.high, fallback.eq.high),
    },
  };
}
