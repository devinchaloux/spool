// @vitest-environment jsdom
import { parseNative } from '../mei/parseNative'

// ── Helpers ──
// Each test writes a few bars of MEI by hand, aimed at one behavior. They are
// written for these tests, so no sample file (and no license question) is needed.

function mei(layer: string, staffDef = 'meter.count="4" meter.unit="4"', extraMeasures = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead><fileDesc><titleStmt><title>Test</title></titleStmt></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef><staffGrp><staffDef n="1" lines="5" ${staffDef}/></staffGrp></scoreDef>
    <section>
      <measure n="1"><staff n="1"><layer n="1">${layer}</layer></staff></measure>
      ${extraMeasures}
    </section>
  </score></mdiv></body></music>
</mei>`
}

const codes = (xml: string) => parseNative(xml).warnings.map((w) => w.code)

// ── Pitch and time ──

describe('parseNative: pitch and time', () => {
  it('reads quarter notes in order, in quarter-note beats', () => {
    const s = parseNative(mei('<note pname="c" oct="4" dur="4"/><note pname="d" oct="4" dur="4"/><note pname="e" oct="4" dur="2"/>'))
    expect(s.notes.map((n) => [n.name, n.start, n.dur])).toEqual([
      ['C4', 0, 1],
      ['D4', 1, 1],
      ['E4', 2, 2],
    ])
    expect(s.notes[0].midi).toBe(60)
    expect(s.warnings).toEqual([])
  })

  it('lengthens dotted notes', () => {
    const s = parseNative(mei('<note pname="c" oct="4" dur="2" dots="1"/><note pname="c" oct="4" dur="4"/>'))
    expect(s.notes[0].dur).toBe(3)
    expect(s.notes[1].start).toBe(3)
  })

  it('gives every note of a chord the same onset', () => {
    const s = parseNative(mei('<chord dur="1"><note pname="c" oct="4"/><note pname="e" oct="4"/><note pname="g" oct="4"/></chord>'))
    expect(s.notes.map((n) => n.start)).toEqual([0, 0, 0])
    expect(s.notes.map((n) => n.midi)).toEqual([60, 64, 67])
  })

  it('squeezes a triplet into the time of two', () => {
    const s = parseNative(mei('<tuplet num="3" numbase="2"><note pname="c" oct="4" dur="8"/><note pname="d" oct="4" dur="8"/><note pname="e" oct="4" dur="8"/></tuplet><rest dur="4"/><rest dur="2"/>'))
    expect(s.notes[2].start).toBeCloseTo(2 / 3)
    expect(s.notes[2].dur).toBeCloseTo(1 / 3)
  })

  it('names each note as the file spells it, in its written octave', () => {
    const s = parseNative(mei('<note pname="b" oct="4" dur="4" accid="f"/><note pname="b" oct="4" dur="4"><accid accid.ges="f"/></note><note pname="f" oct="4" dur="4" accid="x"/><note pname="c" oct="4" dur="4" accid="f"/>'))
    expect(s.notes.map((n) => [n.name, n.midi])).toEqual([['B♭4', 70], ['B♭4', 70], ['F♯♯4', 67], ['C♭4', 59]])
  })

  it('applies the key signature unless the note has its own accidental', () => {
    const s = parseNative(mei('<note pname="f" oct="4" dur="4"/><note pname="f" oct="4" dur="4" accid="n"/><rest dur="2"/>', 'meter.count="4" meter.unit="4" keysig="1s"'))
    expect(s.notes.map((n) => n.name)).toEqual(['F♯4', 'F4'])
  })

  it('times each layer from the start of the bar', () => {
    const xml = mei('<note pname="c" oct="5" dur="1"/>').replace(
      '</layer></staff>',
      '</layer><layer n="2"><note pname="c" oct="3" dur="2"/><note pname="g" oct="3" dur="2"/></layer></staff>',
    )
    const s = parseNative(xml)
    expect(s.notes.map((n) => [n.name, n.start])).toEqual([
      ['C5', 0],
      ['C3', 0],
      ['G3', 2],
    ])
  })
})

// ── Where the opening meter and key are written ──
// MEI allows several places; files exported by notation software mostly use
// <scoreDef>, which the reader once ignored (2026-10-07).

describe('parseNative: opening meter and key', () => {
  const layer = '<note pname="f" oct="4" dur="4"/><rest dur="4"/><rest dur="4"/>'
  const withScoreDef = (scoreDefAttrs: string, staffDef = '') =>
    mei(layer, staffDef).replace('<scoreDef>', `<scoreDef ${scoreDefAttrs}>`)

  it('reads the meter from <scoreDef>', () => {
    const s = parseNative(withScoreDef('meter.count="3" meter.unit="4"'))
    expect([s.meterCount, s.meterUnit, s.measureBeats]).toEqual([3, 4, 3])
    expect(s.warnings.map((w) => w.code)).not.toContain('no-meter')
  })

  it('reads the meter from a <meterSig> element', () => {
    const xml = mei(layer, '').replace('lines="5" />', 'lines="5"><meterSig count="6" unit="8"/></staffDef>')
    expect(parseNative(xml).measureBeats).toBe(3)
  })

  it('reads the meter from any staff, not only the first', () => {
    const xml = mei(layer, '').replace('</staffGrp>', '<staffDef n="2" lines="5" meter.count="3" meter.unit="4"/></staffGrp>')
    expect(parseNative(xml).measureBeats).toBe(3)
  })

  it("falls back to the work's meter in the header", () => {
    const xml = mei(layer, '').replace('</fileDesc>', '</fileDesc><workList><work><meter count="3" unit="2"/></work></workList>')
    expect(parseNative(xml).measureBeats).toBe(6)
  })

  it('reads cut time from a meter symbol', () => {
    expect(parseNative(withScoreDef('meter.sym="cut"')).measureBeats).toBe(4)
  })

  it('reads the key from <scoreDef>, MEI 3 key.sig and <keySig>', () => {
    expect(parseNative(withScoreDef('keysig="1s"')).notes[0].name).toBe('F♯4')
    expect(parseNative(mei(layer, 'key.sig="1s"')).notes[0].name).toBe('F♯4')
    const xml = mei(layer, '').replace('lines="5" />', 'lines="5"><keySig sig="1s"/></staffDef>')
    expect(parseNative(xml).notes[0].name).toBe('F♯4')
  })

  it("gives each staff its own key, the staff's before the score's", () => {
    const xml = withScoreDef('keysig="1s" meter.count="4" meter.unit="4"')
      .replace('</staffGrp>', '<staffDef n="2" lines="5" keysig="1f"/></staffGrp>')
      .replace('</staff></measure>', '</staff><staff n="2"><layer n="1"><note pname="b" oct="3" dur="1"/></layer></staff></measure>')
    expect(parseNative(xml).notes.map((n) => n.name)).toEqual(['F♯4', 'B♭3'])
  })
})

// ── Timing fixes ──

describe('parseNative: chords and pickup bars', () => {
  it("takes a chord's duration from its notes when the chord has none", () => {
    const s = parseNative(mei('<chord><note pname="c" oct="4" dur="2"/><note pname="e" oct="4" dur="2"/></chord><note pname="g" oct="4" dur="2"/>'))
    expect(s.notes.map((n) => [n.name, n.start, n.dur])).toEqual([
      ['C4', 0, 2],
      ['E4', 0, 2],
      ['G4', 2, 2],
    ])
    expect(s.warnings.map((w) => w.code)).not.toContain('no-dur')
  })

  it('keeps a pickup marked metcon="false" at its real length, and reports the bars', () => {
    const xml = mei('<note pname="g" oct="4" dur="4"/>', undefined, '<measure n="1"><staff n="1"><layer n="1"><note pname="c" oct="5" dur="1"/></layer></staff></measure>')
      .replace('<measure n="1">', '<measure n="0" metcon="false">')
    const s = parseNative(xml)
    expect(s.notes[1].start).toBe(1)
    expect(s.bars).toEqual([
      { start: 0, label: '0' },
      { start: 1, label: '1' },
    ])
    expect(s.warnings.map((w) => w.code)).not.toContain('short-bar')
  })
})

// ── Reading only the music, and resolving shorthand ──

describe('parseNative: what counts as the music', () => {
  it('ignores an incipit quoted in the header', () => {
    const incipit = '<workList><work><incip><score><section><measure n="1"><staff n="1"><layer><note pname="a" oct="5" dur="1"/></layer></staff></measure></section></score></incip></work></workList>'
    const s = parseNative(mei('<note pname="c" oct="4" dur="1"/>').replace('</fileDesc>', '</fileDesc>' + incipit))
    expect(s.notes.map((n) => n.name)).toEqual(['C4'])
    expect(s.bars).toHaveLength(1)
  })

  it('plays a copyof reference as a copy of what it points to', () => {
    const s = parseNative(mei('<chord xml:id="c1" dur="4"><note pname="c" oct="4"/><note pname="e" oct="4"/></chord><chord copyof="#c1"/><rest dur="2"/>'))
    expect(s.notes.map((n) => [n.name, n.start])).toEqual([
      ['C4', 0],
      ['E4', 0],
      ['C4', 1],
      ['E4', 1],
    ])
  })
})

// ── Warnings: the reader says what it leaves out ──

describe('parseNative: warnings', () => {
  it('pads an unmarked short bar, and reports the shift it causes', () => {
    const s = parseNative(mei('<note pname="g" oct="4" dur="4"/>', undefined, '<measure n="2"><staff n="1"><layer n="1"><note pname="c" oct="5" dur="1"/></layer></staff></measure>'))
    expect(s.notes[1].start).toBe(4) // padded: the known gap, now reported
    expect(s.warnings.map((w) => w.code)).toContain('short-bar')
  })

  it('reports a file with no opening meter', () => {
    expect(codes(mei('<note pname="c" oct="4" dur="1"/>', ''))).toContain('no-meter')
  })

  it('reports transposing instruments', () => {
    expect(codes(mei('<note pname="c" oct="4" dur="1"/>', 'meter.count="4" meter.unit="4" trans.semi="-2" trans.diat="-1"'))).toContain('transposing')
  })

  it('reports an unreadable duration instead of breaking the timeline', () => {
    const s = parseNative(mei('<note pname="c" oct="4" dur="x"/><note pname="d" oct="4" dur="4"/>'))
    expect(s.notes[1].start).toBe(0)
    expect(Number.isFinite(s.totalBeats)).toBe(true)
    expect(s.warnings.map((w) => w.code)).toContain('bad-dur')
  })

  it('names elements it skips', () => {
    expect(codes(mei('<note pname="c" oct="4" dur="1"/><foo/>'))).toContain('skipped:foo')
  })

  it('throws on a file that is not XML', () => {
    expect(() => parseNative('<mei><unclosed></mei>')).toThrow(/XML parse error/)
  })
})

// ── Ties and grace notes ──

const bar2 = (layer: string) => `<measure n="2"><staff n="1"><layer n="1">${layer}</layer></staff></measure>`

describe('parseNative: ties', () => {
  it('joins notes tied across a bar line into one note that sounds once', () => {
    const s = parseNative(mei('<rest dur="2"/><note pname="c" oct="4" dur="2" tie="i"/>', undefined, bar2('<note pname="c" oct="4" dur="2" tie="t"/><rest dur="2"/>')))
    expect(s.notes.map((n) => [n.name, n.start, n.dur])).toEqual([['C4', 2, 4]])
    expect(s.warnings).toEqual([])
  })

  it('follows a chain of ties through a middle note', () => {
    const s = parseNative(mei('<note pname="e" oct="4" dur="4" tie="i"/><note pname="e" oct="4" dur="4" tie="m"/><note pname="e" oct="4" dur="2" tie="t"/>'))
    expect(s.notes.map((n) => [n.start, n.dur])).toEqual([[0, 4]])
  })

  it('joins notes named by a <tie> element, and each tied note of a chord', () => {
    const xml = mei(
      '<chord dur="2"><note xml:id="a" pname="c" oct="4"/><note xml:id="b" pname="e" oct="4"/></chord><chord dur="2"><note xml:id="c" pname="c" oct="4"/><note xml:id="d" pname="e" oct="4"/></chord>',
    ).replace('</measure>', '<tie startid="#a" endid="#c"/><tie startid="#b" endid="#d"/></measure>')
    expect(parseNative(xml).notes.map((n) => [n.name, n.dur])).toEqual([['C4', 4], ['E4', 4]])
  })

  it('reports a tie whose other end is missing, and keeps the note as written', () => {
    const s = parseNative(mei('<note pname="c" oct="4" dur="2" tie="i"/><note pname="d" oct="4" dur="2"/>'))
    expect(s.notes.map((n) => n.dur)).toEqual([2, 2])
    expect(s.warnings.map((w) => w.code)).toContain('tie')
  })
})

describe('parseNative: grace notes', () => {
  it('plays a grace note just before its beat, taking its time from the note before', () => {
    const s = parseNative(mei('<note pname="c" oct="5" dur="2"/><note pname="d" oct="5" dur="16" grace="unacc"/><note pname="c" oct="5" dur="2"/>'))
    expect(s.notes.map((n) => [n.name, n.start, n.dur])).toEqual([['C5', 0, 1.75], ['D5', 1.75, 0.25], ['C5', 2, 2]])
    expect(s.warnings).toEqual([])
  })

  it('places a group of grace notes in order, ending on the beat', () => {
    const s = parseNative(mei('<note pname="c" oct="5" dur="2"/><graceGrp><note pname="d" oct="5" dur="16"/><note pname="e" oct="5" dur="16"/></graceGrp><note pname="c" oct="5" dur="2"/>'))
    expect(s.notes.map((n) => [n.name, n.start])).toEqual([['C5', 0], ['D5', 1.5], ['E5', 1.75], ['C5', 2]])
  })

  it('never takes more than half the time since the note before', () => {
    const s = parseNative(mei('<note pname="c" oct="5" dur="16"/><note pname="d" oct="5" dur="4" grace="unacc"/><note pname="c" oct="5" dur="2" dots="1"/><rest dur="16"/>'))
    expect(s.notes.map((n) => [n.name, n.start, n.dur])).toEqual([['C5', 0, 0.125], ['D5', 0.125, 0.125], ['C5', 0.25, 3]])
  })

  it('leaves out grace notes with no written length, or with no time before them', () => {
    expect(codes(mei('<note pname="c" oct="5" dur="2"/><note pname="d" oct="5" grace="unacc"/><note pname="c" oct="5" dur="2"/>'))).toContain('grace-no-dur')
    const s = parseNative(mei('<note pname="d" oct="5" dur="8" grace="acc"/><note pname="c" oct="5" dur="1"/>'))
    expect(s.notes).toHaveLength(1)
    expect(s.warnings.map((w) => w.code)).toContain('grace-start')
  })
})

// ── Tremolos ──

describe('parseNative: tremolos', () => {
  it('plays a measured bTrem as the repeated notes it stands for', () => {
    // A dotted-quarter chord in a triplet, tremolo in eighths: three triplet eighths in one beat.
    const s = parseNative(mei('<tuplet num="3" numbase="2"><bTrem unitdur="8"><chord dur="4" dots="1"><note pname="g" oct="3"/><note pname="g" oct="4"/></chord></bTrem></tuplet><rest dur="4"/><rest dur="2"/>'))
    const g3 = s.notes.filter((n) => n.name === 'G3')
    expect(g3.map((n) => n.start)).toEqual([0, 1 / 3, 2 / 3].map((x) => expect.closeTo(x)))
    expect(g3.every((n) => Math.abs(n.dur - 1 / 3) < 1e-9)).toBe(true)
    expect(s.notes).toHaveLength(6)
    expect(s.warnings).toEqual([])
  })

  it('reads the unit from slashes when there is no unitdur', () => {
    // A quarter note with two slashes: four sixteenths.
    const s = parseNative(mei('<bTrem><note pname="c" oct="4" dur="4" stem.mod="2slash"/></bTrem><rest dur="4"/><rest dur="2"/>'))
    expect(s.notes.map((n) => n.start)).toEqual([0, 0.25, 0.5, 0.75])
  })

  it('alternates a fTrem in the time of one of its notes', () => {
    const s = parseNative(mei('<fTrem unitdur="8"><note pname="c" oct="4" dur="2"/><note pname="e" oct="4" dur="2"/></fTrem><note pname="g" oct="4" dur="2"/>'))
    expect(s.notes.map((n) => [n.name, n.start])).toEqual([
      ['C4', 0], ['E4', 0.5], ['C4', 1], ['E4', 1.5], ['G4', 2],
    ])
  })

  it('holds an unmeasured tremolo and says so', () => {
    const s = parseNative(mei('<bTrem><note pname="c" oct="4" dur="2"/></bTrem><rest dur="2"/>'))
    expect(s.notes.map((n) => [n.start, n.dur])).toEqual([[0, 2]])
    expect(codes(mei('<bTrem><note pname="c" oct="4" dur="2"/></bTrem><rest dur="2"/>'))).toContain('tremolo-unmeasured')
  })

  it('ties out of a tremolo from its last stroke only', () => {
    const s = parseNative(mei('<bTrem unitdur="8"><note pname="c" oct="4" dur="2" tie="i"/></bTrem><note pname="c" oct="4" dur="2" tie="t"/>'))
    expect(s.notes.map((n) => [n.start, n.dur])).toEqual([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 2.5]])
  })
})

describe('parseNative: tempo', () => {
  it('reads a metronome mark when there is no playback tempo', () => {
    expect(parseNative(mei('<note pname="c" oct="4" dur="1"/>', 'meter.count="4" meter.unit="4"').replace('<scoreDef>', '<scoreDef mm="152">')).bpm).toBe(152)
    expect(parseNative(mei('<note pname="c" oct="4" dur="1"/>').replace('<scoreDef>', '<scoreDef mm="60" mm.unit="4" mm.dots="1">')).bpm).toBe(90)
  })

  it('prefers midi.bpm to the metronome mark', () => {
    expect(parseNative(mei('<note pname="c" oct="4" dur="1"/>').replace('<scoreDef>', '<scoreDef mm="152" midi.bpm="100">')).bpm).toBe(100)
  })
})

describe('parseNative: tremolo units that cannot be right', () => {
  it('falls back to the slashes when the stated unit is longer than the note', () => {
    const s = parseNative(mei('<bTrem measperf="1"><note pname="c" oct="4" dur="4" stem.mod="1slash"/></bTrem><rest dur="4"/><rest dur="2"/>'))
    expect(s.notes.map((n) => n.start)).toEqual([0, 0.5])
  })
})

// ── Who made it ──

describe('parseNative: composer and artist', () => {
  const withHead = (head: string) => `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
  <meiHead>${head}</meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5"/></staffGrp></scoreDef>
    <section><measure n="1"><staff n="1"><layer><note pname="c" oct="4" dur="1"/></layer></staff></measure></section>
  </score></mdiv></body></music>
</mei>`
  const read = (head: string) => {
    const s = parseNative(withHead(head))
    return [s.composer, s.artist]
  }

  it('reads a <composer> element, with the names inside it and a space between name parts', () => {
    expect(read('<fileDesc><titleStmt><title>T</title><composer><persName><foreName>Clara</foreName><surname>Schumann</surname></persName> <date>1819–1896</date></composer></titleStmt></fileDesc>'))
      .toEqual(['Clara Schumann', ''])
  })

  it("reads MEI 5's <creator> and a name with a role, in words or as a relator code", () => {
    expect(read('<fileDesc><titleStmt><title>T</title><creator role="composer">Hildegard von Bingen</creator></titleStmt></fileDesc>')[0]).toBe('Hildegard von Bingen')
    expect(read('<fileDesc><titleStmt><title>T</title><respStmt><persName role="cmp">Fanny Hensel</persName></respStmt></titleStmt></fileDesc>')[0]).toBe('Fanny Hensel')
  })

  it('joins names listed together, and ignores the same person named again elsewhere in the header', () => {
    const head = `<fileDesc><titleStmt><title>T</title><respStmt>
        <persName role="composer">John Lennon</persName><persName role="composer">Paul McCartney</persName><persName role="encoder">E. Coder</persName>
      </respStmt></titleStmt>
      <sourceDesc><source><bibl><composer>Lennon, J.</composer></bibl></source></sourceDesc></fileDesc>`
    expect(read(head)[0]).toBe('John Lennon, Paul McCartney')
  })

  it('reads an artist: a performer or band', () => {
    expect(read('<fileDesc><titleStmt><title>T</title><respStmt><persName role="composer">A. Writer</persName><corpName role="artist">The Band</corpName></respStmt></titleStmt></fileDesc>'))
      .toEqual(['A. Writer', 'The Band'])
    expect(read('<fileDesc><titleStmt><title>T</title><creator role="performer">A. Singer</creator></titleStmt></fileDesc>')).toEqual(['', 'A. Singer'])
  })

  it('leaves both empty when the file names no one', () => {
    expect(read('<fileDesc><titleStmt><title>T</title></titleStmt></fileDesc>')).toEqual(['', ''])
  })
})
