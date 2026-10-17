// ── Verovio's interface ──
// The verovio package ships no type declarations; these cover the parts the
// notation view (engrave.ts) uses.

declare module 'verovio/wasm' {
  /** Starts Verovio's compiled engine. */
  export default function createVerovioModule(): Promise<unknown>
}

declare module 'verovio/esm' {
  export const LOG_OFF: number
  export function enableLog(level: number, module: unknown): void

  export class VerovioToolkit {
    constructor(module: unknown)
    resetOptions(): void
    setOptions(options: Record<string, unknown>): void
    loadData(data: string): boolean
    /** One page of the loaded file as SVG markup; pages count from 1. */
    renderToSVG(page: number): string
  }
}
