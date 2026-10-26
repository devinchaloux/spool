// ── The sound picker's catalogue ──
// Two kinds of sound:
// - synth: built from the browser's own oscillators and filters. Nothing to
//   download, starts instantly. Electronic by nature, which suits the roll's
//   first use (anthem excerpts for producers).
// - sampled: recordings of real instruments from the FluidR3 General MIDI set,
//   played by the smplr library. Each one is downloaded (about 2-3 MB) the first
//   time it is chosen, never before (docs/decisions.md).

export type SoundGroup = 'Synth' | 'Instrument'

export interface SynthSound {
  id: string
  label: string
  group: 'Synth'
  kind: 'synth'
}

export interface SampledSound {
  id: string
  label: string
  group: 'Instrument'
  kind: 'sampled'
  /** smplr's General MIDI instrument name in the FluidR3 kit. */
  instrument: string
}

export type Sound = SynthSound | SampledSound

const synth = (id: string, label: string): SynthSound => ({ id, label, group: 'Synth', kind: 'synth' })
const sampled = (id: string, label: string, instrument: string): SampledSound => ({ id, label, group: 'Instrument', kind: 'sampled', instrument })

export const SOUNDS: Sound[] = [
  // Synth presets: their recipes are in synth.ts, keyed by id.
  synth('square-lead', 'Square lead'),
  synth('saw-lead', 'Saw lead'),
  synth('supersaw', 'Supersaw'),
  synth('pluck', 'Pluck'),
  synth('stab', 'Rave stab'),
  synth('pad', 'Warm pad'),
  synth('acid-bass', 'Acid bass'),
  synth('sub-bass', 'Sub bass'),
  synth('chip', 'Chiptune'),
  synth('organ', 'Organ'),
  synth('bell', 'FM bell'),
  synth('sine', 'Sine'),
  // Sampled instruments.
  sampled('piano', 'Piano', 'acoustic_grand_piano'),
  sampled('electric-piano', 'Electric piano', 'electric_piano_1'),
  sampled('trumpet', 'Trumpet', 'trumpet'),
  sampled('brass', 'Brass section', 'brass_section'),
  sampled('synth-brass', 'Synth brass', 'synth_brass_1'),
  sampled('strings', 'Strings', 'string_ensemble_1'),
  sampled('pizzicato', 'Pizzicato strings', 'pizzicato_strings'),
  sampled('violin', 'Violin', 'violin'),
  sampled('viola', 'Viola', 'viola'),
  sampled('cello', 'Cello', 'cello'),
  sampled('double-bass', 'Double bass', 'contrabass'),
  sampled('flute', 'Flute', 'flute'),
  sampled('clarinet', 'Clarinet', 'clarinet'),
  sampled('alto-sax', 'Alto sax', 'alto_sax'),
  sampled('guitar', 'Nylon guitar', 'acoustic_guitar_nylon'),
  sampled('choir', 'Choir', 'choir_aahs'),
  sampled('vibraphone', 'Vibraphone', 'vibraphone'),
  sampled('synth-bass', 'Synth bass (sampled)', 'synth_bass_1'),
]

/**
 * The sound a part starts with when the file names no instrument the picker
 * matches: the saw lead, the maintainer's choice (2026-10-24), the bass line
 * included.
 */
export const DEFAULT_SOUND = 'saw-lead'

export function findSound(id: string | undefined): Sound {
  return SOUNDS.find((s) => s.id === id) ?? SOUNDS.find((s) => s.id === DEFAULT_SOUND)!
}

/** Shown wherever a sampled sound is in use: the FluidR3 license asks for credit. */
export const SAMPLE_CREDIT = 'Samples: FluidR3 GM by Frank Wen (CC BY 3.0)'
