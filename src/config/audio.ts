export const AUDIO = {
  maxBytes: 100 * 1024 * 1024,
  headerBytes: 4096,
  eq: {
    lowHz: 220,
    midHz: 1000,
    midQ: 0.9,
    highHz: 3500,
    minDb: -26,
    maxDb: 6,
  },
  gainSmoothSeconds: 0.01,
  defaultChannelVolume: 0.8,
  defaultMasterVolume: 0.8,
  defaultCrossfader: 0.5,
  cueToleranceSec: 0.05,
  endRestartSec: 0.01,
  seekThrottleMs: 70,
} as const
