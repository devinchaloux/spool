// @vitest-environment jsdom
import { parseNative } from '../mei/parseNative'
import { parseVerovio } from '../mei/parseVerovio'
import { readMei } from '../mei/read'
import type { MeiScore } from '../mei/types'

// ── Helpers ──
// Short MEI written for these tests, as in parseNative.test.ts. Verovio itself
// runs here, in Node, from the installed package: no network needed.

function mei(measures: string, scoreDef = 'meter.count="4" meter.unit="4"', staffDef = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead><fileDesc><titleStmt><title>Test</title><composer>Tester</composer></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef ${scoreDef}><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2" ${staffDef}/></staffGrp></scoreDef>
    <section>${measures}</section>
  </score></mdiv></body></music>
</mei>`
}

const bar = (n: number | string, layer: string, attrs = '') =>
  `<measure n="${n}" ${attrs}><staff n="1"><layer n="1">${layer}</layer></staff></measure>`

const sounds = (s: MeiScore) => s.notes
  .map((n) => [n.name, +n.start.toFixed(4), +n.dur.toFixed(4)] as const)
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
const codes = (s: MeiScore) => s.warnings.map((w) => w.code)

// ── The same roll as the native reader ──

describe('parseVerovio: agrees with the native reader', () => {
  const cases: Record<string, string> = {
    'notes, rests, chords and tuplets': mei(
      bar(1, '<note pname="c" oct="4" dur="4"/><rest dur="4"/><chord dur="4"><note pname="e" oct="4"/><note pname="g" oct="4"/></chord><tuplet num="3" numbase="2"><note pname="c" oct="5" dur="8"/><note pname="d" oct="5" dur="8"/><note pname="e" oct="5" dur="8"/></tuplet>') +
      bar(2, '<note pname="f" oct="4" dur="2" dots="1"/><note pname="f" oct="4" dur="4"/>')),
    'the key signature and written accidentals': mei(
      bar(1, '<note pname="f" oct="4" dur="4"/><note pname="f" oct="4" dur="4" accid="n"/><note pname="b" oct="4" dur="4" accid.ges="f"/><note pname="c" oct="5" dur="4"/>'), 'meter.count="4" meter.unit="4" keysig="1s"'),
    'ties, by attribute and by element': mei(
      bar(1, '<rest dur="2"/><note pname="c" oct="4" dur="2" tie="i"/>') +
      `<measure n="2"><staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" tie="t"/><note xml:id="e1" pname="e" oct="4" dur="2"/></layer></staff></measure>` +
      `<measure n="3"><staff n="1"><layer n="1"><note xml:id="e2" pname="e" oct="4" dur="1"/></layer></staff><tie startid="#e1" endid="#e2"/></measure>`),
    'grace notes before the beat': mei(
      bar(1, '<note pname="c" oct="5" dur="2"/><note pname="d" oct="5" dur="16" grace="unacc"/><note pname="c" oct="5" dur="2"/>') +
      bar(2, '<note pname="c" oct="5" dur="2"/><graceGrp><note pname="d" oct="5" dur="16"/><note pname="e" oct="5" dur="16"/></graceGrp><note pname="c" oct="5" dur="2"/>') +
      bar(3, '<note pname="c" oct="5" dur="2"/><note pname="d" oct="5" dur="8" grace="acc"/><note pname="e" oct="5" dur="2"/>')),
    'measured tremolos': mei(
      bar(1, '<bTrem><note pname="c" oct="4" dur="4" stem.mod="2slash"/></bTrem><rest dur="4"/><fTrem unitdur="8"><note pname="c" oct="4" dur="4"/><note pname="e" oct="4" dur="4"/></fTrem>')),
    'a copied chord': mei(
      bar(1, '<chord xml:id="c1" dur="4"><note pname="c" oct="4"/><note pname="e" oct="4"/></chord><chord copyof="#c1"/><rest dur="2"/>')),
  }
  for (const [name, xml] of Object.entries(cases)) {
    it(name, async () => {
      expect(sounds(await parseVerovio(xml))).toEqual(sounds(parseNative(xml)))
    })
  }

  it('reads the same title, credits, parts and opening meter', async () => {
    const xml = cases['ties, by attribute and by element']
    const v = await parseVerovio(xml)
    const n = parseNative(xml)
    expect([v.title, v.composer, v.parts, v.meterCount, v.meterUnit, v.reader]).toEqual([n.title, n.composer, n.parts, n.meterCount, n.meterUnit, 'verovio'])
    expect(v.warnings).toEqual([])
  })
})

// ── What Verovio adds ──

describe('parseVerovio: what the native reader leaves out', () => {
  it('plays repeats out, numbering the bars as written', async () => {
    const s = await parseVerovio(mei(
      bar(1, '<note pname="c" oct="4" dur="1"/>', 'left="rptstart"') +
      bar(2, '<note pname="d" oct="4" dur="1"/>', 'right="rptend"') +
      bar(3, '<note pname="e" oct="4" dur="1"/>')))
    expect(s.notes.map((n) => n.name)).toEqual(['C4', 'D4', 'C4', 'D4', 'E4'])
    expect(s.bars.map((b) => b.label)).toEqual(['1', '2', '1', '2', '3'])
    expect(s.totalBeats).toBe(20)
    expect(codes(s)).not.toContain('repeat')
  })

  it('keeps a short bar at its real length, flagged or not', async () => {
    const s = await parseVerovio(mei(bar(0, '<note pname="g" oct="4" dur="4"/>') + bar(1, '<note pname="c" oct="5" dur="1"/>')))
    expect(s.bars.map((b) => b.start)).toEqual([0, 1])
    expect(s.notes[1].start).toBe(1)
    expect(codes(s)).not.toContain('short-bar')
  })

  it('follows a change of meter', async () => {
    const s = await parseVerovio(mei(
      bar(1, '<note pname="c" oct="4" dur="1"/>') +
      '<scoreDef meter.count="3" meter.unit="4"/>' +
      bar(2, '<note pname="d" oct="4" dur="2" dots="1"/>') +
      bar(3, '<note pname="e" oct="4" dur="2" dots="1"/>')))
    expect(s.bars.map((b) => b.start)).toEqual([0, 4, 7])
    expect(s.measureBeats).toBe(4)
  })

  it('follows a change of key', async () => {
    const s = await parseVerovio(mei(
      bar(1, '<note pname="f" oct="4" dur="1"/>') +
      '<scoreDef keysig="1f"/>' +
      bar(2, '<note pname="f" oct="4" dur="2"/><note pname="b" oct="4" dur="2"/>'), 'meter.count="4" meter.unit="4" keysig="1s"'))
    expect(s.notes.map((n) => n.name)).toEqual(['F#4', 'F4', 'A#4'])
  })

  it('plays a transposing part at sounding pitch', async () => {
    // A clarinet in A: written C sounds A, a minor third lower.
    const s = await parseVerovio(mei(bar(1, '<note pname="c" oct="5" dur="1"/>'), 'meter.count="4" meter.unit="4"', 'trans.semi="-3" trans.diat="-2"'))
    expect(s.notes[0].name).toBe('A4')
    expect(codes(s)).not.toContain('transposing')
  })

  it('plays one reading where the file gives several, and says so', async () => {
    const s = await parseVerovio(mei(bar(1, '<app><lem><note pname="c" oct="4" dur="1"/></lem><rdg><note pname="d" oct="4" dur="1"/></rdg></app>')))
    expect(s.notes.map((n) => n.name)).toEqual(['C4'])
    expect(codes(s)).toEqual(['reading'])
  })

  it('takes the opening tempo, and reports a change', async () => {
    const s = await parseVerovio(mei(
      `<measure n="1"><staff n="1"><layer n="1"><note pname="c" oct="4" dur="1"/></layer></staff><tempo staff="1" tstamp="1" midi.bpm="60">Adagio</tempo></measure>` +
      `<measure n="2"><staff n="1"><layer n="1"><note pname="c" oct="4" dur="1"/></layer></staff><tempo staff="1" tstamp="1" midi.bpm="90">Allegro</tempo></measure>`))
    expect(s.bpm).toBe(60)
    expect(s.notes.map((n) => n.start)).toEqual([0, 4])
    expect(codes(s)).toEqual(['tempo-change'])
  })

  it('rejects what it cannot read', async () => {
    await expect(parseVerovio('not music')).rejects.toThrow(/couldn't read/)
  })
})

// ── Choosing a reader ──

describe('readMei', () => {
  const clean = mei(bar(1, '<note pname="c" oct="4" dur="1"/>'))
  const repeated = mei(bar(1, '<note pname="c" oct="4" dur="1"/>', 'right="rptend"'))

  it('uses the native reader when it leaves nothing out that Verovio fills', async () => {
    expect((await readMei(clean)).reader).toBe('native')
  })

  it('uses Verovio when the native reader reports a gap it fills', async () => {
    const s = await readMei(repeated)
    expect(s.reader).toBe('verovio')
    expect(s.notes).toHaveLength(2)
  })

  it('uses the reader asked for', async () => {
    expect((await readMei(repeated, 'native')).reader).toBe('native')
    expect((await readMei(clean, 'verovio')).reader).toBe('verovio')
  })
})
