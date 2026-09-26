import { formatBytes, formatTime } from '../util/format.js';
import { validateConvertUrl } from '../util/convertUrl.js';
import { requestAudio, startDownload, type AudioQuality } from './convertApi.js';

type Toast = (message: string, kind?: 'info' | 'error' | 'ok') => void;

export interface ConverterCallbacks {
  /** Guarda el MP3 convertido en la biblioteca local (pipeline real de importación). */
  onAddToLibrary(
    blob: Blob,
    info: { fileName: string; title: string; durationSec: number | null; sourceUrl: string; quality: AudioQuality },
  ): Promise<void>;
}

/**
 * Sección "Convertidor a MP3": URL → POST /api/convert → descarga real.
 * Reutiliza el lenguaje visual del panel de biblioteca (.lib-head, .btn…).
 */
export class ConverterView {
  readonly el: HTMLElement;

  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly downloadLink: HTMLAnchorElement;
  private readonly resultMeta: HTMLElement;
  private readonly libraryBtn: HTMLButtonElement;
  private readonly cb: ConverterCallbacks;

  private busy = false;
  private timer = 0;
  private startedAt = 0;
  private currentObjectUrl: string | null = null;
  private readonly toast: Toast;
  private lastBlob: Blob | null = null;
  private lastInfo: { fileName: string; title: string; durationSec: number | null; sourceUrl: string; quality: AudioQuality } | null = null;
  private inLibrary = false;

  constructor(toast: Toast, cb: ConverterCallbacks) {
    this.toast = toast;
    this.cb = cb;
    this.el = document.createElement('section');
    this.el.className = 'converter';
    this.el.innerHTML = `
      <div class="lib-head">
        <h2>Fuentes de audio (URL)</h2>
        <span class="lib-hint">Trae el audio de una URL conservando su calidad original (o conviértelo a MP3 320 si lo pides).</span>
      </div>
      <form class="convert-form">
        <input class="convert-url" type="text" inputmode="url" autocomplete="off" spellcheck="false"
          placeholder="Pega la URL del video o audio (YouTube, etc.)">
        <button class="btn btn-convert" type="submit">⤓ Traer audio</button>
      </form>
      <div class="convert-mode" role="radiogroup" aria-label="Calidad de descarga">
        <label><input class="mode-original" type="radio" name="convert-mode" checked> Conservar original (sin re-codificar, máxima calidad)</label>
        <label><input class="mode-mp3" type="radio" name="convert-mode"> Convertir a MP3 320 kbps (compatibilidad)</label>
      </div>
      <div class="convert-status" hidden></div>
      <div class="convert-error" hidden></div>
      <div class="convert-result" hidden>
        <a class="btn convert-download" href="#" download>⤓ Descargar <span class="convert-filename"></span></a>
        <button class="btn btn-mini convert-to-library" type="button">＋ Añadir a la biblioteca</button>
        <span class="convert-meta"></span>
      </div>
    `;
    this.form = this.el.querySelector('.convert-form') as HTMLFormElement;
    this.input = this.el.querySelector('.convert-url') as HTMLInputElement;
    this.button = this.el.querySelector('.btn-convert') as HTMLButtonElement;
    this.statusEl = this.el.querySelector('.convert-status') as HTMLElement;
    this.errorEl = this.el.querySelector('.convert-error') as HTMLElement;
    this.resultEl = this.el.querySelector('.convert-result') as HTMLElement;
    this.downloadLink = this.el.querySelector('.convert-download') as HTMLAnchorElement;
    this.resultMeta = this.el.querySelector('.convert-meta') as HTMLElement;
    this.libraryBtn = this.el.querySelector('.convert-to-library') as HTMLButtonElement;
    this.libraryBtn.addEventListener('click', () => void this.addToLibrary());

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
  }

  private async submit(): Promise<void> {
    if (this.busy) return;

    // 1. Validación local: URL vacía o inválida no viaja al backend.
    const check = validateConvertUrl(this.input.value);
    if (!check.ok) {
      this.showError(check.reason);
      this.toast(check.reason, 'error');
      return;
    }

    // 2. Estado de procesamiento real (la petición está en vuelo).
    this.hideMessages();
    this.setBusy(true);
    this.statusEl.hidden = false;
    this.startedAt = Date.now();
    const tick = (): void => {
      const elapsed = Math.round((Date.now() - this.startedAt) / 1000);
      this.statusEl.textContent = `Convirtiendo… ${elapsed} s transcurridos (depende de la duración del video).`;
    };
    tick();
    this.timer = window.setInterval(tick, 500);

    // 3. Solicitud real al backend y 4. detección real de éxito/error.
    const mode = (this.el.querySelector('.mode-mp3') as HTMLInputElement).checked ? 'mp3' : 'original';
    const outcome = await requestAudio(check.url, mode);
    window.clearInterval(this.timer);
    this.setBusy(false);
    this.statusEl.hidden = true;

    if (!outcome.ok) {
      this.showError(outcome.error, outcome.detail);
      this.toast(outcome.error, 'error');
      return;
    }

    // 5. Descarga real del MP3 (automática + enlace manual persistente).
    this.resultEl.hidden = false;
    this.downloadLink.querySelector('.convert-filename')!.textContent = outcome.fileName;
    this.resultMeta.textContent =
      `${outcome.durationSec !== null ? `${formatTime(outcome.durationSec)} · ` : ''}${formatBytes(outcome.sizeBytes)}` +
      ` · ${[outcome.quality.format, outcome.quality.bitrateKbps != null ? `${outcome.quality.bitrateKbps} kbps` : null, outcome.quality.codec ?? null].filter(Boolean).join(' · ')}` +
      (outcome.quality.preserved ? ' · original conservado' : ' · re-codificado a MP3 320');
    this.lastBlob = outcome.blob;
    this.lastInfo = {
      fileName: outcome.fileName,
      title: outcome.title,
      durationSec: outcome.durationSec,
      sourceUrl: this.input.value.trim(),
      quality: outcome.quality,
    };
    this.inLibrary = false;
    this.libraryBtn.disabled = false;
    this.libraryBtn.classList.remove('added');
    this.libraryBtn.textContent = '＋ Añadir a la biblioteca';

    let objectUrl: string | null = null;
    try {
      objectUrl = startDownload(outcome.blob, outcome.fileName);
    } catch {
      this.showError('No se pudo iniciar la descarga automática. Usa el botón "Descargar".');
    }
    if (objectUrl) {
      if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = objectUrl;
      this.downloadLink.href = objectUrl;
      this.downloadLink.download = outcome.fileName;
      this.toast(`"${outcome.title}" convertido (${formatBytes(outcome.sizeBytes)}) — descarga iniciada.`, 'ok');
    }
  }

  /** Manda el MP3 convertido a la biblioteca local (misma vía que un archivo importado). */
  private async addToLibrary(): Promise<void> {
    if (!this.lastBlob || !this.lastInfo || this.inLibrary) return;
    this.libraryBtn.disabled = true;
    this.libraryBtn.textContent = '⏳ Añadiendo…';
    try {
      await this.cb.onAddToLibrary(this.lastBlob, this.lastInfo);
      this.inLibrary = true;
      this.libraryBtn.textContent = '✓ En la biblioteca';
      this.libraryBtn.classList.add('added');
    } catch (error) {
      console.error(error);
      this.libraryBtn.disabled = false;
      this.libraryBtn.textContent = '＋ Añadir a la biblioteca';
      const message = error instanceof Error ? error.message : String(error);
      this.showError(`No se pudo añadir a la biblioteca: ${message}`);
      this.toast('No se pudo añadir a la biblioteca.', 'error');
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.button.disabled = busy;
    this.button.textContent = busy ? '⏳ Convirtiendo…' : '⤓ Convertir a MP3';
    this.input.disabled = busy;
  }

  private showError(message: string, detail?: string): void {
    this.errorEl.hidden = false;
    this.errorEl.textContent = message;
    if (detail) {
      const span = document.createElement('span');
      span.className = 'detail';
      span.textContent = detail;
      this.errorEl.appendChild(span);
    }
  }

  private hideMessages(): void {
    this.errorEl.hidden = true;
    this.errorEl.textContent = '';
    this.resultEl.hidden = true;
    this.lastBlob = null;
    this.lastInfo = null;
    this.inLibrary = false;
    this.libraryBtn.classList.remove('added');
  }
}
