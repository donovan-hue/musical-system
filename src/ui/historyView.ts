import type { HistoryEvent, RecordingMeta, TrackMeta } from '../library/library.js';
import { formatBpm, formatTime } from '../util/format.js';

export interface HistoryCallbacks {
  onClear(): void;
}

/** Historial: sesiones grabadas + pistas reproducidas + conversiones. */
export class HistoryView {
  readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private tracks: readonly TrackMeta[] = [];
  private recordings: readonly RecordingMeta[] = [];

  constructor(cb: HistoryCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'history-view panel-view';
    this.el.innerHTML = `
      <div class="panel-head">
        <span class="panel-hint">Sesiones, mezclas y conversiones recientes (persistidas).</span>
        <button class="btn btn-mini history-clear" aria-label="Borrar el historial">🗑 Borrar historial</button>
      </div>
      <ul class="history-list" aria-label="Historial"></ul>
      <div class="panel-empty history-empty" hidden>Sin actividad todavía: reproduce, graba o convierte.</div>
    `;
    this.listEl = this.el.querySelector('.history-list') as HTMLUListElement;
    this.emptyEl = this.el.querySelector('.history-empty') as HTMLElement;
    this.el.querySelector('.history-clear')!.addEventListener('click', () => cb.onClear());
  }

  render(events: readonly HistoryEvent[], tracks: readonly TrackMeta[], recordings: readonly RecordingMeta[]): void {
    this.tracks = tracks;
    this.recordings = recordings;
    this.listEl.textContent = '';
    this.emptyEl.hidden = events.length > 0;
    for (const event of events) {
      const li = document.createElement('li');
      li.className = `history-item history-${event.type}`;
      if (event.type === 'played') {
        const track = this.tracks.find((t) => t.id === event.trackId);
        li.innerHTML = `<span class="hi-icon">🎧</span><span class="hi-body">
          <b>${track?.title ?? 'Pista eliminada'}</b> — Deck ${event.deck} · ${formatBpm(track?.bpm)} BPM · ${formatTime(event.seconds)} reproducidos
          <small>${new Date(event.at).toLocaleString()}</small></span>`;
      } else {
        li.innerHTML = `<span class="hi-icon">⤓</span><span class="hi-body">
          <b>Conversión</b> — ${event.title} → ${event.fileName}
          <small>${new Date(event.at).toLocaleString()} · ${event.url}</small></span>`;
      }
      this.listEl.appendChild(li);
    }
  }

  /** Sesiones grabadas disponibles (para el resumen del encabezado). */
  recordingCount(): number {
    return this.recordings.length;
  }
}
