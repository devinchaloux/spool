import { describe, expect, it } from 'vitest'
import { tempoBeat } from '../roll/tempo'

describe('tempoBeat', () => {
  it('counts the lower number in simple meters', () => {
    expect(tempoBeat(4, 4)).toBe(1)
    expect(tempoBeat(2, 2)).toBe(2)
    expect(tempoBeat(3, 8)).toBe(0.5)
    expect(tempoBeat(3, 4)).toBe(1)
  })
  it('counts the dotted beat in compound meters', () => {
    expect(tempoBeat(6, 8)).toBe(1.5)
    expect(tempoBeat(9, 8)).toBe(1.5)
    expect(tempoBeat(12, 8)).toBe(1.5)
    expect(tempoBeat(6, 16)).toBe(0.75)
  })
  it('keeps 6/4 in quarters', () => {
    expect(tempoBeat(6, 4)).toBe(1)
  })
})
