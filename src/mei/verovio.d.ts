// ── Verovio's interface ──
// The verovio package ships no type declarations; these cover the parts the
// Verovio reader (parseVerovio.ts) uses.

declare module 'verovio/wasm' {
  /** Starts Verovio's compiled engine. */
  export default function createVerovioModule(): Promise<unknown>
}

declare module 'verovio/esm' {
  export const LOG_OFF: number
  export function enableLog(level: number, module: unknown): void

  /** One moment in the piece: what starts and stops then. */
  export interface TimemapEntry {
    /** Time in quarter notes from the start, repeats played out. */
    qstamp: number
    /** Time in milliseconds, following the tempo. */
    tstamp: number
    /** Notes that start or stop here, by xml:id. */
    on?: string[]
    off?: string[]
    restsOn?: string[]
    restsOff?: string[]
    /** The bar that starts here. */
    measureOn?: string
    /** The tempo from here on, in quarter notes a minute. */
    tempo?: number
  }

  export class VerovioToolkit {
    constructor(module: unknown)
    resetOptions(): void
    loadData(data: string): boolean
    renderToTimemap(options?: { includeMeasures?: boolean; includeRests?: boolean }): TimemapEntry[]
    getMEI(options?: Record<string, unknown>): string
    /** For a note in a repeat played out, the id of the note as written. */
    getNotatedIdForElement(xmlId: string): string
  }
}
