import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { JSDOM } from 'jsdom'
import { parseNative } from '../src/mei/parseNative'

/* ===========================================================================
 * The stress test: every MEI sample file through the native reader.
 *
 * Its job is to show what breaks, not to pass. It writes a report to
 * fixtures/stress-report.md (git-ignored, like the samples) and prints the
 * totals. Run: npm run stress
 *
 * Most pieces exist in MEI 4.0, 5.0 and 5.1, so the report also lists pieces
 * whose note count or length differs between versions: the music is the same,
 * so a difference points at how the reader handles that MEI version.
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

interface Row {
  version: string
  piece: string
  notes: number
  bars: number
  parts: number
  ms: number
  warnings: string[]
  error: string
}

function readOne(version: string, file: string): Row {
  const piece = relative(join(SAMPLES, version), file)
  const xml = readFileSync(file, 'utf8')
  // A fresh simulated browser per file, closed afterwards: jsdom keeps every
  // document a shared window has parsed, and one shared window ran out of
  // memory (8 GB) partway through the samples.
  const { window } = new JSDOM('')
  globalThis.DOMParser = window.DOMParser
  const t0 = performance.now()
  try {
    const s = parseNative(xml)
    return {
      version, piece,
      notes: s.notes.length,
      bars: s.bars.length,
      parts: s.parts.length,
      ms: Math.round(performance.now() - t0),
      warnings: s.warnings.map((w) => w.code),
      error: '',
    }
  } catch (e) {
    return { version, piece, notes: 0, bars: 0, parts: 0, ms: Math.round(performance.now() - t0), warnings: [], error: e instanceof Error ? e.message.split('\n')[0] : String(e) }
  } finally {
    window.close()
  }
}

// ── Report ──

function report(rows: Row[], excluded: string[]): string {
  const failed = rows.filter((r) => r.error)
  const empty = rows.filter((r) => !r.error && r.notes === 0)
  const clean = rows.filter((r) => !r.error && r.notes > 0 && r.warnings.length === 0)
  const warnCount = new Map<string, number>()
  for (const r of rows) for (const w of r.warnings) warnCount.set(w, (warnCount.get(w) || 0) + 1)

  // Same piece, different MEI version, different result.
  const byPiece = new Map<string, Row[]>()
  for (const r of rows) byPiece.set(r.piece, [...(byPiece.get(r.piece) || []), r])
  const drift = [...byPiece.entries()].filter(([, rs]) => rs.length > 1 && new Set(rs.map((r) => `${r.notes}/${r.bars}`)).size > 1)

  const lines: string[] = []
  lines.push('# Stress test report', '', `Run ${new Date().toISOString()}. Native reader only.`, '')
  lines.push('| | Files |', '|---|---|')
  lines.push(`| Read | ${rows.length} |`)
  lines.push(`| Read with no warnings | ${clean.length} |`)
  lines.push(`| Read, but no notes found | ${empty.length} |`)
  lines.push(`| Read, with more than one part | ${rows.filter((r) => r.parts > 1).length} |`)
  lines.push(`| Failed (error) | ${failed.length} |`)
  lines.push(`| Left out (copyright notice in header) | ${excluded.length} |`, '')
  lines.push('## Warnings, by number of files', '', '| Warning | Files |', '|---|---|')
  for (const [w, n] of [...warnCount.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${w} | ${n} |`)
  lines.push('', '## Same piece, different result by MEI version', '')
  if (!drift.length) lines.push('None.')
  for (const [piece, rs] of drift) lines.push(`- ${piece}: ${rs.map((r) => `${r.version.slice(4)} → ${r.notes} notes, ${r.bars} bars`).join('; ')}`)
  lines.push('', '## Failures', '')
  if (!failed.length) lines.push('None.')
  for (const r of failed) lines.push(`- ${r.version}/${r.piece}: ${r.error}`)
  lines.push('', '## Every file', '', '| Version | File | Notes | Bars | Parts | ms | Warnings |', '|---|---|---|---|---|---|---|')
  for (const r of rows) lines.push(`| ${r.version.slice(4)} | ${r.piece} | ${r.error ? 'ERROR' : r.notes} | ${r.bars} | ${r.parts} | ${r.ms} | ${r.warnings.join(', ')} |`)
  return lines.join('\n') + '\n'
}

// ── Run ──

describe('stress test', () => {
  it('reads every sample file and writes the report', () => {
    if (!existsSync(SAMPLES)) {
      console.log('No samples: run `npm run samples` first (npm run stress does this for you).')
      return
    }
    const rows: Row[] = []
    const excluded: string[] = []
    for (const version of VERSIONS) {
      for (const file of meiFiles(join(SAMPLES, version))) {
        if (hasCopyrightNotice(readFileSync(file, 'utf8'))) { excluded.push(relative(SAMPLES, file)); continue }
        rows.push(readOne(version, file))
      }
    }
    const md = report(rows, excluded)
    writeFileSync(join(ROOT, 'stress-report.md'), md)
    console.log(md.split('\n## Every file')[0])
    console.log(`Full table: ${join(ROOT, 'stress-report.md')}`)
    expect(rows.length).toBeGreaterThan(0)
  })
})
