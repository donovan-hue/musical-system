import type { DeckId } from '../audio/deck.js';
import type { Playlist, TrackMeta } from '../library/library.js';
import { formatBpm, formatBytes, formatTime } from '../util/format.js';

export interface LibraryCallbacks {
  onImportFiles(files: File[]): void;
  onLoadToDeck(trackId: string, deckId: DeckId): void;
  onSelectTrack(trackId: string): void;
  onRemoveTrack(trackId: string): void;
  onCreatePlaylist(name: string): void;
  onDeletePlaylist(playlistId: string): void;
  onAddToPlaylist(playlistId: string, trackId: string): void;
  onRemoveFromPlaylist(playlistId: string, trackId: string): void;
  onMove(playlistId: string, trackId: string, delta: -1 | 1): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, title?: string): HTMLButtonElement {
  const btn = el('button', className, text);
  if (title) btn.title = title;
  return btn;
}

/** Library table + playlist manager. Re-renders on demand from plain data. */
export class LibraryView {
  readonly el: HTMLElement;
  private readonly cb: LibraryCallbacks;
  private readonly fileInput: HTMLInputElement;
  private readonly tableBody: HTMLElement;
  private readonly playlistList: HTMLElement;
  private readonly playlistTracks: HTMLElement;
  private readonly playlistTitle: HTMLElement;
  private readonly emptyRow: HTMLElement;
  private readonly backendBadge: HTMLElement;

  private tracks: readonly TrackMeta[] = [];
  private playlists: readonly Playlist[] = [];
  private activePlaylistId: string | null = null;
  private selectedTrackId: string | null = null;
  private loadedDeckIds: Record<DeckId, string | null> = { A: null, B: null };

  constructor(cb: LibraryCallbacks) {
    this.cb = cb;
    this.el = el('section', 'library');
    this.el.innerHTML = `
      <div class="lib-head">
        <h2>Biblioteca</h2>
        <span class="backend-badge"></span>
        <span class="lib-hint">La última selección no se carga sola: usa → A o → B.</span>
        <button class="btn btn-import">⬆ Importar audio…</button>
        <input class="file-input" type="file" multiple hidden
          accept="audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.flac,.aac,.aif,.aiff">
      </div>
      <div class="lib-body">
        <div class="tracks-wrap">
          <table class="tracks">
            <thead>
              <tr><th>Título</th><th>Artista</th><th>BPM</th><th>Duración</th><th>Tamaño</th><th class="th-actions">A Deck / Quitar</th></tr>
            </thead>
            <tbody></tbody>
          </table>
          <div class="empty-row">Aún no hay pistas. Importa un MP3/WAV para empezar.</div>
        </div>
        <aside class="playlists">
          <h3>Playlists</h3>
          <div class="playlist-create">
            <input class="playlist-name" type="text" placeholder="Nombre de playlist" maxlength="60">
            <button class="btn btn-mini playlist-create-btn">Crear</button>
          </div>
          <ul class="playlist-list"></ul>
          <div class="playlist-detail">
            <div class="playlist-detail-head">
              <span class="playlist-title">Sin playlist</span>
              <button class="btn btn-mini playlist-add" disabled title="Añadir la pista seleccionada">＋ Añadir selección</button>
              <button class="btn btn-mini playlist-delete" disabled>🗑</button>
            </div>
            <ul class="playlist-tracks"></ul>
          </div>
        </aside>
      </div>
    `;
    this.tableBody = this.el.querySelector('.tracks tbody') as HTMLTableSectionElement;
    this.playlistList = this.el.querySelector('.playlist-list') as HTMLUListElement;
    this.playlistTracks = this.el.querySelector('.playlist-tracks') as HTMLUListElement;
    this.playlistTitle = this.el.querySelector('.playlist-title') as HTMLElement;
    this.emptyRow = this.el.querySelector('.empty-row') as HTMLElement;
    this.backendBadge = this.el.querySelector('.backend-badge') as HTMLElement;
    this.fileInput = this.el.querySelector('.file-input') as HTMLInputElement;

    const importBtn = this.el.querySelector('.btn-import') as HTMLButtonElement;
    importBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const files = [...this.fileInput.files ?? []];
      this.fileInput.value = '';
      if (files.length > 0) this.cb.onImportFiles(files);
    });

    const nameInput = this.el.querySelector('.playlist-name') as HTMLInputElement;
    const createBtn = this.el.querySelector('.playlist-create-btn') as HTMLButtonElement;
    const submit = () => {
      const name = nameInput.value.trim();
      if (name.length === 0) return;
      nameInput.value = '';
      this.cb.onCreatePlaylist(name);
    };
    createBtn.addEventListener('click', submit);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    const addBtn = this.el.querySelector('.playlist-add') as HTMLButtonElement;
    addBtn.addEventListener('click', () => {
      if (this.selectedTrackId && this.activePlaylistId) {
        this.cb.onAddToPlaylist(this.activePlaylistId!, this.selectedTrackId);
      }
    });
    const deleteBtn = this.el.querySelector('.playlist-delete') as HTMLButtonElement;
    deleteBtn.addEventListener('click', () => {
      if (this.activePlaylistId) this.cb.onDeletePlaylist(this.activePlaylistId);
    });
  }

  setBackend(kind: string): void {
    this.backendBadge.textContent =
      kind === 'opfs' ? 'Almacenamiento: OPFS' : kind === 'indexeddb' ? 'Almacenamiento: IndexedDB' : 'Almacenamiento: memoria';
  }

  setLoadedDecks(loaded: Record<DeckId, string | null>): void {
    this.loadedDeckIds = loaded;
    this.renderTracks();
  }

  render(tracks: readonly TrackMeta[], playlists: readonly Playlist[]): void {
    this.tracks = tracks;
    this.playlists = playlists;
    if (this.activePlaylistId && !playlists.some((p) => p.id === this.activePlaylistId)) {
      this.activePlaylistId = null;
    }
    this.renderTracks();
    this.renderPlaylists();
  }

  private renderTracks(): void {
    this.tableBody.textContent = '';
    this.emptyRow.style.display = this.tracks.length === 0 ? 'block' : 'none';
    for (const track of this.tracks) {
      const row = el('tr');
      row.className = track.id === this.selectedTrackId ? 'selected' : '';
      row.addEventListener('click', () => {
        this.selectedTrackId = track.id;
        this.cb.onSelectTrack(track.id);
        this.renderTracks();
      });

      const title = el('td', 'td-title', track.title);
      title.title = track.fileName;
      row.appendChild(title);
      row.appendChild(el('td', '', track.artist));
      row.appendChild(el('td', 'td-bpm', `${formatBpm(track.bpm)}${track.bpm ? bpmBadge(track.bpmSource) : ''}`));
      row.appendChild(el('td', '', formatTime(track.durationSec)));
      row.appendChild(el('td', '', formatBytes(track.sizeBytes)));

      const actions = el('td', 'td-actions');
      for (const deckId of ['A', 'B'] as const) {
        const btn = button(`btn btn-mini load-${deckId.toLowerCase()}`, `→ ${deckId}`, `Cargar en Deck ${deckId}`);
        if (this.loadedDeckIds[deckId] === track.id) btn.classList.add('active');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cb.onLoadToDeck(track.id, deckId);
        });
        actions.appendChild(btn);
      }
      const removeBtn = button('btn btn-mini track-remove', '✕', 'Quitar de la biblioteca');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onRemoveTrack(track.id);
      });
      actions.appendChild(removeBtn);
      row.appendChild(actions);
      this.tableBody.appendChild(row);
    }
  }

  private renderPlaylists(): void {
    this.playlistList.textContent = '';
    for (const playlist of this.playlists) {
      const li = el('li', playlist.id === this.activePlaylistId ? 'active' : '');
      const label = el('span', '', `${playlist.name} (${playlist.trackIds.length})`);
      label.addEventListener('click', () => {
        this.activePlaylistId = playlist.id;
        this.renderPlaylists();
      });
      li.appendChild(label);
      this.playlistList.appendChild(li);
    }

    const active = this.playlists.find((p) => p.id === this.activePlaylistId) ?? null;
    this.playlistTitle.textContent = active ? active.name : 'Sin playlist';
    const addBtn = this.el.querySelector('.playlist-add') as HTMLButtonElement;
    const deleteBtn = this.el.querySelector('.playlist-delete') as HTMLButtonElement;
    addBtn.disabled = !active || !this.selectedTrackId;
    deleteBtn.disabled = !active;

    this.playlistTracks.textContent = '';
    if (!active) return;
    active.trackIds.forEach((trackId, index) => {
      const track = this.tracks.find((t) => t.id === trackId);
      const li = el('li');
      li.appendChild(el('span', 'pt-name', track ? track.title : '(pista eliminada)'));
      const controls = el('span', 'pt-controls');
      const up = button('btn btn-mini', '↑', 'Subir');
      up.disabled = index === 0;
      up.addEventListener('click', () => this.cb.onMove(active.id, trackId, -1));
      const down = button('btn btn-mini', '↓', 'Bajar');
      down.disabled = index === active.trackIds.length - 1;
      down.addEventListener('click', () => this.cb.onMove(active.id, trackId, 1));
      const remove = button('btn btn-mini', '✕', 'Quitar de la playlist');
      remove.addEventListener('click', () => this.cb.onRemoveFromPlaylist(active.id, trackId));
      controls.append(up, down, remove);
      li.appendChild(controls);
      this.playlistTracks.appendChild(li);
    });
  }
}

function bpmBadge(source: string): string {
  const label = { tag: ' TAG', estimated: ' EST', manual: ' MAN' }[source] ?? '';
  return label;
}
