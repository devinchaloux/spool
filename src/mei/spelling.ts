// ── Note names, spelled as written ──
// The roll names a note as the file spells it: a B flat is "B♭4", not "A♯4",
// and its octave is the written one, so a C flat written in octave 4 is "C♭4"
// though it sounds as B3. Signs, not "b" and "#", as on the chord symbols.

/** A note's name: its letter, its accidentals as signs, and its octave. */
export function spelledName(letter: string, alter: number, octave: number): string {
  const signs = alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter)
  return letter.toUpperCase() + signs + octave
}
