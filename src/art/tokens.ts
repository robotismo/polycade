/**
 * The single source of truth for POLYCADE's visual identity. Every game and the
 * shell pull color, motion and type from here, so a palette change is one edit,
 * not five. Neon-on-dark, low-poly, colorblind-aware (cyan/magenta/yellow are
 * separable under the common deficiencies).
 */
export const palette = {
  bg: 0x08080f,
  bgCss: '#08080f',
  surface: 0x12121f,
  surfaceCss: '#12121f',
  fog: 0x0a0a16,

  ink: 0xeef0ff,
  inkCss: '#eef0ff',
  muted: 0x8a8aa8,
  mutedCss: '#8a8aa8',

  cyan: 0x00e5ff,
  cyanCss: '#00e5ff',
  magenta: 0xff2e88,
  magentaCss: '#ff2e88',
  violet: 0x7c5cff,
  violetCss: '#7c5cff',
  yellow: 0xffd23f,
  yellowCss: '#ffd23f',
  green: 0x2bd97a,
  greenCss: '#2bd97a',
} as const;

/** Per-game accent colors, also used for home-grid cards and HUD. */
export const accents = {
  updraft: palette.cyan,
  coil: palette.green,
  shatter: palette.magenta,
  rally: palette.violet,
  driftfield: palette.yellow,
} as const;

/** Shared motion language. Durations in ms; one easing curve everywhere. */
export const motion = {
  fast: 120,
  base: 220,
  slow: 420,
  /** Standard ease — a single cubic-bezier used across UI and camera moves. */
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

export function hexToCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
