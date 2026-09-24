import type { RecordingMeta } from '../library/library.js';
import { formatBytes, formatTime } from '../util/format.js';

export interface RecorderCallbacks {
  onRecordStart(): void | Promise<void>;
  onRecordPause(): void;
  onRecordResume(): void;
  /** Detiene y guarda con el nombre dado; devuelve el meta real guardado. */
  onRecordStopAndSave(name: string): Promise<RecordingMeta>;
  onDiscard(): Promise<void>;
  onDelete(recordingId: string): void;
}

type RecorderUiState = 'idle' | 'recording' | 'paused' | 'saving';

/**
 * Grabadora REAL del bus master (MediaRecorder sobre el stream de Web Audio).
 * Incluye lista de sesiones guardadas con reproducción y descarga real.
 */
export class RecorderView {
  readonly el: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly saveRow: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly listEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly cb: RecorderCallbacks;
  private readonly toast: (msg: string, kind?: 'info' | 'error' | 'ok') => void;

  private uiState: RecorderUiState = 'idle';
  private timer = 0;
  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt: number | null = null;
  private currentUrl: string | null = null;

  constructor(
    cb: RecorderCallbacks,
    toast: (msg: string, kind?: 'info' | 'error' | 'ok') => void,
    supported: boolean,
  ) {
    this.cb = cb;
    this.toast = toast;
    this.el = document.createElement('div');
    this.el.className = 'recorder-view panel-view';
    this.el.innerHTML = `
      <div class="panel-head">
        <span class="rec-state" role="status">● Lista</span>
        <span class="rec-timer">0:00</span>
        <button class="btn rec-start" aria-label="Iniciar grabación de la sesión">⏺ Grabar</button>
        <button class="btn rec-pause" disabled aria-label="Pausar grabación">⏸ Pausa</button>
        <button class="btn rec-stop" disabled aria-label="Detener grabación">⏹ Detener</button>
        <span class="panel-hint">Graba la salida master real (sin micrófono)${supported ? '' : ' — este navegador no soporta MediaRecorder de audio'}</span>
      </div>
      <div class="rec-save" hidden>
        <input class="rec-name" type="text" maxlength="80" placeholder="Nombre de la sesión" aria-label="Nombre de la sesión">
        <button class="btn btn-mini rec-save-btn" aria-label="Guardar la grabación">💾 Guardar sesión</button>
        <button class="btn btn-mini rec-discard" aria-label="Descartar la grabación">✕ Descartar</button>
      </div>
      <ul class="rec-list" aria-label="Grabaciones guardadas"></ul>
      <div class="panel-empty rec-empty" hidden>Aún no hay sesiones grabadas.</div>
    `;
    this.stateEl = this.el.querySelector('.rec-state') as HTMLElement;
    this.timerEl = this.el.querySelector('.rec-timer') as HTMLElement;
    this.startBtn = this.el.querySelector('.rec-start') as HTMLButtonElement;
    this.pauseBtn = this.el.querySelector('.rec-pause') as HTMLButtonElement;
    this.stopBtn = this.el.querySelector('.rec-stop') as HTMLButtonElement;
    this.saveRow = this.el.querySelector('.rec-save') as HTMLElement;
    this.nameInput = this.el.querySelector('.rec-name') as HTMLInputElement;
    this.listEl = this.el.querySelector('.rec-list') as HTMLUListElement;
    this.emptyEl = this.el.querySelector('.rec-empty') as HTMLElement;

    if (!supported) {
      this.startBtn.disabled = true;
      this.stateEl.textContent = '● MediaRecorder no disponible';
    }

    this.startBtn.addEventListener('click', () => void this.handleStart());
    this.pauseBtn.addEventListener('click', () => this.handlePause());
    this.stopBtn.addEventListener('click', () => void this.handleStop());
    this.el.querySelector('.rec-save-btn')!.addEventListener('click', () => void this.handleSave());
    this.el.querySelector('.rec-discard')!.addEventListener('click', () => void this.handleDiscard());
  }

  private async handleStart(): Promise<void> {
    try {
      await this.cb.onRecordStart();
      this.uiState = 'recording';
      this.startedAt = performance.now();
      this.pausedTotal = 0;
      this.pausedAt = null;
      this.saveRow.hidden = true;
      this.updateButtons();
      this.timer = window.setInterval(() => this.tick(), 500);
      this.tick();
    } catch (error) {
      this.toast(`Grabadora: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  private handlePause(): void {
    if (this.uiState === 'recording') {
      this.cb.onRecordPause();
      this.uiState = 'paused';
      this.pausedAt = performance.now();
    } else if (this.uiState === 'paused') {
      this.cb.onRecordResume();
      this.uiState = 'recording';
      if (this.pausedAt !== null) {
        this.pausedTotal += performance.now() - this.pausedAt;
        this.pausedAt = null;
      }
    }
    this.updateButtons();
  }

  private async handleStop(): Promise<void> {
    if (this.uiState !== 'recording' && this.uiState !== 'paused') return;
    window.clearInterval(this.timer);
    this.uiState = 'saving';
    this.updateButtons();
    this.saveRow.hidden = false;
    if (!this.nameInput.value.trim()) {
      const now = new Date();
      this.nameInput.value = `Sesión ${now.toLocaleDateString()} ${now.toLocaleTimeString().slice(0, 5)}`;
    }
    this.stateEl.textContent = '● Detenida — guarda o descarta';
  }

  private async handleSave(): Promise<void> {
    const name = this.nameInput.value.trim() || 'Sesión sin nombre';
    try {
      const meta = await this.cb.onRecordStopAndSave(name);
      this.toast(`Sesión "${meta.name}" guardada (${formatTime(meta.durationSec)}).`, 'ok');
      this.resetToIdle();
    } catch (error) {
      this.toast(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.uiState = 'idle';
      this.updateButtons();
    }
  }

  private async handleDiscard(): Promise<void> {
    await this.cb.onDiscard();
    this.toast('Grabación descartada.', 'info');
    this.resetToIdle();
  }

  private resetToIdle(): void {
    this.uiState = 'idle';
    this.saveRow.hidden = true;
    this.nameInput.value = '';
    this.updateButtons();
    this.stateEl.textContent = '● Lista';
    this.timerEl.textContent = '0:00';
  }

  private updateButtons(): void {
    this.startBtn.disabled = this.uiState !== 'idle';
    this.pauseBtn.disabled = !(this.uiState === 'recording' || this.uiState === 'paused');
    this.pauseBtn.textContent = this.uiState === 'paused' ? '▶ Continuar' : '⏸ Pausa';
    this.stopBtn.disabled = !(this.uiState === 'recording' || this.uiState === 'paused');
  }

  private tick(): void {
    const now = this.pausedAt ?? performance.now();
    const elapsed = Math.max(0, (now - this.startedAt - this.pausedTotal) / 1000);
    this.timerEl.textContent = formatTime(elapsed);
    this.stateEl.textContent = this.uiState === 'paused' ? '● En pausa' : '● GRABANDO';
    this.stateEl.classList.toggle('live', this.uiState === 'recording');
  }

  renderRecordings(recordings: readonly RecordingMeta[]): void {
    this.listEl.textContent = '';
    this.emptyEl.hidden = recordings.length > 0;
    for (const rec of recordings) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'rec-name-cell';
      label.textContent = `${rec.name} · ${new Date(rec.at).toLocaleString()} · ${formatTime(rec.durationSec)} · ${formatBytes(rec.sizeBytes)}`;
      li.appendChild(label);
      const controls = document.createElement('span');
      controls.className = 'rec-controls';
      const play = document.createElement('button');
      play.className = 'btn btn-mini';
      play.textContent = this.currentUrl ? '⏹' : '▶';
      play.title = 'Escuchar aquí';
      play.setAttribute('aria-label', `Reproducir ${rec.name}`);
      play.addEventListener('click', () => void this.togglePlayback(rec, play));
      const download = document.createElement('a');
      download.className = 'btn btn-mini';
      download.textContent = '⤓';
      download.title = 'Descargar';
      download.setAttribute('aria-label', `Descargar ${rec.name}`);
      download.href = '#';
      download.addEventListener('click', (e) => void this.handleDownload(e, rec, download));
      const del = document.createElement('button');
      del.className = 'btn btn-mini';
      del.textContent = '✕';
      del.title = 'Eliminar';
      del.setAttribute('aria-label', `Eliminar ${rec.name}`);
      del.addEventListener('click', () => this.cb.onDelete(rec.id));
      controls.append(play, download, del);
      li.appendChild(controls);
      this.listEl.appendChild(li);
    }
  }

  private async togglePlayback(rec: RecordingMeta, btn: HTMLButtonElement): Promise<void> {
    if (this.currentUrl) {
      const audio = document.querySelector('audio.rec-player') as HTMLAudioElement | null;
      audio?.pause();
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
      btn.textContent = '▶';
      return;
    }
    const audio = this.ensureAudio();
    try {
      const bytes = await this.requestBytes(rec.id);
      if (!bytes) {
        this.toast('No encontré los bytes de esa grabación.', 'error');
        return;
      }
      this.currentUrl = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: rec.mimeType }));
      audio.src = this.currentUrl;
      void audio.play();
      btn.textContent = '⏹';
      audio.onended = () => {
        btn.textContent = '▶';
      };
    } catch (error) {
      this.toast(`No se pudo reproducir: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  private async handleDownload(e: MouseEvent, rec: RecordingMeta, anchor: HTMLAnchorElement): Promise<void> {
    e.preventDefault();
    const bytes = await this.requestBytes(rec.id);
    if (!bytes) {
      this.toast('No encontré los bytes de esa grabación.', 'error');
      return;
    }
    const ext = rec.mimeType.includes('mp4') ? 'm4a' : rec.mimeType.includes('ogg') ? 'ogg' : 'webm';
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: rec.mimeType }));
    anchor.href = url;
    anchor.download = `${rec.name.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private requestBytes: (id: string) => Promise<Uint8Array | null> = () => Promise.resolve(null);

  /** main.ts inyecta el acceso real al store. */
  setBytesProvider(provider: (id: string) => Promise<Uint8Array | null>): void {
    this.requestBytes = provider;
  }

  private ensureAudio(): HTMLAudioElement {
    let audio = document.querySelector('audio.rec-player') as HTMLAudioElement | null;
    if (!audio) {
      audio = document.createElement('audio');
      audio.className = 'rec-player';
      audio.hidden = true;
      document.body.appendChild(audio);
    }
    return audio;
  }
}
