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
 * plays tremolos held and times grace notes its own way, so those are worked
 * out here from the encoding as Verovio exports it, every element with an id.
 * Grace notes are taken out before Verovio reads the file, so they can't
 * move the notes around them, and put back by the native reader's rule.
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

// ── Before Verovio reads the file ──
// What Verovio mistimes is written out first, as the native reader reads it:
// - copyof="#id" means "the same content as that element" (Schubert's
//   Erlkönig writes its repeated chords this way). Verovio times a copy as if
//   it had no written length, and a copied chord sounds one note.
// - A chord whose length is written on its notes, not on the chord, which
//   Verovio times as a quarter note. It takes its notes' length.
// - Grace notes. Verovio plays some on the beat, delaying the main note, and
//   others by shortening the note before. They are taken out and remembered
//   by the note they lead into, or, at the end of a layer, the note they
//   follow.

const XML_NS = 'http://www.w3.org/XML/1998/namespace'

// Layer contents that take their turn in time.
const IN_TIME = new Set(['note', 'chord', 'rest', 'mRest', 'multiRest', 'space', 'mSpace'])

interface Grace {
  /** The grace note or chord, as encoded. */
  holder: Element
  /** Its written length in beats, or null if it has none. */
  beats: number | null
}

interface Graces {
  /** Grace notes by the id of the note, chord or rest they lead into. */
  before: Map<string, Grace[]>
  /** Grace notes at the end of a layer, by the id of what they follow. */
  after: Map<string, Grace[]>
}

interface Prepared {
  text: string
  graces: Graces
}

function prepareForVerovio(text: string): Prepared {
  const graces: Graces = { before: new Map(), after: new Map() }
  const doc = new DOMParser().parseFromString(text.trim(), 'application/xml')
  if (doc.querySelector('parsererror')) return { text, graces }
  let changed = writeOutCopies(doc)
  for (const chord of allDeep(doc, 'chord')) {
    if (chord.getAttribute('dur') || chord.getAttribute('copyof')) continue
    const source = durSourceOf(chord)
    if (source === chord) continue
    chord.setAttribute('dur', source.getAttribute('dur')!)
    if (source.getAttribute('dots')) chord.setAttribute('dots', source.getAttribute('dots')!)
    changed = true
  }
  if (takeOutGraces(doc, graces)) changed = true
  return { text: changed ? doc.documentElement.outerHTML : text, graces }
}

function writeOutCopies(doc: Document): boolean {
  const byId = indexIds(doc)
  let changed = false
  // A copy of a copy is written out on a later pass; the limit only stops a
  // reference loop.
  for (let pass = 0; pass < 8; pass++) {
    const copies: Element[] = []
    const walker = doc.createTreeWalker(doc, 1 /* NodeFilter.SHOW_ELEMENT */)
    while (walker.nextNode()) {
      const el = walker.currentNode as Element
      if (el.getAttribute('copyof') && !el.children.length) copies.push(el)
    }
    let written = false
    for (const copy of copies) {
      const target = byId.get(copy.getAttribute('copyof')!.replace(/^#/, ''))
      if (!target || target.contains(copy)) continue
      const clone = target.cloneNode(true) as Element
      // The copy is new content: its notes get ids of their own from Verovio.
      for (const el of [clone, ...Array.from(clone.getElementsByTagName('*'))]) el.removeAttribute('xml:id')
      for (const attr of Array.from(copy.attributes)) if (attr.name !== 'copyof') clone.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
      copy.replaceWith(clone)
      written = changed = true
    }
    if (!written) break
  }
  return changed
}

// A grace note or chord: marked itself, or inside a <graceGrp>.
function isGrace(el: Element): boolean {
  if (el.getAttribute('grace')) return true
  for (let p = el.parentElement; p && p.localName !== 'layer'; p = p.parentElement) {
    if (p.localName === 'graceGrp') return true
  }
  return false
}

function takeOutGraces(doc: Document, graces: Graces): boolean {
  let made = 0
  const idOf = (el: Element) => {
    if (!el.getAttribute('xml:id')) el.setAttributeNS(XML_NS, 'xml:id', `spool-grace-${++made}`)
    return el.getAttribute('xml:id')!
  }
  const grace = (holder: Element): Grace => {
    // A triplet (num 3, numbase 2) squeezes three notes into the time of two.
    let scale = 1
    for (let p = holder.parentElement; p && p.localName !== 'layer'; p = p.parentElement) {
      if (p.localName === 'tuplet') scale *= parseInt(p.getAttribute('numbase') || '2', 10) / parseInt(p.getAttribute('num') || '3', 10)
    }
    const source = holder.localName === 'chord' ? durSourceOf(holder) : holder
    return { holder, beats: source.getAttribute('dur') ? durToBeats(source, scale, new Warnings()) : null }
  }
  const out: Element[] = []
  // Only the music: an incipit quoted in the header is never played.
  for (const layer of allDeep(firstDeep(doc, 'music') ?? doc, 'layer')) {
    const items = Array.from(layer.getElementsByTagName('*'))
      .filter((el) => IN_TIME.has(el.localName) && !(el.localName === 'note' && el.parentElement?.localName === 'chord'))
    let run: Grace[] = []
    let prev: Element | null = null
    for (const el of items) {
      if (isGrace(el)) {
        run.push(grace(el))
        out.push(el)
        continue
      }
      if (run.length) graces.before.set(idOf(el), run)
      run = []
      prev = el
    }
    if (run.length && prev) graces.after.set(idOf(prev), run)
  }
  for (const el of out) (el.closest('graceGrp') ?? el).remove()
  return out.length > 0
}

// ── Entry point ──

/**
 * Reads an MEI file with Verovio, which is downloaded the first time. Rejects
 * if Verovio can't be loaded or can't read the file.
 */
export async function parseVerovio(text: string): Promise<MeiScore> {
  const tk = await loadToolkit()
  const prepared = prepareForVerovio(text)
  let loaded: boolean
  let timemap: TimemapEntry[] = []
  let exported = ''
  try {
    tk.resetOptions()
    // Every movement (<mdiv>), one after another, as the native reader reads
    // them; Verovio plays only the first by default.
    tk.setOptions({ mdivAll: true })
    loaded = tk.loadData(prepared.text)
    if (loaded) {
      timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: true })
      exported = tk.getMEI()
    }
  } catch (err) {
    // Verovio's engine stops on a few files (two of the samples); start a
    // fresh one for the next file.
    toolkit = null
    throw err
  }
  if (!loaded || !Array.isArray(timemap)) throw new Error("Verovio couldn't read this file.")
  const doc = new DOMParser().parseFromString(exported, 'application/xml')
  return readTimemap(doc, timemap, prepared.graces, (id) => tk.getNotatedIdForElement(id))
}

// What sounds at one moment in one layer: a note, a chord, or a rest.
interface Event {
  start: number
  end: number
  /** The note or chord as encoded; null for a rest. */
  holder: Element | null
  /** The note, chord or rest as encoded. */
  el: Element
  /** The notes Verovio played for it, as encoded. */
  played: Element[]
  place: Place
}

function readTimemap(doc: Document, timemap: TimemapEntry[], graces: Graces, notatedId: (id: string) => string): MeiScore {
  const warn = new Warnings()
  const music = firstDeep(doc, 'music') ?? doc.documentElement
  const byId = indexIds(doc)
  const places = placesOf(music)
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
        ev = { start: entry.qstamp, end: end.get(id) ?? entry.qstamp, holder, el: holder ?? el, played: [], place }
        events.set(holder ?? el, ev)
        const key = `${place.staff}/${place.layer}`
        const layer = layers.get(key)
        if (layer) layer.push(ev)
        else layers.set(key, [ev])
      }
      // A note written in two layers (the other points to it with sameas)
      // is listed twice; it sounds once.
      if (!rest && !ev.played.includes(el)) { ev.played.push(el); played.add(el) }
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

  const sound = (ev: Event, start: number, dur: number, tieStart = true): MeiNote[] => {
    const chord = ev.holder?.localName === 'chord' ? ev.holder : null
    return ev.played.map((n) => addNote(n, chord, start, dur, ev.place, tieStart)).filter((n): n is MeiNote => n !== null)
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
  // since that note.
  const placed = new Set<Grace[]>()
  const placeGraces = (run: Grace[], beat: number, last: MeiNote[], lastStart: number | null, place: Place) => {
    placed.add(run)
    const timed = run.filter((g) => g.beats !== null)
    if (timed.length < run.length) warn.add('grace-no-dur', 'Grace notes without a written length are left out.', run.length - timed.length)
    if (!timed.length) return
    const room = beat - (lastStart ?? 0)
    if (room <= 1e-9) {
      warn.add('grace-start', 'Grace notes with no time before them are left out.', timed.length)
      return
    }
    const total = timed.reduce((sum, g) => sum + g.beats!, 0)
    const fit = Math.min(1, room / 2 / total)
    let t = beat - total * fit
    for (const n of last) if (n.start + n.dur > t) n.dur = Math.max(0, t - n.start)
    for (const g of timed) {
      const chord = g.holder.localName === 'chord' ? g.holder : null
      for (const n of chord ? childrenNamed(chord, 'note') : [g.holder]) addNote(n, chord, t, g.beats! * fit, place, true)
      t += g.beats! * fit
    }
  }

  for (const events of layers.values()) {
    let last: MeiNote[] = []
    let lastStart: number | null = null
    for (const ev of events) {
      const id = ev.el.getAttribute('xml:id') ?? ''
      const lead = graces.before.get(id)
      if (lead) placeGraces(lead, ev.start, last, lastStart, ev.place)
      const trem = ev.holder?.parentElement
      if (!ev.holder) {
        last = []
        lastStart = ev.start
      } else if (trem && (trem.localName === 'bTrem' || trem.localName === 'fTrem')) {
        const stroke = soundTremolo(ev, trem)
        last = stroke.notes
        lastStart = stroke.start
      } else {
        last = sound(ev, ev.start, ev.end - ev.start)
        lastStart = ev.start
      }
      // Grace notes at the end of a layer lead into its end.
      const trail = graces.after.get(id)
      if (trail) placeGraces(trail, ev.end, last, lastStart, ev.place)
    }
  }
  const lost = [...graces.before.values(), ...graces.after.values()].filter((run) => !placed.has(run)).reduce((sum, run) => sum + run.length, 0)
  if (lost) warn.add('unplaced', "Some notes couldn't be placed in time and are left out.", lost)

  const notes = joinTies(read, ties, music, warn)

  // ── What the roll leaves out ──

  if (tempos.size > 1) warn.add('tempo-change', 'Only the opening tempo is used.')
  const octaves = allDeep(music, 'octave').length
  if (octaves) warn.add('octave', 'Octave lines play at written pitch.', octaves)
  const readings = allDeep(music, 'app').length + allDeep(music, 'choice').length
  if (readings) warn.add('reading', 'Where the file gives alternative readings, only the main or first one plays.', readings)
  // Notes Verovio never timed, apart from the readings it didn't choose and
  // notes written in two layers (sameas), which sound once.
  const alternatives = new Set(['app', 'choice', 'subst'])
  const silent = allDeep(music, 'note').filter((n) => !played.has(n) && !n.getAttribute('sameas') && !hasAncestor(n, alternatives))
  // A repeat Verovio doesn't play out is played once through, as the second
  // time: its first ending is skipped.
  const marked = allDeep(music, 'measure').some((m) => /rpt/.test((m.getAttribute('left') || '') + (m.getAttribute('right') || '')))
  const marks = marked || allDeep(music, 'expansion').length > 0
  const skipped = marks ? silent.filter((n) => hasAncestor(n, new Set(['ending']))).length : 0
  if (marks && (!repeated || skipped)) warn.add('repeat', skipped ? 'Repeats play once, without their first endings.' : 'Repeats play once.')
  if (silent.length > skipped) warn.add('unplaced', "Some notes couldn't be placed in time and are left out.", silent.length - skipped)

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
