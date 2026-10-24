// ── Loop points, measured from the recordings themselves ──
//
// Each sampled note is a recording about three seconds long; a note held
// longer repeats a stretch of it (its loop) until it ends. The loop points
// once copied from github.com/goldst/midi-js-soundfonts were measured on the
// soundfont's raw samples, not on these recordings, which are rendered note by
// note at each pitch: at the seam the waveform jumped, a click on every repeat,
// and some loops ran past the recording's end (docs/decisions.md, "loop points
// measured from the recordings").
//
// This finds, for every note of every sampled instrument, a stretch near the
// end of its recording whose two ends match: both on a rising zero crossing,
// a whole number of the note's cycles apart, and alike for a few cycles either
// side, so the waveform carries on across the seam. It writes them to
// demo/loops/<instrument>.json (sample offsets at 44.1 kHz, as smplr reads
// them), which the sounds build copies beside the recordings.
//
// Needs ffmpeg, to decode the MP3s, and the recordings, fetched first with
// `npm run sounds`. Run it again only when the recordings' commit changes
// (demo/sounds.json); when a file's loops change, it bumps the loops' version
// there, so the hosted folder is renamed and browsers fetch the new ones.
//
// Run: npm run loops

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SOUNDS_JSON = join(ROOT, 'demo', 'sounds.json')
const config = JSON.parse(readFileSync(SOUNDS_JSON, 'utf8'))
const OUT = join(ROOT, 'demo', 'loops')
const RATE = 44100

// The recordings, wherever the last `npm run sounds` put them.
const soundsDir = join(ROOT, 'demo', 'public', 'sounds')
const folder = existsSync(soundsDir) && readdirSync(soundsDir).find((d) => d.startsWith(`fluidr3-${config.commit.slice(0, 7)}`))
if (!folder) {
  console.error('No recordings found: run `npm run sounds` first.')
  process.exit(1)
}
const SRC = join(soundsDir, folder)

// ── Decoding ──

function decode(mp3) {
  const pcm = execFileSync('ffmpeg', ['-v', 'quiet', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-'], {
    input: mp3,
    maxBuffer: 64 * 1024 * 1024,
  })
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
}

// ── Finding a loop ──

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function midiOf(name) {
  const m = /^([A-G])(b?)(-?\d)$/.exec(name)
  return m ? (parseInt(m[3], 10) + 1) * 12 + STEP[m[1]] - (m[2] ? 1 : 0) : null
}

// Where the loop may sit: it ends between 0.34 and 0.19 s before the
// recording does, leaving room for decoders that trim the start differently,
// and lasts 0.3 to 1.2 s: long enough that a chorus or vibrato doesn't
// stutter, and starting after the attack.
const END_FROM = 0.34, END_TO = 0.19, MIN_LEN = 0.3, MAX_LEN = 1.2
// Candidate ends tried per note; each is scored against every rising zero
// crossing the loop could start from.
const ENDS = 24

const risingAt = (a, i) => a[i - 1] < 0 && a[i] >= 0

// The level of a stretch, from running sums of squares made once per note.
function levels(a) {
  const sums = new Float64Array(a.length + 1)
  for (let i = 0; i < a.length; i++) sums[i + 1] = sums[i] + a[i] * a[i]
  return (from, to) => Math.sqrt((sums[to] - sums[from]) / Math.max(1, to - from))
}

// How unlike the audio around two points is, relative to its level: 0 when
// the waveform carries on unchanged across a seam from one to the other.
function mismatch(a, x, y, half) {
  let d = 0, e = 0
  for (let k = -half; k < half; k++) {
    const u = a[x + k], v = a[y + k]
    d += (u - v) * (u - v)
    e += v * v
  }
  return Math.sqrt(d / Math.max(e, 1e-12))
}

function findLoop(a, midi) {
  const rms = levels(a)
  const period = RATE / (440 * 2 ** ((midi - 69) / 12))
  // Compare a few cycles around each end, but at least 5 ms and at most 25 ms.
  const half = Math.round(Math.min(1100, Math.max(220, period * 2)) / 2)
  const ends = []
  for (let i = Math.round(a.length - END_FROM * RATE); i < a.length - END_TO * RATE; i++) if (risingAt(a, i)) ends.push(i)
  // Silence (a plucked note long gone): any loop will do.
  if (!ends.length || rms(ends[0] - RATE / 2, ends[0]) < 1e-5) {
    const end = Math.round(a.length - END_TO * RATE)
    return [end - Math.round(MIN_LEN * RATE), end]
  }
  let best = null
  for (let n = 0; n < ENDS; n++) {
    const end = ends[Math.floor((n * ends.length) / ENDS)]
    const cycles = { from: Math.ceil((MIN_LEN * RATE) / period), to: Math.floor((MAX_LEN * RATE) / period) }
    for (let c = cycles.from; c <= cycles.to; c++) {
      // A whole number of cycles back, then any rising zero crossing within
      // half a cycle of it: a rendered note can sit a little off its pitch,
      // and an ensemble's voices are detuned from each other.
      const guess = Math.round(end - c * period)
      const reach = Math.max(3, Math.round(period / 2))
      for (let start = guess - reach; start < guess + reach; start++) {
        if (!risingAt(a, start)) continue
        // A decaying note is quieter at the loop's end than its start; penalize
        // the step in level as well as the change in shape.
        const level = Math.abs(Math.log((rms(start, start + 2 * half) + 1e-9) / (rms(end - 2 * half, end) + 1e-9)))
        const score = mismatch(a, start, end, half) + level
        if (!best || score < best.score) best = { score, start, end }
      }
    }
  }
  return best ? [best.start, best.end] : null
}

// ── Every instrument ──

mkdirSync(OUT, { recursive: true })
let changed = 0
const report = []
for (const file of readdirSync(SRC).filter((f) => f.endsWith('-mp3.js')).sort()) {
  const name = file.replace(/-mp3\.js$/, '')
  const text = readFileSync(join(SRC, file), 'utf8')
  const loops = {}
  for (const [, note, data] of text.matchAll(/"([A-G]b?-?\d)": "data:audio\/mp3;base64,([^"]+)"/g)) {
    const midi = midiOf(note)
    if (midi === null) continue
    const loop = findLoop(decode(Buffer.from(data, 'base64')), midi)
    if (loop) loops[note] = loop
  }
  const json = JSON.stringify(loops)
  const path = join(OUT, `${name}.json`)
  if (!existsSync(path) || readFileSync(path, 'utf8') !== json) {
    writeFileSync(path, json)
    changed++
  }
  report.push(`${name} (${Object.keys(loops).length})`)
}

if (changed) {
  config.loops.version = (config.loops.version ?? 0) + 1
  writeFileSync(SOUNDS_JSON, JSON.stringify(config, null, 2) + '\n')
}
console.log(`Loops for ${report.join(', ')}`)
console.log(changed ? `${changed} changed; loops version now ${config.loops.version}.` : 'No changes.')
