import { describe, it, expect } from 'vitest'
import { tardinessLeaveDeduction } from '@/lib/tardiness-penalty'

describe('tardinessLeaveDeduction', () => {
  it('is zero for no lateness', () => {
    expect(tardinessLeaveDeduction(0, 8)).toBe(0)
    expect(tardinessLeaveDeduction(-5, 8)).toBe(0)
  })

  it('a full workday of lateness costs exactly one leave day', () => {
    expect(tardinessLeaveDeduction(480, 8)).toBe(1) // 8h * 60
    expect(tardinessLeaveDeduction(540, 9)).toBe(1) // 9h * 60
  })

  it('half a workday late costs half a leave day', () => {
    expect(tardinessLeaveDeduction(240, 8)).toBe(0.5)
  })

  it('small lateness still registers (rounded to 3 decimals)', () => {
    // 2 / 480 = 0.004166... -> 0.004
    expect(tardinessLeaveDeduction(2, 8)).toBe(0.004)
    // 15 / 480 = 0.03125 -> 0.031
    expect(tardinessLeaveDeduction(15, 8)).toBe(0.031)
  })

  it('scales with the configured workday length', () => {
    // Shorter workday => each late minute is a bigger fraction of a day
    expect(tardinessLeaveDeduction(60, 8)).toBe(0.125) // 60/480
    expect(tardinessLeaveDeduction(60, 6)).toBe(0.167) // 60/360 = 0.1666 -> 0.167
  })

  it('falls back to an 8h day when work hours is missing/zero', () => {
    expect(tardinessLeaveDeduction(480, 0)).toBe(1)
  })
})
