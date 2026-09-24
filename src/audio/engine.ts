import { AudioEngine } from './AudioEngine'

const GLOBAL_KEY = '__musicalSystemAudioEngine__'

type EngineGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: AudioEngine
}

const scope = globalThis as EngineGlobal
export const engine: AudioEngine = scope[GLOBAL_KEY] ?? new AudioEngine()
scope[GLOBAL_KEY] = engine
