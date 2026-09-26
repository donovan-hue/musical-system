import { SAMPLER_PADS, type SamplerPad } from '../audio/sampler.js';

export interface SamplerCallbacks {
  onTrigger(pad: SamplerPad): number; // devuelve la duración del gesto (s)
  onVolume(position: number): void;
}

/**
 * Sampler con pads de estado real: cada pad dispara síntesis Web Audio real
 * y se ilumina mientras suena. Atajos A S D F G H.
 */
export class SamplerView {
  readonly el: HTMLElement;
  private readonly pads: Record<SamplerPad, HTMLButtonElement> = {} as Record<SamplerPad, HTMLButtonElement>;
  private readonly timers: Partial<Record<SamplerPad, number>> = {};

  constructor(
    cb: SamplerCallbacks,
    toast: (msg: string, kind?: 'info' | 'error' | 'ok') => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'sampler-view panel-view';
    this.el.innerHTML = `
      <div class="panel-head">
        <span class="panel-hint">Sonidos sintetizados en vivo (Web Audio). Teclas: A S D F G H.</span>
        <label class="panel-check">Vol <input class="sampler-vol" type="range" min="0" max="1" step="0.01" value="0.9" aria-label="Volumen del sampler"></label>
      </div>
      <div class="sampler-pads" role="group" aria-label="Pads del sampler">
        ${SAMPLER_PADS.map((p, i) => `<button class="sampler-pad" data-pad="${p.id}" aria-label="Pad ${p.label}"><b>${p.label}</b><i>${'ASDFGH'[i] ?? ''}</i></button>`).join('')}
      </div>
    `;
    for (const pad of SAMPLER_PADS) {
      const btn = this.el.querySelector<HTMLButtonElement>(`.sampler-pad[data-pad="${pad.id}"]`);
      if (!btn) continue;
      this.pads[pad.id] = btn;
      btn.addEventListener('click', () => {
        try {
          this.flash(pad.id, cb.onTrigger(pad.id));
        } catch (error) {
          toast(`Sampler: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      });
    }
    const vol = this.el.querySelector('.sampler-vol') as HTMLInputElement;
    vol.addEventListener('input', () => cb.onVolume(parseFloat(vol.value)));
  }

  /** Lanza un pad desde el teclado (devuelve true si existía). */
  triggerFromKeyboard(pad: SamplerPad, durationSec: number): void {
    this.flash(pad, durationSec);
  }

  private flash(pad: SamplerPad, durationSec: number): void {
    const btn = this.pads[pad];
    if (!btn) return;
    btn.classList.add('active');
    if (this.timers[pad]) window.clearTimeout(this.timers[pad]);
    this.timers[pad] = window.setTimeout(() => btn.classList.remove('active'), Math.max(90, durationSec * 1000));
  }
}
