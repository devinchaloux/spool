import type { MeiChord, MeiNote, MeiPart, MeiScore } from './types'
import { chordBass, chordBassNote, pitchClassOf } from './chords'
import { spelledName } from './spelling'

/* ===========================================================================
 * A bass line from the chord symbols.
 *
 * Not in the file: Spool writes it, on request, as one more part. Each chord's
 * bass note (the note after a slash, else the root) is held until the next
 * symbol, in a bass guitar's bottom octave, E1 to D♯2. The choices are the
 * maintainer's (docs/decisions.md, "chord symbols, and a bass line from them").
 * ======================================================================== */

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** The bass line's lowest note, E1; it spans the octave up to D♯2 (MIDI 28–39). */
export const BASS_LOW = 28

/** The name the bass line's part goes by. */
export const BASS_LABEL = 'Bass from chords'

/** Whether a bass line can be made: at least one symbol names a note. */
export function hasBassLine(chords: MeiChord[]): boolean {
  return chords.some((c) => typeof chordBass(c.text) === 'number')
}

/**
 * The score with the bass line as one more part, last, so every other part
 * keeps its index. A symbol it can't read leaves a rest and is reported; "N.C."
 * (no chord) rests without a word. A score with no bass notes comes back as it is.
 */
export function withBassLine(score: MeiScore): MeiScore {
  // One symbol per moment: a file can write the same symbol on several staves.
  const chords = score.chords.filter((c, i, all) => i === 0 || c.start > all[i - 1].start + 1e-6)
  const part = score.parts.length
  const notes: MeiNote[] = []
  let unread = 0
  chords.forEach((chord, i) => {
    const end = chords[i + 1]?.start ?? score.totalBeats
    const bass = chordBassNote(chord.text)
    if (bass === null) unread++
    if (bass === null || bass === 'none' || end <= chord.start + 1e-6) return
    const midi = BASS_LOW + ((pitchClassOf(bass) - (BASS_LOW % 12) + 12) % 12)
    // Named as the symbol spells it (E♭2 under "Eb"), its octave counted from
    // the letter, as a written note's is: C♭ sounds as the B below it.
    const octave = Math.floor((midi - STEP[bass.letter] - bass.alter) / 12) - 1
    // Its id is the chord symbol's, so the notation view lights the symbol while it sounds.
    notes.push({ midi, start: chord.start, dur: end - chord.start, name: spelledName(bass.letter, bass.alter, octave), part, ids: chord.id ? [chord.id] : [] })
  })
  if (!notes.length) return score
  // General MIDI 38, Synth Bass 1: a sampled bass that plays at the written
  // pitch. The synth basses sound an octave lower, too low for these notes.
  const bass: MeiPart = { label: BASS_LABEL, staves: [], midiProgram: 38, generated: true }
  return {
    ...score,
    parts: [...score.parts, bass],
    notes: [...score.notes, ...notes],
    warnings: unread
      ? [...score.warnings, { code: 'chord-unread', message: "Some chord symbols couldn't be read, so the bass line rests under them.", count: unread }]
      : score.warnings,
  }
}
