import type { MeiBar, MeiNote, MeiPart, MeiScore, MeiWarning } from './types'

/* ===========================================================================
 * The native reader: a small MEI reader with no dependencies.
 *
 * Meant for short, cleanly encoded files. It reads the opening meter, each
 * staff's opening key and the first tempo once, groups the staves into parts
 * (instruments), walks every layer of every measure, and turns notes and chords
 * into MeiNote records, joining tied notes and placing grace notes just before
 * their beat. What it cannot do (repeats, unmarked short bars, mid-piece
 * changes, transposing instruments) it reports as warnings rather than hiding.
 * It is the only reader: the notation view draws with Verovio but times notes
 * from here (docs/decisions.md, 2026-10-17).
 *
 * Browser only: it uses the browser's DOMParser. Tests run it under jsdom.
 * ======================================================================== */

// ── Constants ──

const MEI_NS = 'http://www.music-encoding.org/ns/mei'
const STEP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const SHARP_ORDER = ['f', 'c', 'g', 'd', 'a', 'e', 'b']
const FLAT_ORDER = ['b', 'e', 'a', 'd', 'g', 'c', 'f']
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Layer children that carry no sounding time, so skipping them loses nothing
// a piano roll shows. Anything else unrecognized is reported.
const SILENT_IN_LAYER = new Set(['clef', 'clefGrp', 'barLine', 'custos', 'sb', 'pb', 'cb', 'colLayout', 'annot', 'dot', 'accid', 'artic'])

// ── Warnings ──

/** Collects one warning per kind, counting repeats. */
class Warnings {
  private byCode = new Map<string, MeiWarning>()

  add(code: string, message: string, times = 1): void {
    const w = this.byCode.get(code)
    if (w) w.count += times
    else this.byCode.set(code, { code, message, count: times })
  }

  list(): MeiWarning[] {
    return [...this.byCode.values()]
  }
}

// ── DOM helpers ──

function childrenNamed(parent: Element, name: string): Element[] {
  const out: Element[] = []
  for (const c of Array.from(parent.children)) if (c.localName === name) out.push(c)
  return out
}

// Files are meant to use the MEI namespace, but some older or hand-made ones
// don't; fall back to plain tag names so those still read.
function firstDeep(root: Document | Element, name: string): Element | null {
  const ns = root.getElementsByTagNameNS(MEI_NS, name)
  if (ns.length) return ns[0]
  const plain = root.getElementsByTagName(name)
  return plain.length ? plain[0] : null
}

function allDeep(root: Document | Element, name: string): Element[] {
  let list = root.getElementsByTagNameNS(MEI_NS, name)
  if (!list.length) list = root.getElementsByTagName(name)
  return Array.from(list)
}

// ── Pitch ──

function accidValue(code: string | null): number | null {
  switch (code) {
    case 's': return 1
    case 'ss': case 'x': return 2
    case 'f': return -1
    case 'ff': return -2
    case 'n': return 0
    default: return null
  }
}

function keysigAlter(keysig: string | null, pname: string): number {
  if (!keysig || keysig === '0') return 0
  const m = /^(\d+)\s*([sf])$/.exec(keysig.trim())
  if (!m) return 0
  const count = parseInt(m[1], 10)
  const sharp = m[2] === 's'
  const order = sharp ? SHARP_ORDER : FLAT_ORDER
  for (let i = 0; i < count && i < 7; i++) {
    if (order[i] === pname) return sharp ? 1 : -1
  }
  return 0
}

function noteToMidi(noteEl: Element, keysig: string | null): number | null {
  const pname = (noteEl.getAttribute('pname') || '').toLowerCase()
  const oct = parseInt(noteEl.getAttribute('oct') || '', 10)
  if (!(pname in STEP) || isNaN(oct)) return null

  // A written accidental wins; failing that, the sounding (gestural) one; failing
  // that, the key signature. Accidentals carried through the bar are not applied.
  let alter: number | null =
    accidValue(noteEl.getAttribute('accid')) ?? accidValue(noteEl.getAttribute('accid.ges'))
  if (alter === null) {
    for (const c of childrenNamed(noteEl, 'accid')) {
      const v = accidValue(c.getAttribute('accid')) ?? accidValue(c.getAttribute('accid.ges'))
      if (v !== null) { alter = v; break }
    }
  }
  if (alter === null) alter = keysigAlter(keysig, pname)
  return (oct + 1) * 12 + STEP[pname] + alter
}

export function midiName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)
}

// ── Duration ──

// MEI's @dur is the note value's denominator (4 = quarter, 8 = eighth); the roll
// counts in quarter-note beats, so a quarter is 1 and a half is 2.
function durToBeats(node: Element, scale: number, warn: Warnings): number {
  const durAttr = node.getAttribute('dur')
  if (!durAttr) {
    warn.add('no-dur', 'Notes without a written length take no time.')
    return 0
  }
  let base: number
  if (durAttr === 'long') base = 16
  else if (durAttr === 'breve') base = 8
  else base = 4 / parseInt(durAttr, 10)
  if (!isFinite(base) || base <= 0) {
    warn.add('bad-dur', `Unreadable note lengths (like "${durAttr}") take no time.`)
    return 0
  }
  const dots = parseInt(node.getAttribute('dots') || '0', 10)
  let mult = 1, add = 0.5
  for (let i = 0; i < dots; i++) { mult += add; add /= 2 }
  return base * mult * scale
}

// ── Walking a layer ──

// Carried from bar to bar for each staff and layer: the notes last struck (a
// chord strikes several) and when, so a grace note can take its time from
// them, and the grace notes still waiting for the note they lead into.
interface LayerState {
  last: MeiNote[]
  lastStart: number | null
  graces: { el: Element; beats: number }[]
}

// Every note by its xml:id, and the notes a tie starts from, for joining tied
// notes once the whole file is read.
interface TieIndex {
  byId: Map<string, MeiNote>
  starts: Set<MeiNote>
}

interface LayerEnv {
  resolve: (el: Element) => Element
  keysig: string | null
  part: number
  measureBeats: number
  notes: MeiNote[]
  warn: Warnings
  layer: LayerState
  ties: TieIndex
}

// A chord's tie applies to every note in it that has none of its own.
function pushNote(n: Element, start: number, beats: number, env: LayerEnv, chordTie: string | null = null, tieStart = true): MeiNote | null {
  const midi = noteToMidi(n, env.keysig)
  if (midi === null) {
    env.warn.add('no-pitch', 'Notes without a pitch are left out.')
    return null
  }
  const id = n.getAttribute('xml:id')
  const note: MeiNote = { midi, start, dur: beats, name: midiName(midi), part: env.part, ids: id ? [id] : [] }
  env.notes.push(note)
  if (id && !env.ties.byId.has(id)) env.ties.byId.set(id, note)
  // MEI's tie attribute: i starts a tie, m continues one, t ends it.
  const tie = n.getAttribute('tie') ?? chordTie
  if (tieStart && (tie === 'i' || tie === 'm')) env.ties.starts.add(note)
  return note
}

// Sounds a note, or every note of a chord, and remembers it as the last struck.
function sound(el: Element, start: number, beats: number, env: LayerEnv, tieStart = true): void {
  const struck = el.localName === 'chord'
    ? childrenNamed(el, 'note').map((n) => pushNote(n, start, beats, env, el.getAttribute('tie'), tieStart))
    : [pushNote(el, start, beats, env, null, tieStart)]
  strike(struck, start, env)
}

function strike(notes: (MeiNote | null)[], start: number, env: LayerEnv): void {
  env.layer.last = notes.filter((n): n is MeiNote => n !== null)
  env.layer.lastStart = start
}

// Some files write the duration on each note of a chord instead of on the
// chord itself; then take it from the first note that has one.
function durSourceOf(chord: Element): Element {
  return chord.getAttribute('dur') ? chord : childrenNamed(chord, 'note').find((n) => n.getAttribute('dur')) ?? chord
}

// ── Grace notes ──
// A grace note plays just before its beat, taking its time from the note
// before, so the beat itself stays where it is written. Each takes its written
// length, but a run of them takes at most half the time since the note before,
// so that note is never swallowed. One with no written length is left out.

function queueGrace(el: Element, scale: number, env: LayerEnv): void {
  const source = el.localName === 'chord' ? durSourceOf(el) : el
  if (!source.getAttribute('dur')) {
    env.warn.add('grace-no-dur', 'Grace notes without a written length are left out.')
    return
  }
  env.layer.graces.push({ el, beats: durToBeats(source, scale, env.warn) })
}

/** Places the waiting grace notes so they end at `beat`. */
function placeGraces(beat: number, env: LayerEnv): void {
  const graces = env.layer.graces
  if (!graces.length) return
  env.layer.graces = []
  const room = beat - (env.layer.lastStart ?? 0)
  if (room <= 1e-9) {
    env.warn.add('grace-start', 'Grace notes with no time before them are left out.', graces.length)
    return
  }
  const total = graces.reduce((sum, g) => sum + g.beats, 0)
  const fit = Math.min(1, room / 2 / total)
  let t = beat - total * fit
  for (const n of env.layer.last) if (n.start + n.dur > t) n.dur = Math.max(0, t - n.start)
  for (const g of graces) {
    const beats = g.beats * fit
    const chordTie = g.el.localName === 'chord' ? g.el.getAttribute('tie') : null
    const els = g.el.localName === 'chord' ? childrenNamed(g.el, 'note') : [g.el]
    for (const n of els) pushNote(n, t, beats, env, chordTie)
    t += beats
  }
}

function walkLayer(node: Element, ctx: { t: number }, env: LayerEnv, scale: number, inGrace = false): void {
  for (const raw of Array.from(node.children)) {
    const child = env.resolve(raw)
    const tag = child.localName
    if (tag === 'beam') {
      walkLayer(child, ctx, env, scale, inGrace)
    } else if ((tag === 'bTrem' || tag === 'fTrem') && !inGrace) {
      walkTremolo(child, ctx, env, scale)
    } else if (tag === 'graceGrp') {
      walkLayer(child, ctx, env, scale, true)
    } else if (tag === 'tuplet') {
      // A triplet (num 3, numbase 2) squeezes three notes into the time of two.
      const num = parseInt(child.getAttribute('num') || '3', 10)
      const numbase = parseInt(child.getAttribute('numbase') || '2', 10)
      walkLayer(child, ctx, env, scale * (numbase / num), inGrace)
    } else if (tag === 'chord' || tag === 'note') {
      if (inGrace || child.getAttribute('grace')) {
        queueGrace(child, scale, env)
        continue
      }
      placeGraces(ctx.t, env)
      const beats = durToBeats(tag === 'chord' ? durSourceOf(child) : child, scale, env.warn)
      sound(child, ctx.t, beats, env)
      ctx.t += beats
    } else if (tag === 'rest' || tag === 'space' || tag === 'mRest' || tag === 'mSpace' || tag === 'multiRest') {
      placeGraces(ctx.t, env)
      strike([], ctx.t, env)
      if (tag === 'mRest' || tag === 'mSpace') ctx.t += env.measureBeats
      else if (tag === 'multiRest') ctx.t += env.measureBeats * parseInt(child.getAttribute('num') || '1', 10)
      else ctx.t += durToBeats(child, scale, env.warn)
    } else if (tag === 'keySig' || tag === 'meterSig') {
      env.warn.add('mid-change', 'Only the opening key, meter and tempo are used.')
    } else if (!SILENT_IN_LAYER.has(tag)) {
      env.warn.add(`skipped:${tag}`, `<${tag}> is not shown.`)
    }
  }
}

// ── Tremolos ──
// A measured tremolo is shorthand for notes written out in full, so it plays
// as those notes: a bTrem repeats its note or chord, a fTrem alternates between
// its two, each time for one unit. The unit is the encoding's @unitdur (or
// MEI 3's @measperf), else what the slashes or beams through the stems mean.
// The whole tremolo lasts as long as one of its written notes. A tremolo with
// no unit to go by is unmeasured, "as fast as possible", and plays held.

// The repeated unit, in beats, or null for an unmeasured tremolo. A unit no
// shorter than the tremolo itself can't be right (one file gives measperf="1",
// a whole note, for a dotted quarter), so the next source is tried.
function tremoloUnit(trem: Element, first: Element, span: number, scale: number): number | null {
  const fromValue = (attr: string) => {
    const unit = parseFloat(trem.getAttribute(attr) ?? '')
    return unit > 0 ? (4 / unit) * scale : null
  }
  // One slash (or tremolo beam) halves the note's own shortest value: through a
  // quarter or longer, one slash means eighths; through an eighth, sixteenths.
  const fromMarks = () => {
    const marks = trem.localName === 'bTrem'
      ? parseInt(/^(\d)slash$/.exec(first.getAttribute('stem.mod') ?? trem.getAttribute('stem.mod') ?? '')?.[1] ?? '', 10)
      : parseInt(trem.getAttribute('beams') ?? '', 10)
    if (!(marks > 0)) return null
    const dur = parseInt(durSourceOf(first).getAttribute('dur') ?? '', 10)
    const flags = dur >= 8 ? Math.log2(dur) - 2 : 0
    // A fTrem's beams include the notes' own; a bTrem's slashes come on top of its flags.
    const total = trem.localName === 'fTrem' ? Math.max(marks, flags + 1) : flags + marks
    return (4 / 2 ** (total + 2)) * scale
  }
  for (const unit of [fromValue('unitdur'), fromValue('measperf'), fromMarks()]) {
    if (unit !== null && unit < span - 1e-9) return unit
  }
  return null
}

function walkTremolo(trem: Element, ctx: { t: number }, env: LayerEnv, scale: number): void {
  const items = Array.from(trem.children).map(env.resolve).filter((el) => el.localName === 'note' || el.localName === 'chord')
  const pair = trem.localName === 'fTrem'
  if (!items.length || (pair && items.length !== 2)) {
    walkLayer(trem, ctx, env, scale)
    return
  }
  placeGraces(ctx.t, env)
  const span = durToBeats(durSourceOf(items[0]), scale, env.warn)
  const unit = tremoloUnit(trem, items[0], span, scale)
  // Unmeasured: one held note, or the pair's two halves.
  const count = unit ? Math.max(1, Math.round(span / unit)) : pair ? 2 : 1
  if (!unit) env.warn.add('tremolo-unmeasured', 'Unmeasured tremolos play as held notes.')
  const step = span / count
  for (let i = 0; i < count; i++) {
    // A tie out of the tremolo leaves from its last stroke only.
    sound(pair ? items[i % 2] : items[0], ctx.t + i * step, step, env, i === count - 1)
  }
  ctx.t += span
}

// ── Ties ──
// A tie joins written notes into one sound, so a tied chain becomes one note,
// as long as the whole chain, sounding once. The bar lines still show where
// the written notes fall. A tie is found two ways: a <tie> element naming the
// notes at each end, or a note marked tie="i" or "m", which continues into the
// next note of the same pitch in the same part, starting where it ends.

function joinTies(notes: MeiNote[], ties: TieIndex, music: Document | Element, warn: Warnings): MeiNote[] {
  const key = (part: number, midi: number, beat: number) => `${part}:${midi}:${Math.round(beat * 1e6)}`
  const byOnset = new Map<string, MeiNote>()
  const byEnd = new Map<string, MeiNote>()
  for (const n of notes) {
    if (!byOnset.has(key(n.part, n.midi, n.start))) byOnset.set(key(n.part, n.midi, n.start), n)
    byEnd.set(key(n.part, n.midi, n.start + n.dur), n)
  }
  // The note a tie continues into: same part and pitch, starting where it ends.
  const after = (n: MeiNote) => byOnset.get(key(n.part, n.midi, n.start + n.dur))
  const before = (n: MeiNote) => byEnd.get(key(n.part, n.midi, n.start))

  const next = new Map<MeiNote, MeiNote>()
  let lost = 0
  // A <tie> may name only one end (the other by its beat); find that end by pitch and time.
  for (const el of allDeep(music, 'tie')) {
    let from = ties.byId.get((el.getAttribute('startid') ?? '').replace(/^#/, ''))
    let to = ties.byId.get((el.getAttribute('endid') ?? '').replace(/^#/, ''))
    if (from && !to) to = after(from)
    if (to && !from) from = before(to)
    if (from && to && from !== to) next.set(from, to)
    else lost++
  }
  for (const n of ties.starts) {
    if (next.has(n)) continue
    const to = after(n)
    if (to && to !== n) next.set(n, to)
    else lost++
  }
  if (lost) warn.add('tie', "Some tied notes play separately: the tie's other end wasn't found.", lost)
  if (!next.size) return notes

  // Earliest first, so each chain is joined from its first note.
  const joined = new Set<MeiNote>()
  for (const head of [...notes].sort((a, b) => a.start - b.start)) {
    if (joined.has(head)) continue
    let cur = head
    while (next.has(cur)) {
      const to = next.get(cur)!
      if (joined.has(to) || to === head) break
      head.dur = to.start + to.dur - head.start
      head.ids = [...head.ids ?? [], ...to.ids ?? []]
      joined.add(to)
      cur = to
    }
  }
  return notes.filter((n) => !joined.has(n))
}

// ── Shorthand references ──
// copyof="#id" means "the same content as that element": a shorthand for
// literal repeats (one sample, Schubert's Erlkönig, writes its repeated
// triplets this way). Resolve it to the element it copies.

function makeResolver(doc: Document): (el: Element) => Element {
  // Built on first use, since most files have no copyof at all. A tree walk,
  // not Array.from(getElementsByTagName('*')): in jsdom, copying that live list
  // slows with every element and never finished on a 4 MB sample.
  let byId: Map<string, Element> | null = null
  const index = () => {
    const map = new Map<string, Element>()
    const walker = doc.createTreeWalker(doc, 1 /* NodeFilter.SHOW_ELEMENT */)
    while (walker.nextNode()) {
      const el = walker.currentNode as Element
      const id = el.getAttribute('xml:id')
      if (id) map.set(id, el)
    }
    return map
  }
  return (el) => {
    let current = el
    // A copy of a copy is allowed; the limit only stops a reference loop.
    for (let hops = 0; hops < 8; hops++) {
      const ref = current.getAttribute('copyof')
      if (!ref || current.children.length) return current
      byId ??= index()
      const target = byId.get(ref.replace(/^#/, ''))
      if (!target) return current
      current = target
    }
    return current
  }
}

// ── Opening meter and key ──
// MEI lets a file state these in several places: as attributes on a <staffDef>
// or on the <scoreDef> around it, or (MEI 4 and later) as <meterSig>/<keySig>
// elements inside them. MEI 3 spells the key attribute key.sig. Look in each,
// the staff before the score, so a staff's own value wins.

function firstAttr(els: (Element | null)[], ...names: string[]): string | null {
  for (const el of els) {
    if (!el) continue
    for (const n of names) {
      const v = el.getAttribute(n)
      if (v) return v
    }
  }
  return null
}

interface OpeningMeter {
  count: number
  unit: number
  found: boolean
}

// Order of preference: a staff's own meter (any staff, not only the first),
// then the score's, then a <meterSig> anywhere in the opening definitions, then
// the work's meter in the file's header (<meiHead>), which some files give only there.
function openingMeter(scoreDef: Element | null, doc: Document): OpeningMeter {
  const staffDefs = scoreDef ? allDeep(scoreDef, 'staffDef') : []
  const candidates: Element[] = [
    ...staffDefs.filter((d) => d.getAttribute('meter.count') || d.getAttribute('meter.sym')),
    ...(scoreDef && (scoreDef.getAttribute('meter.count') || scoreDef.getAttribute('meter.sym')) ? [scoreDef] : []),
  ]
  const fromAttrs = candidates.map((el) => meterFrom(el.getAttribute('meter.count'), el.getAttribute('meter.unit'), el.getAttribute('meter.sym')))
  const sig = scoreDef && firstDeep(scoreDef, 'meterSig')
  const head = firstDeep(doc, 'meiHead')
  const headMeter = head && firstDeep(head, 'meter')
  return (
    fromAttrs.find((m) => m.found) ??
    [sig, headMeter].map((el) => meterFrom(el?.getAttribute('count') ?? null, el?.getAttribute('unit') ?? null, el?.getAttribute('sym') ?? null)).find((m) => m.found) ??
    { count: 4, unit: 4, found: false }
  )
}

function meterFrom(countText: string | null, unitText: string | null, sym: string | null): OpeningMeter {
  if (countText && unitText) {
    // An additive meter such as "3+2" counts its parts together.
    const count = countText.split('+').reduce((sum, part) => sum + (parseInt(part, 10) || 0), 0)
    const unit = parseInt(unitText, 10)
    if (count > 0 && unit > 0) return { count, unit, found: true }
  }
  // A meter given only as a symbol: common time is 4/4, cut time 2/2.
  if (sym === 'common') return { count: 4, unit: 4, found: true }
  if (sym === 'cut') return { count: 2, unit: 2, found: true }
  return { count: 4, unit: 4, found: false }
}

function keyOf(def: Element | null): string | null {
  if (!def) return null
  return firstAttr([def], 'keysig', 'key.sig') ?? childrenNamed(def, 'keySig')[0]?.getAttribute('sig') ?? null
}

// Each staff's opening key, by staff number, falling back to the score's.
function openingKeys(scoreDef: Element | null, root: Document | Element): { byStaff: Map<string, string | null>; score: string | null } {
  const score = keyOf(scoreDef)
  const byStaff = new Map<string, string | null>()
  for (const def of allDeep(scoreDef ?? root, 'staffDef')) {
    const n = def.getAttribute('n') || ''
    if (!byStaff.has(n)) byStaff.set(n, keyOf(def) ?? score)
  }
  return { byStaff, score }
}

// ── Parts ──
// A part is one instrument. Most files give each instrument its own staff, but
// a piano or harp spans two staves under a brace, and a group of staves can
// carry one name ("Violini" over the first and second violins). So a group is
// read as one part when it is braced or names an instrument, and its staves
// don't name different instruments; otherwise each staff is its own part, and
// an unnamed staff takes the name of the group around it.

function textOf(el: Element | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// MEI 3 names a staff or group in a label attribute; MEI 4 and later in a
// <label> element.
function labelOf(def: Element): string {
  return (def.getAttribute('label') ?? '').trim() || textOf(childrenNamed(def, 'label')[0])
}

function instrumentOf(def: Element): { instrument?: string; midiProgram?: number } {
  const d = childrenNamed(def, 'instrDef')[0]
  if (!d) return {}
  const name = (d.getAttribute('label') ?? '').trim() || (d.getAttribute('midi.instrname') ?? '').replace(/_/g, ' ').trim()
  const program = parseInt(d.getAttribute('midi.instrnum') ?? '', 10)
  return {
    ...(name ? { instrument: name } : {}),
    ...(program >= 0 && program <= 127 ? { midiProgram: program } : {}),
  }
}

function isOneInstrument(grp: Element): boolean {
  const staves = childrenNamed(grp, 'staffDef')
  if (!staves.length || childrenNamed(grp, 'staffGrp').length) return false
  if (staves.some((d) => childrenNamed(d, 'instrDef').length)) return false
  const names = new Set(staves.map((d) => labelOf(d).toLowerCase()).filter(Boolean))
  if (names.size > 1) return false
  // Notation software often names only a piano's first staff; a name on a
  // later staff alone names that staff (a viola inside a group of violins).
  if (names.size === 1 && !labelOf(staves[0])) return false
  const named = !!nameOfGroup(grp) || childrenNamed(grp, 'instrDef').length > 0
  return named || grp.getAttribute('symbol') === 'brace'
}

// A group's name, if it has one. A bare number ("1") numbers the group; it
// doesn't name an instrument.
function nameOfGroup(grp: Element): string {
  const label = labelOf(grp)
  return /\D/.test(label) ? label : ''
}

// Some files name their instruments only in the header, in a list of
// performers (<perfRes>) numbered like the staves: "Violin I" is n="1". Those
// names are used for staves that have none of their own, and only when the
// list numbers exactly the score's staves, so a list of a different shape
// (one entry per section, say) never names the wrong staff.
function listedInstruments(head: Element | null, scoreDef: Element | null): Map<string, string> {
  const staves = new Set((scoreDef ? allDeep(scoreDef, 'staffDef') : []).map((d) => d.getAttribute('n') ?? ''))
  for (const list of head ? allDeep(head, 'perfResList') : []) {
    const named = new Map(childrenNamed(list, 'perfRes').map((r) => [r.getAttribute('n') ?? '', textOf(r)]))
    if (named.size === staves.size && [...named].every(([n, name]) => staves.has(n) && name)) return named
  }
  return new Map()
}

class PartTable {
  readonly parts: MeiPart[] = []
  private byStaff = new Map<string, number>()

  /** Reads the opening score definition's staves and groups, in score order. */
  constructor(scoreDef: Element | null, private listed = new Map<string, string>()) {
    if (scoreDef) this.visit(scoreDef)
  }

  /** The part a staff belongs to; a staff the definitions never mention gets a part of its own. */
  partOf(staffN: string): number {
    const known = this.byStaff.get(staffN)
    if (known !== undefined) return known
    return this.add([staffN], `Staff ${staffN}`, {})
  }

  private visit(parent: Element, groupLabel = ''): void {
    for (const child of Array.from(parent.children)) {
      if (child.localName === 'staffDef') this.addStaff(child, groupLabel)
      else if (child.localName === 'staffGrp') {
        if (isOneInstrument(child)) this.addGroup(child)
        else this.visit(child, nameOfGroup(child) || groupLabel)
      }
    }
  }

  private addStaff(def: Element, groupLabel: string): void {
    const n = def.getAttribute('n') ?? ''
    if (this.byStaff.has(n)) return
    const inst = instrumentOf(def)
    const label = labelOf(def) || inst.instrument || this.listed.get(n) || textOf(childrenNamed(def, 'labelAbbr')[0]) || groupLabel
    this.add([n], label || `Staff ${n}`, { instrument: inst.instrument ?? (label || undefined), midiProgram: inst.midiProgram })
  }

  private addGroup(grp: Element): void {
    const staves = childrenNamed(grp, 'staffDef').map((d) => d.getAttribute('n') ?? '').filter((n) => !this.byStaff.has(n))
    if (!staves.length) return
    const inst = instrumentOf(grp)
    const staffLabel = childrenNamed(grp, 'staffDef').map(labelOf).find(Boolean)
    const label = inst.instrument || staffLabel || nameOfGroup(grp)
    const fallback = staves.length > 1 ? `Staves ${staves[0]}–${staves[staves.length - 1]}` : `Staff ${staves[0]}`
    this.add(staves, label || fallback, { instrument: label || undefined, midiProgram: inst.midiProgram })
  }

  private add(staves: string[], label: string, inst: { instrument?: string; midiProgram?: number }): number {
    const part: MeiPart = { label, staves }
    if (inst.instrument) part.instrument = inst.instrument
    if (inst.midiProgram !== undefined) part.midiProgram = inst.midiProgram
    this.parts.push(part)
    for (const n of staves) this.byStaff.set(n, this.parts.length - 1)
    return this.parts.length - 1
  }
}

// Parts with no notes (an empty staff, a staff of rests) are dropped, so every
// part a player lists can be heard. Notes are renumbered to match.
function keepSoundingParts(parts: MeiPart[], notes: MeiNote[]): MeiPart[] {
  const used = new Set(notes.map((n) => n.part))
  const renumber = new Map<number, number>()
  const kept: MeiPart[] = []
  parts.forEach((p, i) => {
    if (!used.has(i)) return
    renumber.set(i, kept.length)
    kept.push(p)
  })
  for (const n of notes) n.part = renumber.get(n.part)!
  return kept
}

// ── Whole-file checks ──
// Things the reader knowingly gets wrong, detected up front so they are reported
// even when they don't change a single note.

function checkFile(doc: Document | Element, meter: OpeningMeter, warn: Warnings): void {
  if (!meter.found && allDeep(doc, 'measure').length) {
    warn.add('no-meter', 'No meter given, so bars assume 4/4.')
  }

  const defs = [...allDeep(doc, 'scoreDef'), ...allDeep(doc, 'staffDef')]
  const meters = new Set(defs.map((d) => d.getAttribute('meter.count') && `${d.getAttribute('meter.count')}/${d.getAttribute('meter.unit')}`).filter(Boolean))
  const tempos = new Set(allDeep(doc, 'tempo').map((t) => t.getAttribute('midi.bpm')).filter(Boolean))
  if (meters.size > 1 || tempos.size > 1) {
    warn.add('mid-change', 'Only the opening key, meter and tempo are used.')
  }

  const transposing = allDeep(doc, 'staffDef').filter((s) => s.getAttribute('trans.semi') && s.getAttribute('trans.semi') !== '0')
  if (transposing.length) {
    warn.add('transposing', 'Transposing parts play at written pitch.', transposing.length)
  }

  // An octave line (8va, 8vb) shifts the notes under it; they play as written.
  const octaves = allDeep(doc, 'octave').length
  if (octaves) warn.add('octave', 'Octave lines play at written pitch.', octaves)

  const repeats = allDeep(doc, 'measure').filter((m) => /rpt/.test((m.getAttribute('left') || '') + (m.getAttribute('right') || ''))).length
  if (repeats || allDeep(doc, 'expansion').length) {
    warn.add('repeat', 'Repeats play once.')
  }
}

// ── Who made it ──
// MEI names a composer several ways across its versions: a <composer> element
// (MEI 3 and 4), a <creator> with a role (MEI 5), or a name with a role
// (<persName role="composer">, <corpName role="artist"> for a band). Roles are
// words or MARC relator codes ("cmp", "prf"). Headers often name the same
// person twice, in the title statement and again in a source description,
// spelled differently, so only the first group of names listed together counts.

const COMPOSER_ROLES = new Set(['composer', 'cmp'])
const ARTIST_ROLES = new Set(['artist', 'performer', 'prf'])
const PERSON_ELEMENTS = new Set(['persName', 'corpName', 'name'])
const NAME_ELEMENTS = new Set(['creator', ...PERSON_ELEMENTS])

function hasRole(el: Element, roles: Set<string>): boolean {
  return (el.getAttribute('role') ?? '').toLowerCase().split(/[\s,;]+/).some((r) => roles.has(r))
}

// Text with a space wherever elements meet, so <foreName>Clara</foreName><surname>Schumann</surname>
// reads "Clara Schumann", not "ClaraSchumann".
function spacedText(el: Element): string {
  const words: string[] = []
  const walk = (n: Node) => {
    if (n.nodeType === 3) words.push(n.textContent ?? '')
    else n.childNodes.forEach(walk)
  }
  walk(el)
  return words.join(' ').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim()
}

// 4 is DOCUMENT_POSITION_FOLLOWING, written out because plain Node (the stress
// test) has a DOMParser but no global Node.
const inDocumentOrder = (x: Element, y: Element) => (x.compareDocumentPosition(y) & 4 ? -1 : 1)

// The names of the people credited in a role: from the header, else anywhere
// in the file (a title page drawn in the music). `element` is a dedicated
// element for the role, such as <composer>, which needs no role attribute.
function creditedNames(doc: Document, roles: Set<string>, element?: string): string {
  const head = firstDeep(doc, 'meiHead')
  for (const root of head ? [head, doc] : [doc]) {
    const found = [
      ...(element ? allDeep(root, element) : []),
      ...[...NAME_ELEMENTS].flatMap((name) => allDeep(root, name).filter((el) => hasRole(el, roles))),
    ].sort(inDocumentOrder)
    // A name inside another match (<composer><persName role="composer">) is the same credit.
    const outer = found.filter((el) => !found.some((other) => other !== el && other.contains(el)))
    if (!outer.length) continue
    const group = outer.filter((el) => el.parentNode === outer[0].parentNode)
    const names = group.flatMap((el) => {
      // A <composer> or <creator> may wrap names among other words (dates, "and").
      const inner = PERSON_ELEMENTS.has(el.localName) ? [] : [...PERSON_ELEMENTS]
        .flatMap((name) => allDeep(el, name))
        .filter((c) => !PERSON_ELEMENTS.has(c.parentElement?.localName ?? ''))
        .sort(inDocumentOrder)
      return (inner.length ? inner : [el]).map(spacedText)
    })
    const unique = [...new Set(names.filter(Boolean))]
    if (unique.length) return unique.join(', ')
  }
  return ''
}

// ── Entry point ──

export function parseNative(xmlText: string): MeiScore {
  const doc = new DOMParser().parseFromString(xmlText.trim(), 'application/xml')
  const perr = doc.querySelector('parsererror')
  if (perr) throw new Error('XML parse error: ' + (perr.textContent || '').trim())

  const warn = new Warnings()

  // The title's own words: a <titlePart> inside it ("op. 41", "an electronic
  // transcription") would otherwise run into them without a space.
  const titleEl = firstDeep(doc, 'title')
  const ownWords = titleEl ? Array.from(titleEl.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim() : ''
  const title = ownWords || textOf(titleEl ?? undefined) || 'Untitled'
  const composer = creditedNames(doc, COMPOSER_ROLES, 'composer')
  const artist = creditedNames(doc, ARTIST_ROLES)

  // Only the music itself: a file's header can quote an incipit (its opening
  // bars) in full, and those bars must not be read as the start of the piece.
  const music: Document | Element = firstDeep(doc, 'music') ?? doc
  const resolve = makeResolver(doc)

  const scoreDef = firstDeep(music, 'scoreDef')
  const staffDef = firstDeep(music, 'staffDef')
  const meter = openingMeter(scoreDef, doc)
  const keys = openingKeys(scoreDef, music)
  const partTable = new PartTable(scoreDef, listedInstruments(firstDeep(doc, 'meiHead'), scoreDef))
  const meterCount = meter.count
  const meterUnit = meter.unit
  const measureBeats = meterCount * (4 / meterUnit)

  // Playback tempo first (midi.bpm), then the metronome mark (mm), which counts
  // in its own unit: a dotted quarter at 60 is 90 quarter notes a minute.
  const tempoEls = allDeep(music, 'tempo')
  const withBpm = [...tempoEls, scoreDef, staffDef].find((el) => el?.getAttribute('midi.bpm'))
  const withMm = [...tempoEls, scoreDef, staffDef].find((el) => el?.getAttribute('mm'))
  let bpm = parseFloat(withBpm?.getAttribute('midi.bpm') ?? '')
  if (!(bpm > 0) && withMm) {
    const mm = parseFloat(withMm.getAttribute('mm') ?? '')
    const unit = parseFloat(withMm.getAttribute('mm.unit') ?? '4') || 4
    const dots = parseInt(withMm.getAttribute('mm.dots') ?? '0', 10) || 0
    bpm = mm * (4 / unit) * (2 - 0.5 ** dots)
  }
  if (!(bpm > 0)) bpm = 120

  checkFile(music, meter, warn)

  const read: MeiNote[] = []
  const ties: TieIndex = { byId: new Map(), starts: new Set() }
  const layers = new Map<string, LayerState>()
  const bars: MeiBar[] = []
  let measureStart = 0
  let maxEnd = 0
  const measures = allDeep(music, 'measure')
  if (!measures.length) warn.add('no-measures', 'No measures to show.')

  measures.forEach((measure, i) => {
    bars.push({ start: measureStart, label: measure.getAttribute('n') || String(i + 1) })
    let measureMax = measureStart
    for (const staff of allDeep(resolve(measure), 'staff').map(resolve)) {
      const keysig = keys.byStaff.get(staff.getAttribute('n') || '') ?? keys.score
      const part = partTable.partOf(staff.getAttribute('n') || '')
      allDeep(staff, 'layer').map(resolve).forEach((layer, li) => {
        const layerKey = `${staff.getAttribute('n') || ''}/${layer.getAttribute('n') || li + 1}`
        let state = layers.get(layerKey)
        if (!state) layers.set(layerKey, (state = { last: [], lastStart: null, graces: [] }))
        const ctx = { t: measureStart }
        const env: LayerEnv = { resolve, keysig, part, measureBeats, notes: read, warn, layer: state, ties }
        walkLayer(layer, ctx, env, 1)
        // Grace notes left at the end of a layer lead into its end.
        placeGraces(ctx.t, env)
        if (ctx.t > measureMax) measureMax = ctx.t
      })
    }
    const content = measureMax - measureStart
    // metcon="false" is MEI's flag for a bar that is meant to be short (a
    // pickup, or the bar that completes it): it keeps its real length. An
    // unflagged short bar is more likely an encoding slip, so it is padded to a
    // full bar, as before, and reported.
    const meantShort = measure.getAttribute('metcon') === 'false'
    if (content > 0 && content < measureBeats - 1e-6) {
      if (meantShort) {
        measureStart += content
      } else {
        warn.add('short-bar', 'Short bars are padded to full length.')
        measureStart += measureBeats
      }
    } else {
      measureStart += Math.max(measureBeats, content)
    }
    if (measureMax > maxEnd) maxEnd = measureMax
  })

  const notes = joinTies(read, ties, music, warn)

  return {
    title,
    composer,
    artist,
    bpm,
    meterCount,
    meterUnit,
    measureBeats,
    bars,
    totalBeats: Math.max(maxEnd, measureStart),
    parts: keepSoundingParts(partTable.parts, notes),
    notes,
    warnings: warn.list(),
  }
}
