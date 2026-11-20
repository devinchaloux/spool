import { pageTheme, THEMES, AA_TEXT, contrast } from '../roll/themes'

// ── The page's colors ──
// With no theme named, the roll takes its surface from the page. These are
// the dark and light values of the site the roll was made for, so a change
// there that broke the roll's text would show here first.

const DARK: Record<string, string> = {
  '--bg': '#0a0b0d', '--surface': '#121419', '--border': '#23262d',
  '--text-muted': '#b9bfcc', '--text-strong': '#eef0f4',
}
const LIGHT: Record<string, string> = {
  '--bg': '#e9e7df', '--surface': '#f5f3ec', '--border': '#d2cfc4',
  '--text-muted': '#565b67', '--text-strong': '#0e0f14',
}
const from = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? ''
const ratio = (a: string, b: string) => contrast(a, b) ?? 0

describe('pageTheme', () => {
  it('takes the surface from the page, and studio for the rest on a dark page', () => {
    const t = pageTheme(from(DARK))
    expect(t.background).toBe('#0a0b0d')
    expect(t.rowWhite).toBe('#121419')
    expect(t.rowBlack).toBe('#0a0b0d')
    expect(t.gridBeat).toBe('#23262d')
    expect(t.text).toBe('#b9bfcc')
    expect(t.keyBlack).toBe(THEMES.studio.keyBlack)
    expect(t.playhead).toBe(THEMES.studio.playhead)
  })

  it('fills from paper on a light page, so the keyboard and playhead suit it', () => {
    const t = pageTheme(from(LIGHT))
    expect(t.background).toBe('#e9e7df')
    expect(t.keyWhite).toBe(THEMES.paper.keyWhite)
    expect(t.playhead).toBe(THEMES.paper.playhead)
  })

  it('is studio on a page that sets none of the properties', () => {
    expect(pageTheme(() => '')).toEqual(THEMES.studio)
  })

  for (const [name, tokens] of [['dark', DARK], ['light', LIGHT]] as const) {
    it(`${name} page: the roll's text reads on every row and the keyboard`, () => {
      const t = pageTheme(from(tokens))
      for (const bg of [t.background, t.rowWhite, t.rowBlack, t.keyWhite]) expect(ratio(t.text, bg)).toBeGreaterThanOrEqual(AA_TEXT)
      expect(ratio(t.textStrong ?? t.text, t.background)).toBeGreaterThanOrEqual(AA_TEXT)
      expect(ratio(t.playhead, t.background)).toBeGreaterThanOrEqual(AA_TEXT)
    })
  }
})
