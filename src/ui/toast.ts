export type ToastKind = 'info' | 'error' | 'ok';

/** Fire-and-forget toast. Errors stay a bit longer. */
export function showToast(container: HTMLElement, message: string, kind: ToastKind = 'info'): void {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  const ttl = kind === 'error' ? 6000 : 3500;
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 300);
  }, ttl);
}
