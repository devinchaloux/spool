// ── Color themes ──
// A theme colors the roll's surface: background, key rows, grid, keyboard,
// text and playhead, plus a default note color. The page's controls (buttons,
// header) follow the page's own CSS variables instead (see the component's CSS).
//
// The note color is resolved in this order: the `accent` prop, then the page's
// `--accent` CSS variable (so a site's live accent switch recolors the notes),
// then the theme's own `note`.

export interface RollTheme {
  background: string
  /** Rows behind the white and black keys, so the pitch grid reads at a glance. */
  rowWhite: string
  rowBlack: string
  gridBeat: string
  gridBar: string
  /** The keyboard down the left side. */
  keyWhite: string
  keyBlack: string
  /** Bar numbers, the keyboard's octave names and lane labels. */
  text: string
  /** The chord symbols: the strongest text on the roll. Default: `text`. */
  textStrong?: string
  playhead: string
  /** Default note color, when neither the prop nor the page sets one. */
  note: string
  /** Notes sounding under the playhead. */
  activeNote: string
  /**
   * Text drawn on notes, when it reads on the note's color; otherwise near-black
   * or white, whichever reads better (see `inkOn`).
   */
  noteText: string
}

export const THEMES = {
  // The default. A DAW-style dark surface built from the palette of the site
  // this roll was made for (magenta accent). Its text takes that site's
  // lifted ramp of 2026-10-14: muted #b9bfcc, strong #eef0f4.
  studio: {
    background: '#0c0e14',
    rowWhite: '#161b27',
    rowBlack: '#11151f',
    gridBeat: '#222a3b',
    gridBar: '#3a455f',
    keyWhite: '#1b2030',
    keyBlack: '#0a0d14',
    text: '#b9bfcc',
    textStrong: '#eef0f4',
    playhead: '#ffce4a',
    note: '#ff5ca0',
    activeNote: '#ffd966',
    noteText: '#ffffff',
  },
  // Light, from the same site's light palette: for print, slides and pale pages.
  paper: {
    background: '#f5f3ec',
    rowWhite: '#f5f3ec',
    rowBlack: '#e9e7df',
    gridBeat: '#dddbd1',
    gridBar: '#b9b6aa',
    keyWhite: '#e9e7df',
    keyBlack: '#3a3d47',
    text: '#565b67',
    textStrong: '#0e0f14',
    playhead: '#c00050',
    note: '#c00050',
    activeNote: '#0e0f14',
    noteText: '#ffffff',
  },
  // High contrast on black, for screens and video.
  neon: {
    background: '#000000',
    rowWhite: '#07080c',
    rowBlack: '#000000',
    gridBeat: '#15182a',
    gridBar: '#2b3160',
    keyWhite: '#0d0f1c',
    keyBlack: '#000000',
    text: '#a9b2e6',
    textStrong: '#ffffff',
    playhead: '#ffffff',
    note: '#2dd4ee',
    activeNote: '#ffffff',
    noteText: '#00141a',
  },
  // Black on white with no color at all, for printing in grayscale.
  ink: {
    background: '#ffffff',
    rowWhite: '#ffffff',
    rowBlack: '#f1f1f1',
    gridBeat: '#e4e4e4',
    gridBar: '#9a9a9a',
    keyWhite: '#ffffff',
    keyBlack: '#222222',
    text: '#555555',
    textStrong: '#000000',
    playhead: '#000000',
    note: '#222222',
    activeNote: '#888888',
    noteText: '#ffffff',
  },
} satisfies Record<string, RollTheme>

export type ThemeName = keyof typeof THEMES
export const DEFAULT_THEME: ThemeName = 'studio'

export function resolveTheme(theme: ThemeName | RollTheme | undefined): RollTheme {
  if (!theme) return THEMES[DEFAULT_THEME]
  return typeof theme === 'string' ? (THEMES[theme] ?? THEMES[DEFAULT_THEME]) : theme
}

/** Lightens (amt > 0) or darkens (amt < 0) a hex color; other color formats pass through. */
export function shade(hex: string, amt: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return hex
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))))
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => adj(parseInt(h, 16)))
  return `rgb(${r},${g},${b})`
}

// ── Contrast ──
// Text on the roll is held to WCAG AA for normal text, 4.5:1, against the
// worst background it sits on, as the site this roll was made for holds its
// own text (src/test/contrast.test.ts checks every built-in theme).

/** The WCAG AA contrast for normal text. */
export const AA_TEXT = 4.5

function luminance(hex: string): number | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const v = parseInt(h, 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two hex colors (1 to 21); null if either isn't a hex color. */
export function contrast(a: string, b: string): number | null {
  const [la, lb] = [luminance(a), luminance(b)]
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// The two inks a note's name can take when the theme's own doesn't read.
const DARK_INK = '#0a0b0d'
const LIGHT_INK = '#ffffff'

/**
 * The color to write a note's name in, on a note of this color: the theme's
 * `noteText` if it reaches 4.5:1, else near-black or white, whichever reads
 * better. A bright note on a dark theme takes dark ink, as a filled accent on
 * the site does. A color that isn't hex keeps the theme's `noteText`.
 */
export function inkOn(fill: string, preferred: string): string {
  const own = contrast(preferred, fill)
  if (own === null || own >= AA_TEXT) return preferred
  return (contrast(DARK_INK, fill) ?? 0) >= (contrast(LIGHT_INK, fill) ?? 0) ? DARK_INK : LIGHT_INK
}
