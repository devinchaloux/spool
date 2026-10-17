import type { TimemapEntry, VerovioToolkit } from 'verovio/esm'
import type { MeiBar, MeiNote, MeiScore } from './types'
import {
  Warnings, PartTable, allDeep, childrenNamed, credits, durSourceOf, durToBeats, firstDeep, joinTies,
  keepSoundingParts, keyOf, listedInstruments, midiName, noteToMidi, openingMeter, tremoloUnit, type TieIndex,
} from './parseNative'

/* ===========================================================================
 * The Verovio reader: any MEI file, timed by the Verovio toolkit.
 *
 * Verovio (verovio.org, LGPL-3.0) works out when every note sounds: repeats
 * played out, bars at their real length, meter changes, and one reading where
 * the file gives several. Everything else follows the native reader's rules
 * (parseNative.ts), so both readers give the same roll for the same music:
 * pitch from the key signature in force, parts, ties, grace notes just before
 * their beat, tremolos as the notes they stand for, and the credits. Verovio
 * leaves the key signature and transposition out of the pitches it reports,
 * plays tremolos held and grace notes as slivers, so those are worked out
 * here from the encoding as Verovio exports it, every element with an id.
 *
 * Verovio is a separate download, about 2.4 MB compressed, fetched the first
 * time a file needs it. Like the native reader, it needs a DOMParser (the
 * browser's, or jsdom's in Node).
 * ======================================================================== */

// ── Loading Verovio ──

let toolkit: Promise<VerovioToolkit> | null = null

function loadToolkit(): Promise<VerovioToolkit> {
  toolkit ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit, enableLog, LOG_OFF }] =
      await Promise.all([import('verovio/wasm'), import('verovio/esm')])
    const engine = await createVerovioModule()
    // Verovio logs every quirk of an encoding to the console; what the roll
    // leaves out is reported as warnings instead.
    enableLog(LOG_OFF, engine)
    return new VerovioToolkit(engine)
  })().catch((err: unknown) => {
    // A failed download is tried again the next time a file needs it.
    toolkit = null
    throw err
  })
  return toolkit
}

// ── Where each note stands ──
// The staff and layer a note is in, and the key and transposition in force
// there. A walk in document order follows changes as they come: a <scoreDef>
// resets every staff, a <staffDef> or a <keySig> in a layer changes one.

interface Place {
  staff: string
  layer: string
  keysig: string | null
  /** Semitones from written to sounding pitch (trans.semi). */
  trans: number
}

function transOf(def: Element): number | null {
  const semi = parseInt(def.getAttribute('trans.semi') ?? '', 10)
  return isNaN(semi) ? null : semi
}

function placesOf(music: Element): Map<Element, Place> {
  const places = new Map<Element, Place>()
  let staff = ''
  let layer = ''
  let scoreKey: string | null = null
  let scoreTrans = 0
  const staffKeys = new Map<string, string | null>()
  const staffTrans = new Map<string, number>()
  const walker = music.ownerDocument.createTreeWalker(music, 1 /* NodeFilter.SHOW_ELEMENT */)
  while (walker.nextNode()) {
    const el = walker.currentNode as Element
    switch (el.localName) {
      case 'scoreDef': {
        const key = keyOf(el)
        if (key) { scoreKey = key; staffKeys.clear() }
        const trans = transOf(el)
        if (trans !== null) { scoreTrans = trans; staffTrans.clear() }
        break
      }
      case 'staffDef': {
        const n = el.getAttribute('n') ?? ''
        const key = keyOf(el)
        if (key) staffKeys.set(n, key)
        const trans = transOf(el)
        if (trans !== null) staffTrans.set(n, trans)
        break
      }
      case 'keySig': {
        // One inside a definition is read with it, above.
        const parent = el.parentElement?.localName
        if (parent !== 'scoreDef' && parent !== 'staffDef' && el.getAttribute('sig')) staffKeys.set(staff, el.getAttribute('sig'))
        break
      }
      case 'staff':
        staff = el.getAttribute('n') ?? ''
        layer = ''
        break
      case 'layer':
        layer = el.getAttribute('n') ?? ''
        break
      case 'note': case 'rest': case 'mRest': case 'multiRest':
        places.set(el, { staff, layer, keysig: staffKeys.get(staff) ?? scoreKey, trans: staffTrans.get(staff) ?? scoreTrans })
    }
  }
  return places
}

// ── The encoding as Verovio exports it ──

function indexIds(doc: Document): Map<string, Element> {
  const byId = new Map<string, Element>()
  const walker = doc.createTreeWalker(doc, 1 /* NodeFilter.SHOW_ELEMENT */)
  while (walker.nextNode()) {
    const el = walker.currentNode as Element
    const id = el.getAttribute('xml:id')
    if (id) byId.set(id, el)
  }
  return byId
}

function hasAncestor(el: Element, names: Set<string>): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (names.has(p.localName)) return true
  return false
}

// copyof="#id" means "the same content as that element". Verovio times the
// copy but exports it as an empty shell (a copied chord keeps one note, with
// no pitch), so the notes are read from the element it copies, found by the
// same path below the copied ancestor.
function makeSourceOf(byId: Map<string, Element>): (el: Element) => Element {
  return (el) => {
    let copy: Element | null = el
    const path: number[] = []
    while (copy && !copy.getAttribute('copyof')) {
      const parent: Element | null = copy.parentElement
      if (!parent || copy.localName === 'measure') return el
      path.unshift(Array.from(parent.children).indexOf(copy))
      copy = parent
    }
    if (!copy) return el
    let target: Element | undefined = copy
    // A copy of a copy is allowed; the limit only stops a reference loop.
    for (let hops = 0; hops < 8 && target?.getAttribute('copyof'); hops++) {
      target = byId.get(target.getAttribute('copyof')!.replace(/^#/, ''))
    }
    for (const i of path) target = target?.children[i]
    return target ?? el
  }
}

// A note's grace type, from itself, its chord or its <graceGrp>; null if it
// is not a grace note. A <graceGrp> without one is still grace notes.
function graceOf(holder: Element): string | null {
  const own = holder.getAttribute('grace')
  if (own) return own
  for (let p = holder.parentElement; p && p.localName !== 'layer'; p = p.parentElement) {
    if (p.localName === 'graceGrp') return p.getAttribute('grace') || 'unacc'
  }
  return null
}

// ── Entry point ──

/**
 * Reads an MEI file with Verovio, which is downloaded the first time. Rejects
 * if Verovio can't be loaded or can't read the file.
 */
export async function parseVerovio(text: string): Promise<MeiScore> {
  const tk = await loadToolkit()
  tk.resetOptions()
  if (!tk.loadData(text)) throw new Error("Verovio couldn't read this file.")
  const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: true })
  const doc = new DOMParser().parseFromString(tk.getMEI(), 'application/xml')
  return readTimemap(doc, timemap, (id) => tk.getNotatedIdForElement(id))
}

// What sounds at one moment in one layer: a note, a chord, or a rest.
interface Event {
  start: number
  end: number
  /** The note or chord as encoded; null for a rest. */
  holder: Element | null
  /** The notes Verovio played for it, as encoded. */
  played: Element[]
  place: Place
}

function readTimemap(doc: Document, timemap: TimemapEntry[], notatedId: (id: string) => string): MeiScore {
  const warn = new Warnings()
  const music = firstDeep(doc, 'music') ?? doc.documentElement
  const byId = indexIds(doc)
  const places = placesOf(music)
  const sourceOf = makeSourceOf(byId)
  // A note in a repeat played out has an id of Verovio's making; look it up
  // by the id of the note as written.
  const elementOf = (id: string) => byId.get(id) ?? byId.get(notatedId(id))

  const scoreDef = firstDeep(music, 'scoreDef')
  const meter = openingMeter(scoreDef, doc)
  const measureBeats = meter.count * (4 / meter.unit)
  const partTable = new PartTable(scoreDef, listedInstruments(firstDeep(doc, 'meiHead'), scoreDef))

  // ── When each note sounds, from the timemap ──

  const end = new Map<string, number>()
  for (const entry of timemap) for (const id of [...entry.off ?? [], ...entry.restsOff ?? []]) end.set(id, entry.qstamp)

  const layers = new Map<string, Event[]>()
  const bars: MeiBar[] = []
  const barsSeen = new Set<Element>()
  let repeated = false
  const tempos = new Set<number>()
  const played = new Set<Element>()
  let lastBeat = 0

  for (const entry of timemap) {
    lastBeat = Math.max(lastBeat, entry.qstamp)
    if (entry.tempo) tempos.add(entry.tempo)
    if (entry.measureOn) {
      const measure = elementOf(entry.measureOn)
      if (measure && barsSeen.has(measure)) repeated = true
      if (measure) barsSeen.add(measure)
      bars.push({ start: entry.qstamp, label: measure?.getAttribute('n') || String(bars.length + 1) })
    }
    // Notes of one chord start together; gather them into one event.
    const events = new Map<Element, Event>()
    const add = (id: string, rest: boolean) => {
      const el = elementOf(id)
      const place = el && places.get(el)
      if (!el || !place) return
      const holder = rest ? null : el.parentElement?.localName === 'chord' ? el.parentElement : el
      let ev = events.get(holder ?? el)
      if (!ev) {
        ev = { start: entry.qstamp, end: end.get(id) ?? entry.qstamp, holder, played: [], place }
        events.set(holder ?? el, ev)
        const key = `${place.staff}/${place.layer}`
        const layer = layers.get(key)
        if (layer) layer.push(ev)
        else layers.set(key, [ev])
      }
      if (!rest) { ev.played.push(el); played.add(el) }
    }
    for (const id of entry.on ?? []) add(id, false)
    for (const id of entry.restsOn ?? []) add(id, true)
  }

  // ── Notes, as the native reader makes them ──

  const read: MeiNote[] = []
  const ties: TieIndex = { byId: new Map(), starts: new Set() }
  // A <tie> names the notes it joins the first time they sound; when a repeat
  // sounds them again, the tie continues into the next note of the same pitch.
  const tieStarts = new Set(allDeep(music, 'tie').map((t) => (t.getAttribute('startid') ?? '').replace(/^#/, '')))

  const addNote = (n: Element, chord: Element | null, start: number, dur: number, place: Place, tieStart: boolean): MeiNote | null => {
    const written = noteToMidi(n, place.keysig)
    if (written === null) {
      warn.add('no-pitch', 'Notes without a pitch are left out.')
      return null
    }
    const midi = written + place.trans
    const note: MeiNote = { midi, start, dur, name: midiName(midi), part: partTable.partOf(place.staff) }
    read.push(note)
    const id = n.getAttribute('xml:id')
    const again = !!id && ties.byId.has(id)
    if (id && !again) ties.byId.set(id, note)
    // MEI's tie attribute: i starts a tie, m continues one, t ends it.
    const tie = n.getAttribute('tie') ?? chord?.getAttribute('tie') ?? null
    if (tieStart && (tie === 'i' || tie === 'm' || (again && tieStarts.has(id ?? '')))) ties.starts.add(note)
    return note
  }

  // The notes an event sounds: a copy's come from what it copies.
  const notesOf = (ev: Event): { chord: Element | null; notes: Element[] } => {
    const holder = ev.holder!
    const source = sourceOf(holder)
    if (source === holder) return { chord: holder.localName === 'chord' ? holder : null, notes: ev.played }
    return source.localName === 'chord' ? { chord: source, notes: childrenNamed(source, 'note') } : { chord: null, notes: [source] }
  }

  const sound = (ev: Event, start: number, dur: number, tieStart = true): MeiNote[] => {
    const { chord, notes } = notesOf(ev)
    return notes.map((n) => addNote(n, chord, start, dur, ev.place, tieStart)).filter((n): n is MeiNote => n !== null)
  }

  // ── Tremolos ──
  // Verovio plays a <bTrem> as one held note and splits an <fTrem> into two
  // halves; written out here as the native reader does, over the same span.
  // Returns the notes of the last stroke and when it starts.
  const soundTremolo = (ev: Event, trem: Element): { notes: MeiNote[]; start: number } => {
    const items = Array.from(trem.children).filter((el) => el.localName === 'note' || el.localName === 'chord')
    const pair = trem.localName === 'fTrem' && items.length === 2
    const k = pair ? items.indexOf(ev.holder!) : 0
    const half = ev.end - ev.start
    const from = ev.start - k * half
    const span = pair ? 2 * half : half
    const written = durToBeats(durSourceOf(items[0] ?? ev.holder!), 1, new Warnings())
    const unit = tremoloUnit(trem, items[0] ?? ev.holder!, span, written > 0 ? span / written : 1)
    const count = unit ? Math.max(1, Math.round(span / unit)) : pair ? 2 : 1
    if (!unit && k === 0) warn.add('tremolo-unmeasured', 'Unmeasured tremolos play as held notes.')
    const step = span / count
    let last = { notes: [] as MeiNote[], start: ev.start }
    for (let i = pair ? k : 0; i < count; i += pair ? 2 : 1) {
      // A tie out of the tremolo leaves from its last stroke only.
      last = { notes: sound(ev, from + i * step, step, i === count - 1), start: from + i * step }
    }
    return last
  }

  // ── Grace notes ──
  // The native reader's rule: just before the beat, taking time from the note
  // before; each its written length, but a run of them at most half the time
  // since that note. Verovio plays accented grace notes (grace="acc") on the
  // beat, delaying the main note, so for those the beat is where they start.
  const placeGraces = (run: Event[], beat: number, last: MeiNote[], lastStart: number | null) => {
    const graces: { ev: Event; beats: number }[] = []
    for (const ev of run) {
      const source = ev.holder!.localName === 'chord' ? durSourceOf(ev.holder!) : ev.holder!
      if (!source.getAttribute('dur')) warn.add('grace-no-dur', 'Grace notes without a written length are left out.')
      else graces.push({ ev, beats: durToBeats(source, 1, warn) })
    }
    if (!graces.length) return
    const room = beat - (lastStart ?? 0)
    if (room <= 1e-9) {
      warn.add('grace-start', 'Grace notes with no time before them are left out.', graces.length)
      return
    }
    const total = graces.reduce((sum, g) => sum + g.beats, 0)
    const fit = Math.min(1, room / 2 / total)
    let t = beat - total * fit
    for (const n of last) if (n.start + n.dur > t) n.dur = Math.max(0, t - n.start)
    for (const g of graces) {
      sound(g.ev, t, g.beats * fit)
      t += g.beats * fit
    }
  }

  for (const events of layers.values()) {
    let last: MeiNote[] = []
    let lastStart: number | null = null
    let run: Event[] = []
    const onBeat = () => graceOf(run[0].holder!) === 'acc'
    for (const ev of events) {
      if (ev.holder && graceOf(ev.holder)) {
        run.push(ev)
        continue
      }
      if (run.length) {
        if (onBeat()) ev.start = run[0].start
        placeGraces(run, ev.start, last, lastStart)
        run = []
      }
      if (!ev.holder) {
        last = []
        lastStart = ev.start
        continue
      }
      const trem = ev.holder.parentElement
      if (trem && (trem.localName === 'bTrem' || trem.localName === 'fTrem')) {
        const stroke = soundTremolo(ev, trem)
        last = stroke.notes
        lastStart = stroke.start
      } else {
        last = sound(ev, ev.start, ev.end - ev.start)
        lastStart = ev.start
      }
    }
    // Grace notes at the end of a layer lead into its end.
    if (run.length) placeGraces(run, onBeat() ? run[0].start : run[run.length - 1].end, last, lastStart)
  }

  const notes = joinTies(read, ties, music, warn)

  // ── What the roll leaves out ──

  if (tempos.size > 1) warn.add('tempo-change', 'Only the opening tempo is used.')
  const octaves = allDeep(music, 'octave').length
  if (octaves) warn.add('octave', 'Octave lines play at written pitch.', octaves)
  const readings = allDeep(music, 'app').length + allDeep(music, 'choice').length
  if (readings) warn.add('reading', 'Where the file gives alternative readings, only the main or first one plays.', readings)
  const marked = allDeep(music, 'measure').some((m) => /rpt/.test((m.getAttribute('left') || '') + (m.getAttribute('right') || '')))
  if ((marked || allDeep(music, 'expansion').length) && !repeated) warn.add('repeat', 'Repeats play once.')
  // Notes Verovio never timed, apart from the readings it didn't choose.
  const alternatives = new Set(['app', 'choice', 'subst'])
  const unplaced = allDeep(music, 'note').filter((n) => !played.has(n) && !hasAncestor(n, alternatives)).length
  if (unplaced) warn.add('unplaced', "Some notes couldn't be placed in time and are left out.", unplaced)

  return {
    ...credits(doc),
    bpm: [...tempos][0] ?? 120,
    meterCount: meter.count,
    meterUnit: meter.unit,
    measureBeats,
    bars,
    totalBeats: notes.reduce((t, n) => Math.max(t, n.start + n.dur), lastBeat),
    parts: keepSoundingParts(partTable.parts, notes),
    notes,
    warnings: warn.list(),
    reader: 'verovio',
  }
}
