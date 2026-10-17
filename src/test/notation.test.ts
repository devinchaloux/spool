// @vitest-environment jsdom
import { parseNative } from '../mei/parseNative'
import { withNoteIds } from '../mei/noteIds'
import { engrave } from '../notation/engrave'

// ── Helpers ──
// Short MEI written for these tests. Verovio runs here, in Node, from the
// installed package: no network needed.

function mei(layer: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead><fileDesc><titleStmt><title>Test</title></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>
    <section><measure n="1"><staff n="1"><layer n="1">${layer}</layer></staff></measure></section>
  </score></mdiv></body></music>
</mei>`
}

// ── Naming the notes ──

describe('note ids', () => {
  it('records the id of the note each sound comes from', () => {
    const s = parseNative(mei('<note xml:id="a" pname="c" oct="4" dur="2"/><note pname="d" oct="4" dur="2"/>'))
    expect(s.notes.map((n) => n.ids)).toEqual([['a'], []])
  })

  it('records every note of a tied chain on the one sound', () => {
    const s = parseNative(mei('<note xml:id="a" pname="c" oct="4" dur="2" tie="i"/><note xml:id="b" pname="c" oct="4" dur="2" tie="t"/>'))
    expect(s.notes.map((n) => n.ids)).toEqual([['a', 'b']])
  })

  it('gives every note without an id one of its own, in order', () => {
    const xml = withNoteIds(mei('<note pname="c" oct="4" dur="2"/><note xml:id="spool-note-2" pname="d" oct="4" dur="4"/><note pname="e" oct="4" dur="4"/>'))
    expect(parseNative(xml).notes.map((n) => n.ids)).toEqual([['spool-note-1'], ['spool-note-2'], ['spool-note-3']])
  })

  it('leaves a file whose notes all have ids as it is', () => {
    const xml = mei('<note xml:id="a" pname="c" oct="4" dur="1"/>')
    expect(withNoteIds(xml)).toBe(xml)
  })
})

// ── Engraving ──

describe('engrave', () => {
  it('draws the notes as notation, named by their ids', async () => {
    const xml = withNoteIds(mei('<note pname="c" oct="4" dur="2"/><note pname="e" oct="4" dur="2"/>'))
    const e = await engrave(xml)
    expect(e.svg).toMatch(/^<svg/)
    expect(e.svg).toContain('id="spool-note-1" class="note"')
    expect(e.svg).toContain('id="spool-note-2" class="note"')
    expect(e.width).toBeGreaterThan(0)
    expect(e.height).toBeGreaterThan(0)
  })

  it('rejects what it cannot draw', async () => {
    await expect(engrave('not music')).rejects.toThrow(/Couldn't show this file as notation/)
  })
})
