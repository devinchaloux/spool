// ── The roll's zoom ──

// The roll's zoom range, in px per quarter-note beat. The floor keeps notes
// readable: below it, a phone-width roll crushes bars together (2026-11-20,
// which raised it back from 12).
export const ROLL_ZOOM = { min: 28, max: 160 }
// A file that would need less than this to fit opens here and scrolls.
export const ROLL_OPEN_MIN = ROLL_ZOOM.min

/**
 * The zoom a roll opens at when the page gives none: the whole file fits
 * `trackWidth` (the roll's width less its keyboard) when it can at
 * ROLL_ZOOM.min or more; a longer file opens at ROLL_OPEN_MIN and scrolls.
 */
export function fitZoom(trackWidth: number, totalBeats: number): number {
  if (!(totalBeats > 0) || !(trackWidth > 0)) return ROLL_OPEN_MIN
  const fit = Math.floor(trackWidth / totalBeats)
  if (fit < ROLL_ZOOM.min) return ROLL_OPEN_MIN
  return Math.min(fit, ROLL_ZOOM.max)
}
