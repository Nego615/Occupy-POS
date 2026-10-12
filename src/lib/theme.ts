import { useSyncExternalStore } from 'react';

/**
 * Light or dark, chosen per device — a till by a sunny window and one in a dim
 * bar want different things, so this isn't a shop setting. Until someone picks,
 * the device's own preference holds. The choice lands as data-theme on <html>,
 * which tokens.css reads.
 */
export type Theme = 'light' | 'dark';

const KEY = 'occupy.theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return saved() ?? (media?.matches ? 'dark' : 'light');
}

function apply() {
  document.documentElement.dataset.theme = currentTheme();
  listeners.forEach((l) => l());
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the switch still holds for this visit.
  }
  document.documentElement.dataset.theme = theme;
  listeners.forEach((l) => l());
}

/** Sets data-theme before the first render, and follows the device while nothing's been picked. */
export function initTheme(): void {
  apply();
  media?.addEventListener('change', () => {
    if (!saved()) apply();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The theme on screen, re-rendering when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme as Theme) ?? 'light');
}
