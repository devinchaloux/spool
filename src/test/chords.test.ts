// @vitest-environment jsdom
import { parseNative } from '../mei/parseNative'
import { chordBass, prettyChord, withPrettyChords } from '../mei/chords'
import { withBassLine, hasBassLine, BASS_LABEL } from '../mei/bassLine'
import { rollToSvg } from '../render/svg'

// ── Helpers ──
// Short MEI written for these tests: chord symbols as notation software
// exports them, a <harm> pointing at a note (startid) or at a beat (tstamp).

function mei(measures: string, meter = 'meter.count="4" meter.unit="4"'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead><fileDesc><titleStmt><title>Test</title></titleStmt></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef><staffGrp><staffDef n="1" lines="5" ${meter}/></staffGrp></scoreDef>
    <section>${measures}</section>
  </score></mdiv></body></music>
</mei>`
}

const bar = (n: number, layer: string, harms = '') =>
  `<measure n="${n}"><staff n="1"><layer n="1">${layer}</layer></staff>${harms}</measure>`

// Two bars of quarter notes with ids a1–a4 and b1–b4.
const quarters = (prefix: string) =>
  [1, 2, 3, 4].map((i) => `<note xml:id="${prefix}${i}" pname="c" oct="5" dur="4"/>`).join('')

// ── Reading a symbol ──

describe('chord symbols: the bass note', () => {
  it('reads the root, with its accidental', () => {
    expect(chordBass('C')).toBe(0)
    expect(chordBass('Eb')).toBe(3)
    expect(chordBass('F#m7')).toBe(6)
    expect(chordBass('Bbm7b5')).toBe(10)
    expect(chordBass('E♭maj7')).toBe(3)
    expect(chordBass('Cb')).toBe(11)
  })

  it('takes the note after a slash, but not an added sixth-and-ninth', () => {
    expect(chordBass('C/E')).toBe(4)
    expect(chordBass('D/F#')).toBe(6)
    expect(chordBass('C6/9')).toBe(0)
  })

  it('reads a flat written as the music symbol 𝄬, and a chord in parentheses', () => {
    // As the MEI sample of Parker and Gillespie's Shaw 'Nuff writes them.
    expect(chordBass('B𝄬MI(MA 7)')).toBe(10)
    expect(chordBass('B𝄬6/F')).toBe(5)
    expect(chordBass('(B𝄬6)')).toBe(10)
    expect(prettyChord('(Bb6)')).toBe('(B♭6)')
  })

  it('rests for "N.C." and gives up on text it can\'t read', () => {
    expect(chordBass('N.C.')).toBe('none')
    expect(chordBass('(N.C.)')).toBe('none')
    expect(chordBass('NC')).toBe('none')
    expect(chordBass('tacet')).toBeNull()
  })
})

describe('chord symbols: shown with flat and sharp signs', () => {
  it('writes b and # after a pitch letter or before a number as signs', () => {
    expect(prettyChord('Eb')).toBe('E♭')
    expect(prettyChord('Bbm7b5')).toBe('B♭m7♭5')
    expect(prettyChord('D/F#')).toBe('D/F♯')
    expect(prettyChord('C7#11')).toBe('C7♯11')
    expect(prettyChord('C7(b9)')).toBe('C7(♭9)')
  })

  it('leaves the b in a word alone', () => {
    expect(prettyChord('Bsus4')).toBe('Bsus4')
    expect(prettyChord('Bbdim')).toBe('B♭dim')
    expect(prettyChord('B')).toBe('B')
  })

  it('rewrites the symbols in the copy of the file the notation view draws', () => {
    const xml = mei(bar(1, quarters('a'), '<harm staff="1" startid="#a1">Eb</harm>'))
    const pretty = withPrettyChords(xml)
    expect(pretty).toContain('>E♭<')
    expect(withPrettyChords(mei(bar(1, quarters('a'))))).toBe(mei(bar(1, quarters('a'))))
  })
})

// ── Reading them from the file ──

describe('parseNative: chord symbols', () => {
  it('places a symbol at the note it points at, or at its beat in the bar', () => {
    const s = parseNative(mei(
      bar(1, quarters('a'), '<harm xml:id="h1" staff="1" startid="#a1">Eb</harm><harm staff="1" startid="#a3">Bb/D</harm>') +
      bar(2, quarters('b'), '<harm staff="1" tstamp="2">Gm</harm>'),
    ))
    expect(s.chords).toEqual([
      { start: 0, text: 'Eb', label: 'E♭', id: 'h1' },
      { start: 2, text: 'Bb/D', label: 'B♭/D' },
      { start: 5, text: 'Gm', label: 'Gm' },
    ])
    expect(s.warnings).toEqual([])
  })

  it('counts tstamp in the meter\'s own beat', () => {
    const s = parseNative(mei(bar(1, '<note pname="c" oct="4" dur="2" dots="1"/><note pname="c" oct="4" dur="2" dots="1"/>', '<harm tstamp="4">F</harm>'), 'meter.count="6" meter.unit="8"'))
    expect(s.chords[0].start).toBe(1.5)
  })

  it('reports figured bass, which it doesn\'t show', () => {
    const s = parseNative(mei(bar(1, quarters('a'), '<harm startid="#a1"><fb><f>6</f></fb></harm>')))
    expect(s.chords).toEqual([])
    expect(s.warnings.map((w) => w.code)).toEqual(['figured-bass'])
  })

  it('has no chords for a file without symbols', () => {
    expect(parseNative(mei(bar(1, quarters('a')))).chords).toEqual([])
  })
})

// ── The bass line ──

describe('withBassLine', () => {
  const xml = mei(
    bar(1, quarters('a'), '<harm xml:id="h1" startid="#a1">Eb</harm><harm startid="#a3">C/G</harm>') +
    bar(2, quarters('b'), '<harm startid="#b1">N.C.</harm><harm startid="#b3">G</harm>'),
  )

  it('holds each chord\'s bass note until the next symbol, from E1 to D♯2, as one more part', () => {
    const s = withBassLine(parseNative(xml))
    expect(s.parts.map((p) => p.label)).toEqual(['Staff 1', BASS_LABEL])
    expect(s.parts[1].generated).toBe(true)
    const bass = s.notes.filter((n) => n.part === 1)
    // E♭ (D♯2, the top of the range) for two beats, G1 (the slash's G) for two, a rest under N.C., then G1 to the end.
    expect(bass.map((n) => [n.name, n.start, n.dur])).toEqual([
      ['D#2', 0, 2],
      ['G1', 2, 2],
      ['G1', 6, 2],
    ])
    expect(bass.every((n) => n.midi >= 28 && n.midi <= 39)).toBe(true)
    expect(bass[0].ids).toEqual(['h1'])
    expect(s.warnings).toEqual([])
  })

  it('leaves the file\'s own parts as they are', () => {
    const base = parseNative(xml)
    const s = withBassLine(base)
    expect(s.notes.filter((n) => n.part === 0)).toEqual(base.notes)
    expect(base.parts).toHaveLength(1)
  })

  it('plays a symbol written on several staves once', () => {
    const s = parseNative(mei(bar(1, quarters('a'), '<harm startid="#a1">F</harm><harm startid="#a1">F</harm>')))
    expect(withBassLine(s).notes.filter((n) => n.part === 1)).toHaveLength(1)
  })

  it('rests under a symbol it can\'t read, and says so', () => {
    const s = withBassLine(parseNative(mei(bar(1, quarters('a'), '<harm startid="#a1">F</harm><harm startid="#a3">?</harm>'))))
    expect(s.notes.filter((n) => n.part === 1).map((n) => n.dur)).toEqual([2])
    expect(s.warnings.map((w) => w.code)).toEqual(['chord-unread'])
  })

  it('is offered only when a symbol names a note', () => {
    expect(hasBassLine(parseNative(xml).chords)).toBe(true)
    expect(hasBassLine([{ start: 0, text: 'N.C.', label: 'N.C.' }])).toBe(false)
    const none = parseNative(mei(bar(1, quarters('a'))))
    expect(withBassLine(none)).toBe(none)
  })
})

// ── Images ──

describe('rollToSvg: chord symbols', () => {
  it('draws the symbols in view, with signs, unless asked not to', () => {
    const s = parseNative(mei(bar(1, quarters('a'), '<harm startid="#a1">Eb</harm>') + bar(2, quarters('b'), '<harm startid="#b1">Bb</harm>')))
    const svg = rollToSvg(s, { fromBar: 2, toBar: 2 })
    expect(svg).toContain('>B♭</text>')
    expect(svg).not.toContain('>E♭</text>')
    expect(rollToSvg(s, { chordSymbols: false })).not.toContain('B♭')
  })
})
