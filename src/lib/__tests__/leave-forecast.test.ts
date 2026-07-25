import { describe, it, expect } from 'vitest'
import { forecastLeave, type ForecastInput } from '@/lib/leave-forecast'

// Fiscal year runs Mar 2026 -> Feb 2027 (365 days).
const base: ForecastInput = {
  currentBalance: 30,
  approvedUpcomingDays: 0,
  pendingDays: 0,
  tardinessDeductedYtd: 0,
  fiscalYearStart: '2026-03-01',
  fiscalYearEnd: '2027-02-28',
  today: '2026-09-01', // ~half way
}

describe('forecastLeave', () => {
  it('reports a clean balance as healthy with nothing expiring beyond it', () => {
    const f = forecastLeave(base)
    expect(f.status).toBe('healthy')
    expect(f.projectedBalance).toBe(30)
    expect(f.tardinessProjectedYearEnd).toBe(0)
    expect(f.expiringDays).toBe(30) // all of it is lost if never used
  })

  it('does not subtract approved leave again — approval already deducted it', () => {
    const f = forecastLeave({ ...base, currentBalance: 20, approvedUpcomingDays: 10 })
    expect(f.projectedBalance).toBe(20)
    expect(f.approvedUpcomingDays).toBe(10)
  })

  it('subtracts pending requests, which have not been deducted yet', () => {
    const f = forecastLeave({ ...base, pendingDays: 4 })
    expect(f.projectedBalance).toBe(26)
  })

  it('extrapolates the tardiness burn rate across the whole year', () => {
    // Half the year gone, 2 days lost so far -> ~4 days for the full year.
    const f = forecastLeave({ ...base, tardinessDeductedYtd: 2 })
    expect(f.tardinessProjectedYearEnd).toBeGreaterThanOrEqual(3.9)
    expect(f.tardinessProjectedYearEnd).toBeLessThanOrEqual(4.2)
    // Only the REMAINING ~1.9 days come off the year-end projection, not the full 3.9 —
    // the 2 days already lost are baked into currentBalance.
    expect(f.projectedYearEndBalance).toBe(28.1)
  })

  it('flags critical when projected tardiness would push the year-end balance below zero', () => {
    const f = forecastLeave({ ...base, currentBalance: 1, tardinessDeductedYtd: 5 })
    expect(f.projectedYearEndBalance).toBeLessThan(0)
    expect(f.status).toBe('critical')
  })

  it('flags negative when the balance is already at or below zero', () => {
    expect(forecastLeave({ ...base, currentBalance: 0 }).status).toBe('negative')
    expect(forecastLeave({ ...base, currentBalance: -3 }).status).toBe('negative')
  })

  it('flags tight when little is left after pending requests', () => {
    const f = forecastLeave({ ...base, currentBalance: 6, pendingDays: 3 })
    expect(f.projectedBalance).toBe(3)
    expect(f.status).toBe('tight')
  })

  it('never reports negative expiring days — you cannot lose what you do not have', () => {
    const f = forecastLeave({ ...base, currentBalance: -5 })
    expect(f.expiringDays).toBe(0)
  })

  it('counts days left in the fiscal year', () => {
    const first = forecastLeave({ ...base, today: '2026-03-01' })
    expect(first.daysLeftInYear).toBe(364)
    expect(first.yearElapsedFraction).toBeGreaterThan(0)

    const last = forecastLeave({ ...base, today: '2027-02-28' })
    expect(last.daysLeftInYear).toBe(0)
    expect(last.yearElapsedFraction).toBe(1)
  })

  it('clamps a date outside the configured fiscal year instead of going haywire', () => {
    // Before the year starts: no negative elapsed days, no absurd extrapolation.
    const before = forecastLeave({ ...base, today: '2026-01-01', tardinessDeductedYtd: 1 })
    expect(before.yearElapsedFraction).toBe(0)
    expect(before.daysLeftInYear).toBe(365)
    expect(Number.isFinite(before.tardinessProjectedYearEnd)).toBe(true)
    expect(before.tardinessProjectedYearEnd).toBe(1)

    // After it ends: elapsed is capped at 100%.
    const after = forecastLeave({ ...base, today: '2028-01-01' })
    expect(after.yearElapsedFraction).toBe(1)
    expect(after.daysLeftInYear).toBe(0)
  })

  it('survives a single-day fiscal year without dividing by zero', () => {
    const f = forecastLeave({
      ...base,
      fiscalYearStart: '2026-03-01',
      fiscalYearEnd: '2026-03-01',
      today: '2026-03-01',
      tardinessDeductedYtd: 1,
    })
    expect(Number.isFinite(f.tardinessProjectedYearEnd)).toBe(true)
    expect(f.yearElapsedFraction).toBe(1)
  })

  it('rounds every figure to one decimal so the UI never shows float noise', () => {
    const f = forecastLeave({ ...base, currentBalance: 29.997, pendingDays: 0.004 })
    for (const v of [f.currentBalance, f.projectedBalance, f.expiringDays, f.tardinessDeductedYtd]) {
      expect(v).toBe(Math.round(v * 10) / 10)
    }
  })
})
