// ── Public API ──
// The roll component; the reader it uses and the note data they share (and
// the bass line made from the chord symbols); the
// sounds, color themes, part colors and image export it offers.

export { default as MeiPianoRoll } from './roll/MeiPianoRoll'
export type { MeiPianoRollProps } from './roll/MeiPianoRoll'
export { parseNative } from './mei/parseNative'
export type { MeiBar, MeiChord, MeiNote, MeiPart, MeiScore, MeiWarning } from './mei/types'
export { withBassLine } from './mei/bassLine'
export { SOUNDS, DEFAULT_SOUND, SAMPLE_CREDIT } from './audio/sounds'
export type { Sound } from './audio/sounds'
export { soundForPart } from './audio/instruments'
export { THEMES, DEFAULT_THEME } from './roll/themes'
export { NOTE_COLORS, noteColorFor, isLightTheme, partColors } from './roll/noteColors'
export type { NoteColor } from './roll/noteColors'
export type { RollTheme, ThemeName } from './roll/themes'
export { rollToSvg } from './render/svg'
export type { RollImageOptions } from './render/svg'
export { svgToPng, downloadBlob } from './render/toPng'
