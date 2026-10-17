import type { VerovioToolkit } from 'verovio/esm'

/* ===========================================================================
 * Notation, engraved by Verovio (verovio.org, LGPL-3.0).
 *
 * Verovio draws the file as one long line of music, so the view scrolls along
 * it as the piano roll does. It draws only: when each note sounds comes from
 * the native reader, as for the roll (docs/decisions.md, "Verovio draws
 * notation; it doesn't read the timing").
 *
 * Verovio is a separate download, about 2.4 MB compressed, imported the first
 * time a listener opens the notation view, never before.
 * ======================================================================== */

// ── Loading Verovio ──

let toolkit: Promise<VerovioToolkit> | null = null

function loadToolkit(): Promise<VerovioToolkit> {
  toolkit ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit, enableLog, LOG_OFF }] =
      await Promise.all([import('verovio/wasm'), import('verovio/esm')])
    const engine = await createVerovioModule()
    // Verovio logs every quirk of an encoding to the console.
    enableLog(LOG_OFF, engine)
    return new VerovioToolkit(engine)
  })().catch((err: unknown) => {
    // A failed download is tried again the next time the view is opened.
    toolkit = null
    throw err
  })
  return toolkit
}

// ── Engraving ──

export interface Engraving {
  /** The notation as SVG markup, scaled by its viewBox. */
  svg: string
  /** Its natural size, in pixels. */
  width: number
  height: number
}

// The last file engraved, so switching views back and forth draws it once.
let last: { text: string; engraving: Engraving } | null = null

/** Engraves an MEI file as one line of music. Rejects if Verovio can't load or read it. */
export async function engrave(text: string): Promise<Engraving> {
  if (last?.text === text) return last.engraving
  const tk = await loadToolkit()
  const failed = "Couldn't show this file as notation."
  let svg = ''
  try {
    tk.resetOptions()
    tk.setOptions({
      // One system, as wide as the music: no line or page breaks.
      breaks: 'none',
      adjustPageWidth: true,
      adjustPageHeight: true,
      scale: 40,
      header: 'none',
      footer: 'none',
      pageMarginTop: 20,
      pageMarginBottom: 20,
      pageMarginLeft: 20,
      pageMarginRight: 20,
      // Every movement, one after another, as the reader times them.
      mdivAll: true,
      svgViewBox: true,
    })
    if (tk.loadData(text)) svg = tk.renderToSVG(1)
  } catch {
    // Verovio's engine stops on a few files; start a fresh one next time.
    toolkit = null
    throw new Error(failed)
  }
  if (!svg) throw new Error(failed)
  const box = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg)
  const engraving = { svg, width: box ? parseFloat(box[1]) : 0, height: box ? parseFloat(box[2]) : 0 }
  last = { text, engraving }
  return engraving
}
