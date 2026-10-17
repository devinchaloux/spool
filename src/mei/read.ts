import { parseNative } from './parseNative'
import { parseVerovio } from './parseVerovio'
import type { MeiScore } from './types'

// ── Choosing a reader ──
// The native reader is instant and needs no download, so it reads every file
// first. When it reports a gap Verovio fills, Verovio reads the file instead,
// downloaded the first time a file needs it (docs/decisions.md, "two readers
// behind one renderer").

/** "auto" (the default): the native reader, or Verovio when the file needs it. */
export type ReaderChoice = 'auto' | 'native' | 'verovio'

// Repeats, unflagged short bars, meter and key changes, transposing parts,
// and editorial markup the native reader skips (<app>, <add>, <tupletSpan>…).
function verovioFills(code: string): boolean {
  return ['repeat', 'short-bar', 'mid-change', 'transposing'].includes(code) || code.startsWith('skipped:')
}

/**
 * Reads an MEI file with the reader chosen. With "auto", if Verovio is needed
 * but can't load or read the file, the native reader's result is returned
 * with a warning saying so.
 */
export async function readMei(text: string, reader: ReaderChoice = 'auto'): Promise<MeiScore> {
  if (reader === 'verovio') return parseVerovio(text)
  const native = parseNative(text)
  if (reader === 'native' || !native.warnings.some((w) => verovioFills(w.code))) return native
  try {
    return await parseVerovio(text)
  } catch {
    native.warnings.push({ code: 'verovio-failed', message: "Verovio couldn't read this file, so these gaps remain.", count: 1 })
    return native
  }
}
