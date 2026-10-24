import { THEMES, AA_TEXT, contrast, inkOn } from '../roll/themes'
import { NOTE_COLORS } from '../roll/noteColors'

// ── Text contrast ──
// Every text color on the roll, in every built-in theme, against the worst
// background it is drawn on, held to WCAG AA for normal text (4.5:1), as the
// site this roll was made for checks its own palette (its check:contrast).

const ratio = (a: string, b: string) => contrast(a, b) ?? 0

describe('contrast: the built-in themes', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: bar numbers, octave names and lane labels read on every row and the keyboard`, () => {
      for (const bg of [t.background, t.rowWhite, t.rowBlack, t.keyWhite]) expect(ratio(t.text, bg)).toBeGreaterThanOrEqual(AA_TEXT)
    })

    it(`${name}: chord symbols read, and the one under the playhead`, () => {
      expect(ratio(t.textStrong, t.background)).toBeGreaterThanOrEqual(AA_TEXT)
      expect(ratio(t.playhead, t.background)).toBeGreaterThanOrEqual(AA_TEXT)
      // The strongest text outranks the rest, as headings outrank body text.
      expect(ratio(t.textStrong, t.background)).toBeGreaterThan(ratio(t.text, t.background))
    })

    it(`${name}: note names read on every quick-pick color, and on its own note color`, () => {
      for (const c of [...NOTE_COLORS.flatMap((n) => [n.color, n.onLight]), t.note]) {
        expect(ratio(inkOn(c, t.noteText), c)).toBeGreaterThanOrEqual(AA_TEXT)
      }
    })
  }
})

describe('inkOn', () => {
  it('keeps the theme\'s note text where it reads, and switches where it doesn\'t', () => {
    expect(inkOn('#c00050', '#ffffff')).toBe('#ffffff')
    expect(inkOn('#ff5ca0', '#ffffff')).toBe('#0a0b0d')
    expect(inkOn('#222222', '#00141a')).toBe('#ffffff')
  })

  it('leaves a color it can\'t measure to the theme', () => {
    expect(inkOn('oklch(70% 0.2 0)', '#ffffff')).toBe('#ffffff')
  })
})
