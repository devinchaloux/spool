/* ===========================================================================
 * Chord symbols: the note a bass plays under one, and how it is shown.
 *
 * MEI writes a chord symbol as a <harm> with the symbol as plain text, as
 * notation software exports it: "Eb", "Gm7", "Bbm7b5", "D/F#". This reads the
 * note it is built on, and writes it with flat and sharp signs for display
 * (E♭, as notation software shows it on screen). The file itself is never
 * changed (docs/decisions.md, "chord symbols, and a bass line from them").
 * ======================================================================== */

// ── Reading a symbol ──

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
// Some files write a flat with the music symbol "flat up" (𝄬), as a jazz
// font's flat; one MEI sample, Parker and Gillespie's Shaw 'Nuff, does.
const ALTER: Record<string, number> = { b: -1, '♭': -1, '𝄬': -1, '𝄫': -2, '#': 1, '♯': 1, '𝄪': 2 }

// A pitch letter and its accidentals: the root at the start, or the bass after
// a slash. A slash before a digit ("C6/9") adds a note; it names no bass. A
// symbol in parentheses is an optional chord, played all the same.
const ROOT = /^\s*\(?\s*([A-G])([b#♭♯𝄫𝄪𝄬]*)/u
const SLASH_BASS = /\/\s*([A-G])([b#♭♯𝄫𝄪𝄬]*)\s*\)?\s*$/u
// "N.C.": no chord, so the bass rests.
const NO_CHORD = /^\s*\(?\s*N\.?\s*C\.?\s*\)?\s*$/i

function pitchClass(letter: string, accidentals: string): number {
  let pc = STEP[letter]
  for (const a of accidentals) pc += ALTER[a]
  return ((pc % 12) + 12) % 12
}

/**
 * The pitch class (0 = C) a bass plays under a chord symbol: the note after a
 * slash, else the root. "none" for "N.C."; null for a symbol it can't read.
 */
export function chordBass(symbol: string): number | 'none' | null {
  if (NO_CHORD.test(symbol)) return 'none'
  const root = ROOT.exec(symbol)
  if (!root) return null
  const bass = SLASH_BASS.exec(symbol)
  return bass ? pitchClass(bass[1], bass[2]) : pitchClass(root[1], root[2])
}

// ── Showing a symbol ──

const SIGN: Record<string, string> = { b: '♭', '#': '♯' }
const signs = (accidentals: string) => accidentals.replace(/[b#]/g, (c) => SIGN[c])

/**
 * A chord symbol with flat and sharp signs, as notation software shows it:
 * "Eb" → "E♭", "Bbm7b5" → "B♭m7♭5", "D/F#" → "D/F♯". Only accidentals after a
 * pitch letter or before a number are changed, so "sus" and "dim" keep their b's.
 */
export function prettyChord(symbol: string): string {
  return symbol
    .replace(/(^\s*\(?\s*|\/\s*)([A-G])([b#]+)/g, (_m, before: string, letter: string, acc: string) => before + letter + signs(acc))
    .replace(/[b#](?=\d)/g, (c) => SIGN[c])
}

// ── Showing them in notation ──

/**
 * The file with its chord symbols written with flat and sharp signs, for the
 * notation view to draw (Verovio draws ♭ and ♯ in its music font). Unchanged
 * if it has no chord symbols, or isn't XML.
 */
export function withPrettyChords(xmlText: string): string {
  const doc = new DOMParser().parseFromString(xmlText.trim(), 'application/xml')
  if (doc.querySelector('parsererror')) return xmlText
  let changed = false
  for (const harm of Array.from(doc.getElementsByTagNameNS('*', 'harm'))) {
    if (harm.getElementsByTagNameNS('*', 'fb').length) continue
    const walker = doc.createTreeWalker(harm, 4 /* NodeFilter.SHOW_TEXT */)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const pretty = prettyChord(node.nodeValue ?? '')
      if (pretty !== node.nodeValue) {
        node.nodeValue = pretty
        changed = true
      }
    }
  }
  return changed ? doc.documentElement.outerHTML : xmlText
}
