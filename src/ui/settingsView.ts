export interface SettingsCallbacks {
  onResetMixer(): void;
  onExportLibrary(): void;
}

export class SettingsView {
  readonly el: HTMLElement;
  private readonly storageKindEl: HTMLElement;
  private readonly storageUsageEl: HTMLElement;
  private readonly audioStateEl: HTMLElement;
  private readonly audioRateEl: HTMLElement;

  constructor(cb: SettingsCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'settings-view panel-view';
    this.el.innerHTML = `
      <div class="panel-head">
        <span class="panel-hint">Diagnóstico del sistema, almacenamiento, motor de audio y preferencias.</span>
      </div>
      <div class="settings-grid">
        <section class="settings-card">
          <h3>💾 Almacenamiento Local</h3>
          <p class="settings-desc">AudioLad Studio almacena los audios y metadatos en tu dispositivo para garantizar privacidad y trabajo sin conexión.</p>
          <div class="settings-metric">
            <span class="metric-label">Mecanismo activo:</span>
            <span class="metric-val storage-kind">—</span>
          </div>
          <div class="settings-metric">
            <span class="metric-label">Espacio estimado:</span>
            <span class="metric-val storage-usage">Calculando…</span>
          </div>
          <div class="settings-actions">
            <button class="btn btn-mini btn-export-lib" aria-label="Exportar biblioteca">📥 Exportar metadatos (JSON)</button>
          </div>
        </section>

        <section class="settings-card">
          <h3>🔊 Motor de Audio Web Audio</h3>
          <p class="settings-desc">Cadena de procesamiento interna con AudioContext de 32 bits en coma flotante.</p>
          <div class="settings-metric">
            <span class="metric-label">Estado del contexto:</span>
            <span class="metric-val audio-state">En espera de interacción</span>
          </div>
          <div class="settings-metric">
            <span class="metric-label">Frecuencia de muestreo:</span>
            <span class="metric-val audio-rate">—</span>
          </div>
          <div class="settings-actions">
            <button class="btn btn-mini btn-reset-mixer" aria-label="Restablecer mezclador">↺ Restablecer faders y EQ</button>
          </div>
        </section>

        <section class="settings-card shortcuts-card">
          <h3>⌨️ Atajos de Teclado</h3>
          <div class="shortcuts-table-wrap">
            <table class="shortcuts-table" aria-label="Atajos de teclado de AudioLad Studio">
              <thead>
                <tr><th>Tecla</th><th>Acción en cabina</th></tr>
              </thead>
              <tbody>
                <tr><td><kbd>Q</kbd></td><td>Play / Pausa Deck A</td></tr>
                <tr><td><kbd>P</kbd></td><td>Play / Pausa Deck B</td></tr>
                <tr><td><kbd>Espacio</kbd></td><td>Play / Pausa Deck activo (según Crossfader)</td></tr>
                <tr><td><kbd>1</kbd> – <kbd>8</kbd></td><td>Disparar / Fijar Hot Cue 1–8 en Deck activo</td></tr>
                <tr><td><kbd>Alt</kbd> + Clic</td><td>Borrar Hot Cue seleccionado</td></tr>
                <tr><td><kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd></td><td>Disparar pads del Sampler en vivo</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    this.storageKindEl = this.el.querySelector('.storage-kind') as HTMLElement;
    this.storageUsageEl = this.el.querySelector('.storage-usage') as HTMLElement;
    this.audioStateEl = this.el.querySelector('.audio-state') as HTMLElement;
    this.audioRateEl = this.el.querySelector('.audio-rate') as HTMLElement;

    this.el.querySelector('.btn-reset-mixer')?.addEventListener('click', () => {
      cb.onResetMixer();
    });
    this.el.querySelector('.btn-export-lib')?.addEventListener('click', () => {
      cb.onExportLibrary();
    });

    this.updateStorageEstimate();
  }

  setStorageKind(kind: 'opfs' | 'indexeddb' | 'memory'): void {
    const labels: Record<'opfs' | 'indexeddb' | 'memory', string> = {
      opfs: 'OPFS (Origin Private File System — Máximo rendimiento)',
      indexeddb: 'IndexedDB (Persistencia nativa del navegador)',
      memory: 'Memoria RAM (Volátil: OPFS/IDB no disponibles)',
    };
    this.storageKindEl.textContent = labels[kind] ?? kind;
  }

  updateAudioEngineInfo(ctx: AudioContext | null): void {
    if (!ctx) {
      this.audioStateEl.textContent = 'En espera de primer gesto';
      this.audioRateEl.textContent = '—';
      return;
    }
    const stateMap: Record<string, string> = {
      running: 'Activo (Running)',
      suspended: 'Suspendido (ahorro de energía)',
      closed: 'Cerrado',
      interrupted: 'Interrumpido (sistema)',
    };
    this.audioStateEl.textContent = stateMap[ctx.state] ?? String(ctx.state);
    this.audioRateEl.textContent = `${ctx.sampleRate.toLocaleString()} Hz`;
  }

  async updateStorageEstimate(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usedMb = est.usage ? (est.usage / (1024 * 1024)).toFixed(1) : '0';
        const quotaMb = est.quota ? (est.quota / (1024 * 1024)).toFixed(0) : '—';
        this.storageUsageEl.textContent = `${usedMb} MB en uso (cuota disponible: ~${quotaMb} MB)`;
      } catch {
        this.storageUsageEl.textContent = 'Información no provista por el navegador';
      }
    } else {
      this.storageUsageEl.textContent = 'No soportado en este navegador';
    }
  }
}
