/**
 * Efectos reales por deck (insert): cada FX es una cadena Web Audio con
 * mezcla dry/wet. Arquitectura modular: agregar un FX = añadir un factory.
 *
 * "reverse" y "beatrepeat" están en el catálogo pero NO se pueden ejecutar
 * con fidelidad sobre un AudioBufferSourceNode en marcha (requieren lookahead
 * y reproducir al revés: AudioWorklet + buffer espejo). Se muestran
 * deshabilitados con esa razón exacta — nunca como botones falsos.
 */
export type FxKind = 'echo' | 'reverb' | 'flanger' | 'phaser' | 'reverse' | 'beatrepeat';

export const IMPLEMENTED_FX: readonly FxKind[] = ['echo', 'reverb', 'flanger', 'phaser'];
export const UNIMPLEMENTED_FX_REASON: Partial<Record<FxKind, string>> = {
  reverse: 'Requiere AudioWorklet con buffer espejo (reprodución inversa en vivo).',
  beatrepeat: 'Requiere AudioWorklet con buffer circular y gating sincronizado.',
};

export interface FxModule {
  readonly kind: FxKind;
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** t: 0..1 mezcla/ intensidad del efecto. */
  setAmount(t: number): void;
  /** Retardo en segundos (echo sincronizado a BPM); los demás lo ignoran. */
  setTime?(seconds: number): void;
  dispose(): void;
}

/** Impulso de reverb sintetizado (ruido con decaimiento exponencial) — DSP real. */
function buildImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export function createFxModule(kind: FxKind, ctx: BaseAudioContext): FxModule {
  if (kind === 'echo') {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(4);
    delay.delayTime.value = 0.375;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    input.connect(output); // dry
    input.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(wet);
    wet.connect(output);
    return {
      kind,
      input,
      output,
      setAmount(t) {
        wet.gain.setTargetAtTime(t, ctx.currentTime, 0.03);
      },
      setTime(seconds) {
        delay.delayTime.setTargetAtTime(Math.min(4, Math.max(0.01, seconds)), ctx.currentTime, 0.05);
      },
      dispose() {
        input.disconnect();
        delay.disconnect();
        tone.disconnect();
        feedback.disconnect();
        wet.disconnect();
        output.disconnect();
      },
    };
  }
  if (kind === 'reverb') {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = buildImpulse(ctx, 2.4, 2.6);
    const pre = ctx.createBiquadFilter();
    pre.type = 'highpass';
    pre.frequency.value = 180;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    input.connect(output); // dry
    input.connect(pre);
    pre.connect(convolver);
    convolver.connect(wet);
    wet.connect(output);
    return {
      kind,
      input,
      output,
      setAmount(t) {
        wet.gain.setTargetAtTime(t * 1.4, ctx.currentTime, 0.03);
      },
      dispose() {
        input.disconnect();
        pre.disconnect();
        convolver.disconnect();
        wet.disconnect();
        output.disconnect();
      },
    };
  }
  if (kind === 'flanger') {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.004;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.28;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.0022;
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();
    const wet = ctx.createGain();
    wet.gain.value = 0;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    input.connect(output); // dry
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(output);
    return {
      kind,
      input,
      output,
      setAmount(t) {
        wet.gain.setTargetAtTime(t, ctx.currentTime, 0.03);
      },
      dispose() {
        try { lfo.stop(); } catch { /* ya detenido */ }
        input.disconnect();
        delay.disconnect();
        lfoGain.disconnect();
        wet.disconnect();
        feedback.disconnect();
        output.disconnect();
      },
    };
  }
  // phaser: cadena de allpass modulados por LFO.
  const input = ctx.createGain();
  const output = ctx.createGain();
  const stages: BiquadFilterNode[] = [];
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.35;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 900;
  lfo.connect(lfoGain);
  lfo.start();
  let prev: AudioNode = input;
  for (let i = 0; i < 4; i++) {
    const allpass = ctx.createBiquadFilter();
    allpass.type = 'allpass';
    allpass.frequency.value = 320 + i * 420;
    allpass.Q.value = 0.7;
    lfoGain.connect(allpass.frequency);
    prev.connect(allpass);
    prev = allpass;
    stages.push(allpass);
  }
  const wet = ctx.createGain();
  wet.gain.value = 0;
  prev.connect(wet);
  wet.connect(output);
  input.connect(output); // dry
  return {
    kind: 'phaser',
    input,
    output,
    setAmount(t) {
      wet.gain.setTargetAtTime(t * 0.9, ctx.currentTime, 0.03);
    },
    dispose() {
      try { lfo.stop(); } catch { /* ya detenido */ }
      input.disconnect();
      for (const s of stages) s.disconnect();
      lfoGain.disconnect();
      wet.disconnect();
      output.disconnect();
    },
  };
}
