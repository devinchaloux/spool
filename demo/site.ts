import { THEMES, type ThemeName } from '../src'
import soundsSource from './sounds.json'

// ── What the studio page and the embed share ──

// The hosted pages play the sampled instruments from their own copy, made by
// scripts/fetch-sounds.mjs when they build. `npm run dev` doesn't make one, so
// it keeps the library's default source.
export const SAMPLES_URL = import.meta.env.PROD ? `/sounds/fluidr3-${soundsSource.commit.slice(0, 7)}-loops${soundsSource.loops.version}/` : undefined

// The file Spool opens with: Victoria's O magnum mysterium, encoded by the
// CRIM Project (CC BY-NC 4.0), served from Spool's own copy so it doesn't
// depend on another site staying up (demo/public/files/LICENSE.md). The
// address is absolute, so a link or embed made from it works anywhere.
export const DEFAULT_FILE = {
  url: new URL('/files/CRIM_Model_0052.mei', window.location.origin).href,
  creditUrl: 'https://crimproject.org/pieces/CRIM_Model_0052/',
}

// Where listeners report a bug or suggest an improvement.
export const ISSUES_URL = 'https://github.com/devinchaloux/spool/issues/new'

// The site's palette, as the custom properties the player reads, so its chrome
// matches the page around it; its play button takes the accent. Copied from
// devinchaloux-site's src/styles/tokens.css, the 2026-10-14 lift: keep in step.
export const SITE_TOKENS = `
  --surface: #121419; --surface-2: #181b21; --border: #23262d;
  --text-strong: #eef0f4; --text: #e4e7ee; --text-muted: #b9bfcc;
  --accent: #ff5ca0; --accent-ink: #2e0418; --radius: 10px;
  --font-mono: 'DM Mono', ui-monospace, Menlo, Consolas, monospace;
`

// The site's light palette, for an embed whose roll is light, so the caption
// under a paper or ink roll isn't a dark bar.
const LIGHT_TOKENS = `
  --surface: #f5f3ec; --surface-2: #dddbd1; --border: #d2cfc4;
  --text-strong: #0e0f14; --text: #1a1c26; --text-muted: #565b67;
  --accent: #c00050; --accent-ink: #ffffff; --radius: 10px;
  --font-mono: 'DM Mono', ui-monospace, Menlo, Consolas, monospace;
`

/** The chrome that suits a roll: light around a light roll, else the site's dark. */
export function tokensFor(theme: ThemeName): string {
  const hex = THEMES[theme].background.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? LIGHT_TOKENS : SITE_TOKENS
}
