import { describe, expect, it } from 'vitest'
import { fitZoom, ROLL_OPEN_MIN, ROLL_ZOOM } from '../roll/zoom'

describe('fitZoom', () => {
  it('opens a four-bar excerpt on a phone at a readable zoom, to scroll', () => {
    // 16 beats in 238 px: the width of a roll on a 390 px phone screen.
    // Fitting would take 14 px per beat, too crushed to read.
    expect(fitZoom(238, 16)).toBe(ROLL_OPEN_MIN)
  })
  it('fits a short file to a wide roll, up to the most zoom', () => {
    expect(fitZoom(800, 16)).toBe(50)
    expect(fitZoom(4000, 4)).toBe(ROLL_ZOOM.max)
  })
  it('opens a long file at a readable zoom, to scroll', () => {
    expect(fitZoom(800, 400)).toBe(ROLL_OPEN_MIN)
  })
  it('falls back when the width or length is unknown', () => {
    expect(fitZoom(0, 16)).toBe(ROLL_OPEN_MIN)
    expect(fitZoom(800, 0)).toBe(ROLL_OPEN_MIN)
  })
})
