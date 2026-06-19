/** User settings, persisted. Drives audio mute and reduced-motion behavior. */
export interface Settings {
  muted: boolean;
  reducedMotion: boolean;
}

const KEY = 'polycade.settings.v1';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  const defaults: Settings = { muted: false, reducedMotion: prefersReducedMotion() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
