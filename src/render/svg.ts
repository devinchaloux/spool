import type { MeiScore } from '../mei/types'
import { midiName, isBlackKey } from '../mei/parseNative'
import { resolveTheme, shade, inkOn, type RollTheme, type ThemeName } from '../roll/themes'
import { partColors } from '../roll/noteColors'
import { layoutLanes } from '../roll/lanes'

/* ===========================================================================
 * Still images of the roll, as SVG.
 *
 * A pure function: score in, SVG text out, no browser needed. So the same call
 * works on a page ("save image") and in a site's build step (draw every
 * excerpt's picture when the site builds, so pictures can't drift from the
 * files they come from). Reading the file first does need a DOMParser, which
 * a Node build supplies itself (jsdom's, as the stress test does). For PNG,
 * see toPng.ts.
 * ======================================================================== */

export interface RollImageOptions {
  /** First bar to draw, counted from 1 in order (a pickup counts as bar 1). Default: the first. */
  fromBar?: number
  /** Last bar to draw, inclusive. Default: the last. */
  toBar?: number
  /** Size in pixels. Defaults: 1200 × 400. */
  width?: number
  height?: number
  /** The keyboard down the left side. Default true. */
  keyboard?: boolean
  /** Bar numbers along the top. Default false. */
  barNumbers?: boolean
  /** The chord symbols in a row along the top, under any bar numbers, when the file has some. Default true. */
  chordSymbols?: boolean
  /** Beat and bar lines. Default true. */
  grid?: boolean
  /** Pitch names on notes wide enough to hold them. Default false. */
  noteLabels?: boolean
  theme?: ThemeName | RollTheme
  /** Note color; overrides the theme's. With several parts, the first part's. */
  noteColor?: string
  /** One color per part, in the order of `score.parts`; overrides `noteColor`. */
  partColors?: string[]
  /** Each part on its own roll, labeled, instead of all on one. Default false. */
  separateParts?: boolean
  /** Parts drawn faint, as the player draws muted parts. */
  fadedParts?: number[]
  /** False leaves the background transparent. Default true. */
  background?: boolean
  /** Empty pitch rows above and below the notes. Default 1. */
  pitchPadding?: number
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const r2 = (n: number) => Math.round(n * 100) / 100

export function rollToSvg(score: MeiScore, options: RollImageOptions = {}): string {
  const o = {
    width: 1200, height: 400, keyboard: true, barNumbers: false, chordSymbols: true, grid: true, noteLabels: false,
    background: true, pitchPadding: 1, separateParts: false, ...options,
  }
  const theme = resolveTheme(o.theme)
  const colors = o.partColors ?? partColors(score.parts.length, theme, o.noteColor ?? theme.note)
  const faded = new Set(o.fadedParts ?? [])

  // ── Which stretch of music ──
  const bars = score.bars.length ? score.bars : [{ start: 0, label: '1' }]
  const first = Math.min(Math.max(1, o.fromBar ?? 1), bars.length)
  const last = Math.max(first, Math.min(o.toBar ?? bars.length, bars.length))
  const startBeat = bars[first - 1].start
  const endBeat = last < bars.length ? bars[last].start : score.totalBeats
  const span = Math.max(endBeat - startBeat, 1e-6)
  const notes = score.notes.filter((n) => n.start < endBeat - 1e-6 && n.start + n.dur > startBeat + 1e-6)

  // ── Geometry ──
  const keyW = o.keyboard ? Math.max(24, Math.min(60, Math.round(o.width * 0.04))) : 0
  const rulerH = o.barNumbers ? 22 : 0
  // One symbol per moment (a file can write it on several staves), the one
  // sounding when the stretch begins included.
  const allChords = (o.chordSymbols ? score.chords : []).filter((c, i, all) => i === 0 || c.start > all[i - 1].start + 1e-6)
  const chords = allChords.filter((c, i) => c.start < endBeat - 1e-6 && (allChords[i + 1]?.start ?? Infinity) > startBeat + 1e-6)
  const chordH = chords.length ? 24 : 0
  const top = rulerH + chordH
  const lanes = layoutLanes(notes, { separate: o.separateParts, top, height: o.height - top, pitchPadding: o.pitchPadding })
  const labelLanes = lanes.length > 1
  const px = (o.width - keyW) / span
  const x = (beat: number) => keyW + (beat - startBeat) * px
  const font = 'font-family="ui-monospace, Menlo, Consolas, monospace"'

  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" role="img">`)
  out.push(`<title>${esc(score.title || 'Piano roll')}</title>`)
  if (o.background) out.push(`<rect width="${o.width}" height="${o.height}" fill="${theme.background}"/>`)

  for (const lane of lanes) {
    const rowH = lane.height / (lane.hi - lane.lo + 1)
    const y = (midi: number) => lane.top + (lane.hi - midi) * rowH
    const bottom = lane.top + lane.height

    // Pitch rows: black-key rows a shade darker, as in a DAW.
    for (let m = lane.lo; m <= lane.hi; m++) {
      const fill = isBlackKey(m) ? theme.rowBlack : theme.rowWhite
      if (!o.background && fill === theme.background) continue
      out.push(`<rect x="${keyW}" y="${r2(y(m))}" width="${o.width - keyW}" height="${r2(rowH)}" fill="${fill}"/>`)
    }

    // ── Grid: a line per beat, counted from each bar's start; stronger at bar lines ──
    if (o.grid) {
      for (let i = first - 1; i < last; i++) {
        const barEnd = i + 1 < bars.length ? bars[i + 1].start : score.totalBeats
        for (let b = bars[i].start; b < barEnd - 1e-6; b += 1) {
          const isBar = b === bars[i].start
          const xx = Math.round(x(b)) + 0.5
          out.push(`<line x1="${xx}" y1="${r2(lane.top)}" x2="${xx}" y2="${r2(bottom)}" stroke="${isBar ? theme.gridBar : theme.gridBeat}" stroke-width="${isBar ? 1.5 : 1}"/>`)
        }
      }
    }

    // ── Notes, clipped to the chosen bars ──
    const fontSize = Math.max(8, Math.min(12, rowH * 0.6))
    for (const n of notes) {
      if (!lane.parts.includes(n.part)) continue
      const color = colors[n.part] ?? colors[0] ?? theme.note
      const s = Math.max(n.start, startBeat)
      const e = Math.min(n.start + n.dur, endBeat)
      const nx = x(s) + 1
      const nw = Math.max(2, (e - s) * px - 2)
      const ny = y(n.midi) + 1
      const nh = Math.max(1, rowH - 2)
      const opacity = faded.has(n.part) ? ' opacity="0.3"' : ''
      out.push(`<rect x="${r2(nx)}" y="${r2(ny)}" width="${r2(nw)}" height="${r2(nh)}" rx="${r2(Math.min(3, nh / 2))}" fill="${color}" stroke="${shade(color, -0.35)}" stroke-width="1"${opacity}/>`)
      if (o.noteLabels && nw > 24 && rowH > 12) {
        out.push(`<text x="${r2(nx + 4)}" y="${r2(ny + nh / 2)}" dominant-baseline="central" ${font} font-size="${r2(fontSize)}" fill="${inkOn(color, theme.noteText)}"${opacity}>${n.name}</text>`)
      }
    }

    // ── Part name, top left of its lane ──
    if (labelLanes) {
      const part = score.parts[lane.parts[0]]
      if (part) out.push(`<text x="${keyW + 6}" y="${r2(lane.top + 11)}" dominant-baseline="central" ${font} font-size="11" fill="${theme.text}">${esc(part.label)}</text>`)
    }

    // ── Keyboard ──
    if (o.keyboard) {
      out.push(`<rect x="0" y="${r2(lane.top)}" width="${keyW}" height="${r2(lane.height)}" fill="${theme.keyWhite}"/>`)
      for (let m = lane.lo; m <= lane.hi; m++) {
        if (isBlackKey(m)) out.push(`<rect x="0" y="${r2(y(m))}" width="${r2(keyW * 0.68)}" height="${r2(rowH - 1)}" fill="${theme.keyBlack}"/>`)
        if (m % 12 === 0 && rowH > 9) {
          out.push(`<text x="4" y="${r2(y(m) + rowH / 2)}" dominant-baseline="central" ${font} font-size="${r2(Math.min(10, rowH * 0.8))}" fill="${theme.text}">${midiName(m)}</text>`)
        }
      }
    }
  }

  // ── Bar numbers ──
  if (o.barNumbers) {
    out.push(`<rect width="${o.width}" height="${rulerH}" fill="${o.background ? theme.background : 'none'}"/>`)
    for (let i = first - 1; i < last; i++) {
      out.push(`<text x="${r2(x(bars[i].start) + 4)}" y="${rulerH / 2}" dominant-baseline="central" ${font} font-size="11" fill="${theme.text}">${esc(bars[i].label)}</text>`)
    }
  }

  // ── Chord symbols, each clipped to the room before the next ──
  if (chordH) {
    out.push(`<rect y="${rulerH}" width="${o.width}" height="${chordH}" fill="${o.background ? theme.background : 'none'}"/>`)
    out.push(`<line x1="${keyW}" y1="${top - 0.5}" x2="${o.width}" y2="${top - 0.5}" stroke="${theme.gridBeat}"/>`)
    chords.forEach((c, i) => {
      const left = Math.max(x(c.start), keyW)
      const right = Math.min(x(chords[i + 1]?.start ?? endBeat), o.width)
      out.push(`<clipPath id="chord-${i}"><rect x="${r2(left)}" y="${rulerH}" width="${r2(Math.max(0, right - left - 2))}" height="${chordH}"/></clipPath>`)
      out.push(`<text x="${r2(left + 4)}" y="${rulerH + chordH / 2}" dominant-baseline="central" clip-path="url(#chord-${i})" ${font} font-size="13" font-weight="700" fill="${theme.textStrong ?? theme.text}">${esc(c.label)}</text>`)
    })
  }

  if (o.keyboard) out.push(`<line x1="${keyW + 0.5}" y1="0" x2="${keyW + 0.5}" y2="${o.height}" stroke="${theme.gridBar}"/>`)
  out.push('</svg>')
  return out.join('\n')
}
