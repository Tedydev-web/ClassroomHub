export type Theme = 'light' | 'dark';

const KEY = 'ch-admin-theme';

/** Stored choice if any, else the OS preference. Matches the inline app.html script. */
export function currentTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  // A `.dark` class on <html>, matching the dashboard's Tailwind dark variant.
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(KEY, theme);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
