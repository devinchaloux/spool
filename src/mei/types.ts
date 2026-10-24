// ── The note data every reader hands the renderer ──
// One shape for every reader, so the roll's drawing and playback are written
// once (docs/decisions.md, "two readers behind one renderer").

export interface MeiNote {
  /** MIDI note number: middle C is 60. */
  midi: number
  /** Onset, in quarter-note beats from the start of the piece. */
  start: number
  /** Duration, in quarter-note beats. */
  dur: number
  /** Pitch name with octave, e.g. "C#4". */
  name: string
  /** Which instrument plays it: an index into `MeiScore.parts`. */
  part: number
  /**
   * The written notes it sounds, by xml:id: one, or every note of a tied
   * chain. Empty when the file gives the note no id.
   */
  ids?: string[]
}

/**
 * One instrument: a staff, or a group of staves the file presents as one
 * instrument (a piano's two staves under a brace, or a group with one name).
 */
export interface MeiPart {
  /** The name the file gives, else "Staff 1" or "Staves 1–2". */
  label: string
  /** The staves it covers, by their `n`. */
  staves: string[]
  /** The instrument the file names, if any, in its own words (`<instrDef>` or the label). */
  instrument?: string
  /** The instrument's General MIDI program (0–127), when an `<instrDef>` gives one. */
  midiProgram?: number
  /** True for a part Spool wrote, not the file: the bass line from the chord symbols. */
  generated?: boolean
}

/** A chord symbol written over the music (`<harm>`), such as "Eb" or "Gm7". */
export interface MeiChord {
  /** Onset, in quarter-note beats. */
  start: number
  /** The symbol as the file writes it. */
  text: string
  /** The symbol as shown: with ♭ and ♯ for the file's b and # ("E♭"). */
  label: string
  /** The `<harm>`'s xml:id, if it has one. */
  id?: string
}

/**
 * Something in the file the reader did not render faithfully. The roll never
 * fails silently: anything dropped, simplified or guessed is reported here,
 * once per kind, with how often it happened.
 */
export interface MeiWarning {
  /** Stable identifier, e.g. "tie" or "skipped:fermata". */
  code: string
  /** Plain-English explanation of what the roll shows instead. */
  message: string
  count: number
}

/** Where a bar begins, for drawing bar lines and numbers. */
export interface MeiBar {
  /** Onset, in quarter-note beats. */
  start: number
  /** The bar's number as the file gives it (a pickup is often "0"). */
  label: string
}

export interface MeiScore {
  title: string
  /** The composer the file names, else "". Several are joined with commas. */
  composer: string
  /** The performer or band the file names (a role of artist or performer), else "". */
  artist: string
  bpm: number
  meterCount: number
  meterUnit: number
  /** Length of a full bar in the opening meter, in quarter-note beats. */
  measureBeats: number
  /** Every bar, in order. Pickups and other short bars keep their real length. */
  bars: MeiBar[]
  totalBeats: number
  /** Every part that has notes, in score order. A file with one staff has one part. */
  parts: MeiPart[]
  notes: MeiNote[]
  /** Every chord symbol, in time order. Empty when the file has none. */
  chords: MeiChord[]
  warnings: MeiWarning[]
}
