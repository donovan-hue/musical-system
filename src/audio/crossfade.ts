import { clamp } from '../util/format.js';

/**
 * Equal-power crossfader law. At the center both channels sit at ~-3 dB so the
 * perceived loudness stays constant while fading between decks.
 */
export function crossfadeGains(x: number): { a: number; b: number } {
  const t = clamp(x, 0, 1);
  return {
    a: Math.cos((t * Math.PI) / 2),
    b: Math.sin((t * Math.PI) / 2),
  };
}
