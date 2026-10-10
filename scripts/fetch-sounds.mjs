// ── Fetch the sampled instruments for the hosted demo ──
//
// Copies the FluidR3 General MIDI recordings (Frank Wen, CC BY 3.0), as
// rendered by github.com/gleitz/midi-js-soundfonts, into the demo's public
// folder, so the hosted tool plays them from its own address instead of a
// volunteer-run site (docs/decisions.md, 2026-10-10). Git ignores the folder:
// about 45 MB of audio would otherwise stay in the history for good.
//
// Pinned to one commit, set in demo/sounds.json, which the demo reads too. The
// folder is named after the commit, so a file at a given address never changes
// and browsers may cache it for good (vercel.json). Bump the commit
// deliberately: it changes what every listener hears.
// Only the instruments the player offers are copied, read from
// src/audio/sounds.ts so the two lists can't drift.
//
// Run: npm run sounds   (npm run build:demo runs it first)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const { repo: REPO, commit: COMMIT } = JSON.parse(readFileSync(join(ROOT, 'demo', 'sounds.json'), 'utf8'))
const DEST = join(ROOT, 'demo', 'public', 'sounds', `fluidr3-${COMMIT.slice(0, 7)}`)

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

// CC BY asks for credit and the license wherever the recordings are shared.
writeFileSync(join(DEST, 'CREDITS.txt'), `FluidR3 GM, by Frank Wen.
License: Creative Commons Attribution 3.0, https://creativecommons.org/licenses/by/3.0/
Rendered as JavaScript by https://github.com/${REPO} (commit ${COMMIT}).
`)

console.log(`Sounds: ${fetched} fetched, ${names.length - fetched} already present, in ${DEST}`)
