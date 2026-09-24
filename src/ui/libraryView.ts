import type { DeckId } from '../audio/deck.js';
import type { Playlist, TrackMeta } from '../library/library.js';
import { formatBpm, formatBytes, formatTime } from '../util/format.js';
import { formatKey } from '../audio/key.js';

export type LibrarySort = 'added' | 'title' | 'artist' | 'bpm' | 'duration';

export interface LibraryCallbacks {
  onImportFiles(files: File[]): void;
  onLoadToDeck(trackId: string, deckId: DeckId): void;
  /** Previsualizar: carga en un deck libre y reproduce (doble clic). */
  onPreview(trackId: string): void;
  onRemoveTrack(trackId: string): void;
  onToggleFavorite(trackId: string): void;
  onEnqueue(trackId: string): void;
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

/** Tabla de biblioteca con búsqueda, orden, favoritos y playlists. */
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
  private readonly searchInput: HTMLInputElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly favOnly: HTMLInputElement;

  private tracks: readonly TrackMeta[] = [];
  private playlists: readonly Playlist[] = [];
  private activePlaylistId: string | null = null;
  private selectedTrackId: string | null = null;
  private loadedDeckIds: Record<DeckId, string | null> = { A: null, B: null };
  private queueIds: readonly string[] = [];

  constructor(cb: LibraryCallbacks) {
    this.cb = cb;
    this.el = el('div', 'library-view panel-view');
    this.el.innerHTML = `
      <div class="lib-head">
        <input class="lib-search" type="search" placeholder="Buscar título, artista, álbum, género…" aria-label="Buscar en la biblioteca">
        <label class="lib-fav"><input class="lib-fav-only" type="checkbox" aria-label="Mostrar solo favoritas"> ★ solo favoritas</label>
        <label class="lib-sort">Orden
          <select class="lib-sort-select" aria-label="Ordenar por">
            <option value="added">Recientes</option>
            <option value="title">Título</option>
            <option value="artist">Artista</option>
            <option value="bpm">BPM</option>
            <option value="duration">Duración</option>
          </select>
        </label>
        <span class="backend-badge"></span>
        <button class="btn btn-import" aria-label="Importar archivos de audio">⬆ Importar audio…</button>
        <input class="file-input" type="file" multiple hidden accept="audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.flac,.aac,.aif,.aiff">
      </div>
      <div class="lib-body">
        <div class="tracks-wrap">
          <table class="tracks">
            <thead>
              <tr>
                <th class="th-fav">★</th>
                <th class="th-art" aria-label="Carátula"></th>
                <th>Título / Artista</th>
                <th class="th-key">Tono</th>
                <th>BPM</th>
                <th class="th-genre">Género</th>
                <th>Dur.</th>
                <th class="th-size">Tam.</th>
                <th class="th-actions">A Deck · Cola · Playlist</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
          <div class="empty-row">Aún no hay pistas. Importa un MP3/WAV o convierte una URL.</div>
        </div>
        <aside class="playlists">
          <h3>Playlists</h3>
          <div class="playlist-create">
            <input class="playlist-name" type="text" placeholder="Nombre de playlist" maxlength="60" aria-label="Nombre de playlist">
            <button class="btn btn-mini playlist-create-btn" aria-label="Crear playlist">Crear</button>
          </div>
          <ul class="playlist-list"></ul>
          <div class="playlist-detail">
            <div class="playlist-detail-head">
              <span class="playlist-title">Sin playlist</span>
              <button class="btn btn-mini playlist-add" disabled title="Añadir la pista seleccionada" aria-label="Añadir la pista seleccionada a la playlist">＋ Añadir</button>
              <button class="btn btn-mini playlist-delete" disabled aria-label="Eliminar playlist">🗑</button>
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
    this.searchInput = this.el.querySelector('.lib-search') as HTMLInputElement;
    this.sortSelect = this.el.querySelector('.lib-sort-select') as HTMLSelectElement;
    this.favOnly = this.el.querySelector('.lib-fav-only') as HTMLInputElement;

    const importBtn = this.el.querySelector('.btn-import') as HTMLButtonElement;
    importBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const files = [...this.fileInput.files ?? []];
      this.fileInput.value = '';
      if (files.length > 0) this.cb.onImportFiles(files);
    });

    this.searchInput.addEventListener('input', () => this.renderTracks());
    this.sortSelect.addEventListener('change', () => this.renderTracks());
    this.favOnly.addEventListener('change', () => this.renderTracks());

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
        this.cb.onAddToPlaylist(this.activePlaylistId, this.selectedTrackId);
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

  setLoadedDecks(loaded: Record<DeckId, string | null>, queueIds: readonly string[] = this.queueIds): void {
    this.loadedDeckIds = loaded;
    this.queueIds = queueIds;
    this.renderTracks();
  }

  render(tracks: readonly TrackMeta[], playlists: readonly Playlist[], queueIds: readonly string[]): void {
    this.tracks = tracks;
    this.playlists = playlists;
    this.queueIds = queueIds;
    if (this.activePlaylistId && !playlists.some((p) => p.id === this.activePlaylistId)) {
      this.activePlaylistId = null;
    }
    this.renderTracks();
    this.renderPlaylists();
  }

  private visibleTracks(): TrackMeta[] {
    const query = this.searchInput.value.trim().toLowerCase();
    let list = [...this.tracks];
    if (query) {
      list = list.filter((t) =>
        [t.title, t.artist, t.album, t.genre ?? '', t.fileName].some((f) => f.toLowerCase().includes(query)),
      );
    }
    if (this.favOnly.checked) list = list.filter((t) => t.favorite);
    const sort = this.sortSelect.value as LibrarySort;
    switch (sort) {
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'artist':
        list.sort((a, b) => a.artist.localeCompare(b.artist));
        break;
      case 'bpm':
        list.sort((a, b) => (a.bpm ?? 9999) - (b.bpm ?? 9999));
        break;
      case 'duration':
        list.sort((a, b) => a.durationSec - b.durationSec);
        break;
      default:
        list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }
    return list;
  }

  private renderTracks(): void {
    this.tableBody.textContent = '';
    const visible = this.visibleTracks();
    this.emptyRow.style.display = this.tracks.length === 0 ? 'block' : 'none';
    if (this.tracks.length > 0 && visible.length === 0) {
      this.emptyRow.textContent = 'Ninguna pista coincide con la búsqueda.';
      this.emptyRow.style.display = 'block';
    } else {
      this.emptyRow.textContent = 'Aún no hay pistas. Importa un MP3/WAV o convierte una URL.';
    }

    for (const track of visible) {
      const row = el('tr');
      row.className = track.id === this.selectedTrackId ? 'selected' : '';
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${track.title} de ${track.artist}`);
      const select = (): void => {
        this.selectedTrackId = track.id;
        this.renderTracks();
        this.renderPlaylists();
      };
      row.addEventListener('click', select);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') select();
        if (e.key === ' ') {
          e.preventDefault();
          this.cb.onPreview(track.id);
        }
      });
      row.addEventListener('dblclick', () => this.cb.onPreview(track.id));

      // Favorito
      const favTd = el('td', 'td-fav');
      const favBtn = button('btn btn-mini fav-btn', track.favorite ? '★' : '☆', track.favorite ? 'Quitar de favoritas' : 'Marcar como favorita');
      favBtn.classList.toggle('active', !!track.favorite);
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onToggleFavorite(track.id);
      });
      favTd.appendChild(favBtn);
      row.appendChild(favTd);

      // Artwork
      const artTd = el('td', 'td-art');
      if (track.artwork) {
        const img = document.createElement('img');
        img.src = track.artwork;
        img.alt = '';
        img.className = 'lib-artwork';
        artTd.appendChild(img);
      } else {
        artTd.appendChild(el('span', 'lib-artwork lib-artwork-empty', track.title.charAt(0).toUpperCase()));
      }
      row.appendChild(artTd);

      const titleTd = el('td', 'td-title');
      titleTd.appendChild(el('b', '', track.title));
      titleTd.appendChild(el('small', 'td-artist', track.artist));
      titleTd.title = `${track.fileName}${track.album ? ` · ${track.album}` : ''}${track.date ? ` · ${track.date}` : ''}`;
      row.appendChild(titleTd);

      row.appendChild(el('td', 'td-key', formatKey(track.key)));
      row.appendChild(el('td', 'td-bpm', `${formatBpm(track.bpm)}${track.bpm ? bpmBadge(track.bpmSource) : ''}`));
      row.appendChild(el('td', 'td-genre', track.genre ?? ''));
      row.appendChild(el('td', '', formatTime(track.durationSec)));
      row.appendChild(el('td', 'td-size', formatBytes(track.sizeBytes)));

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
      const inQueue = this.queueIds.includes(track.id);
      const queueBtn = button('btn btn-mini queue-btn', inQueue ? '✓ Cola' : '＋ Cola', inQueue ? 'Ya está en la cola' : 'Añadir a la cola');
      queueBtn.disabled = inQueue;
      queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onEnqueue(track.id);
      });
      actions.appendChild(queueBtn);
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
  return { tag: ' TAG', estimated: ' EST', manual: ' MAN' }[source] ?? '';
}
