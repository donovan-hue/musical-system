/** Tema claro/oscuro reales: dos sistemas visuales completos sobre CSS vars. */
export type Theme = 'dark' | 'light';

const KEY = 'musical-system.theme';

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* sin localStorage: tema por defecto */
  }
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* persistencia no disponible */
  }
}

export function installThemeToggle(button: HTMLButtonElement, toast: (msg: string) => void): void {
  let theme = loadTheme();
  applyTheme(theme);
  const label = (): string => (theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro');
  button.textContent = label();
  button.setAttribute('aria-label', 'Cambiar entre modo claro y oscuro');
  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    button.textContent = label();
    toast(`Modo ${theme === 'dark' ? 'oscuro' : 'claro'} activado.`);
  });
}
