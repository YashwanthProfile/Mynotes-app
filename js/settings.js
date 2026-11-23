// Per-device preferences (appearance, finger drawing).
const KEY = 'mynotes-settings';
const DEFAULTS = { theme: 'system', fingerDraw: false, openMode: 'read', darkPages: 'off' };

let current = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  current = { ...DEFAULTS, ...saved };
} catch { /* private mode or blocked storage */ }

const listeners = new Set();

export function getSettings() { return { ...current }; }

export function setSetting(key, value) {
  current[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  applyTheme();
  listeners.forEach((fn) => fn(getSettings()));
}

export function onSettingsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applyTheme() {
  const root = document.documentElement;
  if (current.theme === 'light' || current.theme === 'dark') root.dataset.theme = current.theme;
  else delete root.dataset.theme;
  const dark = current.theme === 'dark' || (current.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? '#1b1b1d' : '#f6f5f2';
  document.head.appendChild(meta);
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
