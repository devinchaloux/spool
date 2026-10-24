// ── Fetch the sampled instruments for the hosted demo ──
//
// Copies the FluidR3 General MIDI recordings (Frank Wen, CC BY 3.0), as
// rendered by github.com/gleitz/midi-js-soundfonts, into the demo's public
// folder, so the hosted tool plays them from its own address instead of a
// volunteer-run site (docs/decisions.md, 2026-10-10). Git ignores the folder:
// about 45 MB of audio would otherwise stay in the history for good.
//
// Pinned to one commit, set in demo/sounds.json, which the demo reads too. The
// folder is named after the commit (and the loop points' commit), so a file at
// a given address never changes and browsers may cache it for good
// (vercel.json). Bump a commit deliberately: it changes what every listener
// hears.
//
// Each recording lasts about three seconds, so a note held longer would go
// silent before it ends. Loop points (where in a recording to repeat while a
// note is held), worked out from the same soundfont by
// github.com/goldst/midi-js-soundfonts, are copied beside the recordings as
// <instrument>-loop.json. That repository names them after the soundfont's own
// presets, so demo/sounds.json maps the few names that differ. An instrument
// with none (the piano, guitar and pizzicato, which die away anyway) plays its
// recording once.
//
// Some of those loops are the soundfont's own single-cycle loops, a few
// milliseconds long (the synth bass loops samples 8 to 408). They fit the
// soundfont's raw sample, not these recordings, which are rendered note by
// note: repeating 9 ms of a 44 Hz note turns every note into the same 110 Hz
// buzz. A loop shorter than `loops.shortest` samples (at 44.1 kHz, as smplr
// reads them) is dropped, so that note plays its recording once. The folder
// is named after that limit too, so a browser that cached the old loops
// fetches the new ones.
// Only the instruments the player offers are copied, read from
// src/audio/sounds.ts so the two lists can't drift.
//
// Run: npm run sounds   (npm run build:demo runs it first)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const { repo: REPO, commit: COMMIT, loops: LOOPS } = JSON.parse(readFileSync(join(ROOT, 'demo', 'sounds.json'), 'utf8'))
const DEST = join(ROOT, 'demo', 'public', 'sounds', `fluidr3-${COMMIT.slice(0, 7)}-${LOOPS.commit.slice(0, 7)}-${LOOPS.shortest}`)

// The third argument of each sampled('id', 'Label', 'instrument') line.
const soundsTs = readFileSync(join(ROOT, 'src', 'audio', 'sounds.ts'), 'utf8')
const calls = soundsTs.match(/^\s*sampled\(/gm) ?? []
const names = [...soundsTs.matchAll(/^\s*sampled\('[^']*',\s*'[^']*',\s*'([a-z0-9_]+)'\)/gm)].map((m) => m[1])
if (!names.length || names.length !== calls.length) {
  console.error(`Read ${names.length} instrument names from ${calls.length} sampled() lines in src/audio/sounds.ts; update the pattern in this script.`)
  process.exit(1)
}

mkdirSync(DEST, { recursive: true })
let fetched = 0
for (const name of names) {
  const file = join(DEST, `${name}-mp3.js`)
  if (existsSync(file)) continue
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/FluidR3_GM/${name}-mp3.js`
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`${res.status} for ${url}`)
    process.exit(1)
  }
  const text = await res.text()
  // An error page saved under the instrument's name would only fail later, in
  // a listener's browser.
  if (!text.includes('MIDI.Soundfont')) {
    console.error(`Not a soundfont file: ${url}`)
    process.exit(1)
  }
  writeFileSync(file, text)
  fetched++
}

// ── Loop points ──
let looped = 0
const unlooped = []
const shortened = []
for (const name of names) {
  const file = join(DEST, `${name}-loop.json`)
  if (existsSync(file)) { looped++; continue }
  const preset = LOOPS.names[name] ?? name
  const url = `https://raw.githubusercontent.com/${LOOPS.repo}/${LOOPS.commit}/FluidR3_GM/${preset}-loop.json`
  const res = await fetch(url)
  if (res.status === 404) { unlooped.push(name); continue }
  if (!res.ok) {
    console.error(`${res.status} for ${url}`)
    process.exit(1)
  }
  const data = await res.json()
  if (!data || typeof data !== 'object' || !Object.keys(data).length) {
    console.error(`Not loop data: ${url}`)
    process.exit(1)
  }
  const kept = Object.fromEntries(Object.entries(data).filter(([, [start, end]]) => end - start >= LOOPS.shortest))
  const dropped = Object.keys(data).length - Object.keys(kept).length
  if (dropped) shortened.push(`${name} (${dropped} of ${Object.keys(data).length} notes)`)
  if (!Object.keys(kept).length) { unlooped.push(name); continue }
  writeFileSync(file, JSON.stringify(kept))
  looped++
}

// CC BY asks for credit and the license wherever the recordings are shared.
writeFileSync(join(DEST, 'CREDITS.txt'), `FluidR3 GM, by Frank Wen.
License: Creative Commons Attribution 3.0, https://creativecommons.org/licenses/by/3.0/
Rendered as JavaScript by https://github.com/${REPO} (commit ${COMMIT}).
Loop points from https://github.com/${LOOPS.repo} (commit ${LOOPS.commit}).
`)

console.log(`Sounds: ${fetched} fetched, ${names.length - fetched} already present, in ${DEST}`)
console.log(`Loop points: ${looped} instruments${unlooped.length ? `; none for ${unlooped.join(', ')}` : ''}`)
if (shortened.length) console.log(`Loops too short to use, dropped: ${shortened.join(', ')}`)
