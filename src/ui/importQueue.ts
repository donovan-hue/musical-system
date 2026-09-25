export type QueueItemState = 'pendiente' | 'procesando' | 'completada' | 'error';

export interface QueueItem {
  id: string;
  label: string;
  state: QueueItemState;
  detail?: string;
}

/**
 * Progreso de importación por lotes: cada pista con su estado real
 * (Pista 1 — completada, Pista 2 — procesando, …). Un error en un ítem no
 * cancela los demás.
 */
export class ImportQueueView {
  readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly headEl: HTMLElement;
  private items: QueueItem[] = [];

  constructor() {
    this.el = document.createElement('section');
    this.el.className = 'import-queue';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="iq-head">
        <h3>Importación por lotes</h3>
        <button class="btn btn-mini iq-clear" type="button" title="Ocultar">✕</button>
      </div>
      <div class="iq-summary"></div>
      <ul class="iq-list"></ul>
    `;
    this.headEl = this.el.querySelector('.iq-summary') as HTMLElement;
    this.listEl = this.el.querySelector('.iq-list') as HTMLElement;
    (this.el.querySelector('.iq-clear') as HTMLButtonElement).addEventListener('click', () => {
      this.el.hidden = true;
    });
  }

  begin(labels: string[]): void {
    this.items = labels.map((label, index) => ({ id: String(index), label, state: 'pendiente' }));
    this.el.hidden = this.items.length === 0;
    this.render();
  }

  set(id: string, state: QueueItemState, detail?: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.state = state;
    item.detail = detail;
    this.render();
  }

  /** Una pista recién importada añade su fila al vuelo (flujos dinámicos). */
  push(label: string, state: QueueItemState, detail?: string): string {
    const id = `i${this.items.length}_${Date.now().toString(36)}`;
    this.items.push({ id, label, state, detail });
    this.el.hidden = false;
    this.render();
    return id;
  }

  clear(): void {
    this.items = [];
    this.el.hidden = true;
    this.render();
  }

  private render(): void {
    const counts = { pendiente: 0, procesando: 0, completada: 0, error: 0 } as Record<QueueItemState, number>;
    for (const item of this.items) counts[item.state] += 1;
    this.headEl.textContent =
      this.items.length === 0
        ? ''
        : `${this.items.length} pistas · ${counts.completada} completadas · ${counts.procesando} en proceso · ${counts.pendiente} pendientes · ${counts.error} con error`;
    this.listEl.textContent = '';
    this.items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = `iq-item iq-${item.state}`;
      const icon = { pendiente: '•', procesando: '⏳', completada: '✓', error: '✗' }[item.state];
      const line = document.createElement('span');
      line.className = 'iq-label';
      line.textContent = `Pista ${index + 1} — ${item.label}${item.detail ? ` · ${item.detail}` : ''}`;
      li.append(el('span', 'iq-icon', icon), line);
      this.listEl.appendChild(li);
    });
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
