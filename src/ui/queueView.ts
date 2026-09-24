import type { TrackMeta } from '../library/library.js';
import { formatBpm, formatTime } from '../util/format.js';

export interface QueueCallbacks {
  onNext(): void;
  onRemove(trackId: string): void;
  onMove(trackId: string, delta: -1 | 1): void;
  onClear(): void;
  onSaveAsPlaylist(name: string): void;
  onAutoToggle(auto: boolean): void;
}

/** Cola de reproducción: preparar la próxima mezcla con orden real persistido. */
export class QueueView {
  readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly autoCheckbox: HTMLInputElement;
  private auto = true;

  constructor(
    private readonly cb: QueueCallbacks,
    private readonly toast: (msg: string, kind?: 'info' | 'error' | 'ok') => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'queue-view panel-view';
    this.el.innerHTML = `
      <div class="panel-head">
        <button class="btn btn-next" aria-label="Cargar y reproducir la siguiente de la cola">▶ Reproducir siguiente</button>
        <label class="panel-check"><input class="queue-auto" type="checkbox" checked> Auto (al terminar una pista)</label>
        <button class="btn btn-mini queue-clear" aria-label="Vaciar la cola">🗑 Vaciar</button>
        <input class="queue-name" type="text" placeholder="Nombre de playlist" maxlength="60" aria-label="Nombre para guardar la cola">
        <button class="btn btn-mini queue-save" aria-label="Guardar la cola como playlist">💾 Guardar como playlist</button>
      </div>
      <ul class="queue-list" aria-label="Pistas en cola"></ul>
      <div class="panel-empty queue-empty" hidden>La cola está vacía: añade pistas desde la Biblioteca con "＋ Cola".</div>
    `;
    this.listEl = this.el.querySelector('.queue-list') as HTMLUListElement;
    this.autoCheckbox = this.el.querySelector('.queue-auto') as HTMLInputElement;
    this.el.querySelector('.btn-next')!.addEventListener('click', () => this.cb.onNext());
    this.el.querySelector('.queue-clear')!.addEventListener('click', () => this.cb.onClear());
    this.el.querySelector('.queue-save')!.addEventListener('click', () => {
      const input = this.el.querySelector('.queue-name') as HTMLInputElement;
      const name = input.value.trim();
      if (!name) {
        this.toast('Escribe un nombre para la playlist.', 'error');
        return;
      }
      input.value = '';
      this.cb.onSaveAsPlaylist(name);
    });
    this.autoCheckbox.addEventListener('change', () => {
      this.auto = this.autoCheckbox.checked;
      this.cb.onAutoToggle(this.auto);
    });
  }

  render(tracks: readonly TrackMeta[], queue: readonly string[], loadedIds: Record<'A' | 'B', string | null>): void {
    this.listEl.textContent = '';
    (this.el.querySelector('.queue-empty') as HTMLElement).hidden = queue.length > 0;
    queue.forEach((trackId, index) => {
      const track = tracks.find((t) => t.id === trackId);
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'queue-name-cell';
      label.textContent = track
        ? `${index + 1}. ${track.title} — ${track.artist} · ${formatBpm(track.bpm)} BPM · ${formatTime(track.durationSec)}`
        : `${index + 1}. (pista eliminada)`;
      li.appendChild(label);

      const controls = document.createElement('span');
      controls.className = 'queue-controls';
      const mk = (text: string, title: string, disabled: boolean, fn: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.className = 'btn btn-mini';
        b.textContent = text;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.disabled = disabled;
        b.addEventListener('click', fn);
        return b;
      };
      controls.append(
        mk('↑', 'Subir en la cola', index === 0, () => this.cb.onMove(trackId, -1)),
        mk('↓', 'Bajar en la cola', index === queue.length - 1, () => this.cb.onMove(trackId, 1)),
        mk('▶', 'Cargar ahora', false, () => this.cb.onNext()),
        mk('✕', 'Quitar de la cola', false, () => this.cb.onRemove(trackId)),
      );
      li.appendChild(controls);
      if (Object.values(loadedIds).includes(trackId)) li.classList.add('loaded');
      this.listEl.appendChild(li);
    });
  }
}
