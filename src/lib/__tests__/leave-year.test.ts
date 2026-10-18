import { describe, it, expect } from 'vitest'
import { leaveYears, inLeaveYear, leaveYearMonths, leaveYearLabel } from '@/lib/leave-year'

const MARCH_YEAR = { year_start: '2026-03-01', year_end: '2027-02-28' }

describe('leaveYears', () => {
  it('starts with the current year from settings', () => {
    const [current] = leaveYears(MARCH_YEAR)
    expect(current).toEqual({ start: '2026-03-01', end: '2027-02-28', isCurrent: true })
  })

  it('derives earlier years, each ending the day before the next begins', () => {
    const years = leaveYears(MARCH_YEAR, 3)
    expect(years.slice(1)).toEqual([
      { start: '2025-03-01', end: '2026-02-28', isCurrent: false },
      { start: '2024-03-01', end: '2025-02-28', isCurrent: false },
    ])
  })

  it('keeps Feb 29 in a leap year', () => {
    // 2023-03-01 → 2024-02-29: a fixed "minus one year" on the end date would drop it.
    const years = leaveYears(MARCH_YEAR, 4)
    expect(years[3]).toEqual({ start: '2023-03-01', end: '2024-02-29', isCurrent: false })
  })

  it('works for a calendar year', () => {
    const years = leaveYears({ year_start: '2026-01-01', year_end: '2026-12-31' }, 2)
    expect(years[1]).toEqual({ start: '2025-01-01', end: '2025-12-31', isCurrent: false })
  })
})

describe('inLeaveYear', () => {
  const [year] = leaveYears(MARCH_YEAR)

  it('includes both ends', () => {
    expect(inLeaveYear('2026-03-01', year)).toBe(true)
    expect(inLeaveYear('2027-02-28', year)).toBe(true)
  })

  it('excludes the days either side', () => {
    expect(inLeaveYear('2026-02-28', year)).toBe(false)
    expect(inLeaveYear('2027-03-01', year)).toBe(false)
  })
})

describe('leaveYearMonths', () => {
  it('lists the months from start to end, across the new calendar year', () => {
    const [year] = leaveYears(MARCH_YEAR)
    const months = leaveYearMonths(year)
    expect(months).toHaveLength(12)
    expect(months[0]).toEqual({ year: 2026, month: 2 })
    expect(months[9]).toEqual({ year: 2026, month: 11 })
    expect(months[10]).toEqual({ year: 2027, month: 0 })
    expect(months[11]).toEqual({ year: 2027, month: 1 })
  })

  it('follows the configured start month instead of assuming March', () => {
    const months = leaveYearMonths({ start: '2026-07-01', end: '2027-06-30', isCurrent: true })
    expect(months[0]).toEqual({ year: 2026, month: 6 })
    expect(months.at(-1)).toEqual({ year: 2027, month: 5 })
  })
})

describe('leaveYearLabel', () => {
  it('names a split year by both calendar years', () => {
    expect(leaveYearLabel({ start: '2026-03-01', end: '2027-02-28', isCurrent: true })).toBe('2026/27')
  })

  it('names a calendar year by itself', () => {
    expect(leaveYearLabel({ start: '2026-01-01', end: '2026-12-31', isCurrent: true })).toBe('2026')
  })
})
