import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { JSDOM } from 'jsdom'
import { parseNative } from '../src/mei/parseNative'
import { parseVerovio } from '../src/mei/parseVerovio'
import type { MeiScore } from '../src/mei/types'

/* ===========================================================================
 * The stress test: every MEI sample file through both readers.
 *
 * Its job is to show what breaks, not to pass. It writes a report to
 * fixtures/stress-report.md (git-ignored, like the samples) and prints the
 * totals. Run: npm run stress
 *
 * Most pieces exist in MEI 4.0, 5.0 and 5.1, so the report also lists pieces
 * whose note count or length differs between versions: the music is the same,
 * so a difference points at how the reader handles that MEI version.
 *
 * Each file is read by the native reader and by Verovio, and the two are
 * compared note by note. A file the native reader reads with no warnings
 * should give the same notes from both; when it doesn't, one of them is wrong.
 * ======================================================================== */

const ROOT = join(import.meta.dirname, '..', 'fixtures')
const SAMPLES = join(ROOT, 'sample-encodings')
const VERSIONS = ['MEI_3.0', 'MEI_4.0', 'MEI_5.0', 'MEI_5.1']

// ── Which files ──

function meiFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...meiFiles(p))
    else if (name.endsWith('.mei')) out.push(p)
  }
  return out
}

// Files whose header carries a modern publisher's copyright are left out
// (docs/decisions.md): read the usage statement, not the music.
function hasCopyrightNotice(xml: string): boolean {
  const head = xml.slice(0, 60_000)
  const stmt = head.match(/<(useRestrict|availability)[\s\S]*?<\/\1>/)
  return !!stmt && /©|&#169;|&copy;/.test(stmt[0])
}

// ── One row per file ──

interface Result {
  notes: number
  bars: number
  parts: number
  ms: number
  warnings: string[]
  error: string
  /** Every note as "part:midi@start+dur", sorted, for comparing the readers. */
  sounds: string[]
}

interface Row extends Result {
  version: string
  piece: string
  verovio: Result
}

const round = (x: number) => Math.round(x * 1000) / 1000

async function readWith(read: () => MeiScore | Promise<MeiScore>): Promise<Result> {
  const t0 = performance.now()
  try {
    const s = await read()
    return {
      notes: s.notes.length,
      bars: s.bars.length,
      parts: s.parts.length,
      ms: Math.round(performance.now() - t0),
      warnings: s.warnings.map((w) => w.code),
      error: '',
      sounds: s.notes.map((n) => `${n.part}:${n.midi}@${round(n.start)}+${round(n.dur)}`).sort(),
    }
  } catch (e) {
    return { notes: 0, bars: 0, parts: 0, ms: Math.round(performance.now() - t0), warnings: [], error: e instanceof Error ? e.message.split('\n')[0] : String(e), sounds: [] }
  }
}

async function readOne(version: string, file: string): Promise<Row> {
  const piece = relative(join(SAMPLES, version), file)
  const xml = readFileSync(file, 'utf8')
  // A fresh simulated browser per file, closed afterwards: jsdom keeps every
  // document a shared window has parsed, and one shared window ran out of
  // memory (8 GB) partway through the samples.
  const { window } = new JSDOM('')
  globalThis.DOMParser = window.DOMParser
  try {
    const native = await readWith(() => parseNative(xml))
    const verovio = await readWith(() => parseVerovio(xml))
    return { version, piece, ...native, verovio }
  } finally {
    window.close()
  }
}

// How far the readers' notes differ: notes only one of them has, as a count.
function difference(a: string[], b: string[]): number {
  const left = new Map<string, number>()
  for (const s of a) left.set(s, (left.get(s) ?? 0) + 1)
  let only = 0
  for (const s of b) {
    const n = left.get(s) ?? 0
    if (n) left.set(s, n - 1)
    else only++
  }
  return only + [...left.values()].reduce((sum, n) => sum + n, 0)
}

// The files "auto" sends to Verovio (src/mei/read.ts).
const VEROVIO_FILLS = ['repeat', 'short-bar', 'mid-change', 'transposing']
const goesToVerovio = (r: Row) => r.warnings.some((w) => VEROVIO_FILLS.includes(w) || w.startsWith('skipped:'))

// ── Report ──

function totals(lines: string[], rows: Result[]): void {
  const warnCount = new Map<string, number>()
  for (const r of rows) for (const w of r.warnings) warnCount.set(w, (warnCount.get(w) || 0) + 1)
  lines.push('| | Files |', '|---|---|')
  lines.push(`| Read | ${rows.length} |`)
  lines.push(`| Read with no warnings | ${rows.filter((r) => !r.error && r.notes > 0 && r.warnings.length === 0).length} |`)
  lines.push(`| Read, but no notes found | ${rows.filter((r) => !r.error && r.notes === 0).length} |`)
  lines.push(`| Read, with more than one part | ${rows.filter((r) => r.parts > 1).length} |`)
  lines.push(`| Failed (error) | ${rows.filter((r) => r.error).length} |`)
  lines.push(`| Time, all files | ${(rows.reduce((t, r) => t + r.ms, 0) / 1000).toFixed(1)} s |`, '')
  lines.push('| Warning | Files |', '|---|---|')
  for (const [w, n] of [...warnCount.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${w} | ${n} |`)
  lines.push('')
}

function report(rows: Row[], excluded: string[]): string {
  const failed = rows.flatMap((r) => [
    ...(r.error ? [`- native, ${r.version}/${r.piece}: ${r.error}`] : []),
    ...(r.verovio.error ? [`- Verovio, ${r.version}/${r.piece}: ${r.verovio.error}`] : []),
  ])

  // Same piece, different MEI version, different result.
  const byPiece = new Map<string, Row[]>()
  for (const r of rows) byPiece.set(r.piece, [...(byPiece.get(r.piece) || []), r])
  const drift = [...byPiece.entries()].filter(([, rs]) => rs.length > 1 && new Set(rs.map((r) => `${r.notes}/${r.bars}`)).size > 1)

  // The readers compared, on files both read.
  const both = rows.filter((r) => !r.error && !r.verovio.error && (r.notes || r.verovio.notes))
  const diff = (r: Row) => difference(r.sounds, r.verovio.sounds)
  const same = both.filter((r) => diff(r) === 0)
  const cleanButDifferent = both.filter((r) => r.warnings.length === 0 && diff(r) > 0)

  const lines: string[] = []
  lines.push('# Stress test report', '', `Run ${new Date().toISOString()}. Both readers.`, '')
  lines.push(`Left out (copyright notice in header): ${excluded.length} files.`, '')
  lines.push('## Native reader', '')
  totals(lines, rows)
  lines.push('## Verovio reader', '')
  totals(lines, rows.map((r) => r.verovio))
  lines.push('## The readers compared', '')
  lines.push('| | Files |', '|---|---|')
  lines.push(`| Read by both, with notes | ${both.length} |`)
  lines.push(`| Same notes from both | ${same.length} |`)
  lines.push(`| No native warnings, but different notes | ${cleanButDifferent.length} |`)
  lines.push(`| Sent to Verovio by "auto" | ${rows.filter(goesToVerovio).length} |`, '')
  lines.push('### No native warnings, but different notes', '')
  if (!cleanButDifferent.length) lines.push('None.')
  for (const r of cleanButDifferent) lines.push(`- ${r.version}/${r.piece}: ${diff(r)} notes differ (native ${r.notes}, Verovio ${r.verovio.notes})`)
  lines.push('', '## Same piece, different result by MEI version (native)', '')
  if (!drift.length) lines.push('None.')
  for (const [piece, rs] of drift) lines.push(`- ${piece}: ${rs.map((r) => `${r.version.slice(4)} → ${r.notes} notes, ${r.bars} bars`).join('; ')}`)
  lines.push('', '## Failures', '')
  if (!failed.length) lines.push('None.')
  lines.push(...failed)
  lines.push('', '## Every file', '', '| Version | File | Notes | Bars | Warnings | Verovio notes | Verovio bars | Verovio warnings | Notes that differ |', '|---|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    lines.push(`| ${r.version.slice(4)} | ${r.piece} | ${r.error ? 'ERROR' : r.notes} | ${r.bars} | ${r.warnings.join(', ')} | ${r.verovio.error ? 'ERROR' : r.verovio.notes} | ${r.verovio.bars} | ${r.verovio.warnings.join(', ')} | ${r.error || r.verovio.error ? '' : diff(r)} |`)
  }
  return lines.join('\n') + '\n'
}

// ── Run ──

describe('stress test', () => {
  it('reads every sample file and writes the report', async () => {
    if (!existsSync(SAMPLES)) {
      console.log('No samples: run `npm run samples` first (npm run stress does this for you).')
      return
    }
    const rows: Row[] = []
    const excluded: string[] = []
    for (const version of VERSIONS) {
      for (const file of meiFiles(join(SAMPLES, version))) {
        if (hasCopyrightNotice(readFileSync(file, 'utf8'))) { excluded.push(relative(SAMPLES, file)); continue }
        rows.push(await readOne(version, file))
      }
    }
    const md = report(rows, excluded)
    writeFileSync(join(ROOT, 'stress-report.md'), md)
    console.log(md.split('\n## Every file')[0])
    console.log(`Full table: ${join(ROOT, 'stress-report.md')}`)
    expect(rows.length).toBeGreaterThan(0)
  })
})
