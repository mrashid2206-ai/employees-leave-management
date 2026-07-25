// Projects where an employee's annual leave balance is heading before the fiscal year
// resets.
//
// Two facts make this worth showing rather than just printing a balance:
//
//  1. The yearly reset is CLEAN SLATE -- balances are set back to the annual allowance and
//     unused days do NOT carry over. Days you never took are simply lost, so people need
//     to see what is about to expire while there is still time to book it.
//  2. Tardiness is paid for in leave days. A balance that looks fine today can be eaten by
//     the rest of the year's lateness at the current rate.
//
// Approved leave is ALREADY deducted from the balance when it is approved, so it is
// reported as context ("booked") and never subtracted again here. Pending requests are
// not yet deducted, which is why they are the ones that move the projection.

export type ForecastStatus = 'negative' | 'critical' | 'tight' | 'healthy'

export interface ForecastInput {
  /** Balance as stored today (approved leave already taken out; may be negative). */
  currentBalance: number
  /** Approved days that have not been taken yet — booked, already paid for. */
  approvedUpcomingDays: number
  /** Days requested but not yet approved — not deducted yet. */
  pendingDays: number
  /** Leave days already lost to tardiness this fiscal year. */
  tardinessDeductedYtd: number
  fiscalYearStart: string // YYYY-MM-DD
  fiscalYearEnd: string // YYYY-MM-DD
  today: string // YYYY-MM-DD
}

export interface Forecast {
  currentBalance: number
  approvedUpcomingDays: number
  pendingDays: number
  /** Balance if every pending request is approved. */
  projectedBalance: number
  tardinessDeductedYtd: number
  /** Tardiness cost for the WHOLE year if the current rate holds. */
  tardinessProjectedYearEnd: number
  /** Balance expected at year end if no further leave is taken. */
  projectedYearEndBalance: number
  /** Days that would be lost to the clean-slate reset if never used. */
  expiringDays: number
  daysLeftInYear: number
  /** 0..1 — how much of the fiscal year has already passed. */
  yearElapsedFraction: number
  status: ForecastStatus
}

const DAY_MS = 86400000
const parse = (d: string) => Date.parse(d + 'T00:00:00Z')
const round1 = (n: number) => Math.round(n * 10) / 10

export function forecastLeave(input: ForecastInput): Forecast {
  const start = parse(input.fiscalYearStart)
  const end = parse(input.fiscalYearEnd)
  const now = parse(input.today)

  const totalDays = Math.max(1, Math.round((end - start) / DAY_MS) + 1)
  // Clamp: a `today` outside the configured year (mid-reset, or a misconfigured range)
  // must not produce negative elapsed days or a >100% projection.
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.round((now - start) / DAY_MS) + 1))
  const daysLeftInYear = Math.max(0, totalDays - elapsedDays)
  const yearElapsedFraction = elapsedDays / totalDays

  const projectedBalance = input.currentBalance - input.pendingDays

  // Extrapolate the tardiness burn rate across the full year. Before any of the year has
  // elapsed there is no rate to extrapolate from, so report what has actually happened.
  const tardinessProjectedYearEnd =
    yearElapsedFraction > 0
      ? round1(input.tardinessDeductedYtd / yearElapsedFraction)
      : round1(input.tardinessDeductedYtd)

  const tardinessStillToCome = Math.max(0, tardinessProjectedYearEnd - input.tardinessDeductedYtd)
  const projectedYearEndBalance = round1(projectedBalance - tardinessStillToCome)
  const expiringDays = Math.max(0, projectedYearEndBalance)

  let status: ForecastStatus
  if (input.currentBalance <= 0) status = 'negative'
  else if (projectedYearEndBalance < 0) status = 'critical'
  else if (projectedBalance < 5) status = 'tight'
  else status = 'healthy'

  return {
    currentBalance: round1(input.currentBalance),
    approvedUpcomingDays: round1(input.approvedUpcomingDays),
    pendingDays: round1(input.pendingDays),
    projectedBalance: round1(projectedBalance),
    tardinessDeductedYtd: round1(input.tardinessDeductedYtd),
    tardinessProjectedYearEnd,
    projectedYearEndBalance,
    expiringDays: round1(expiringDays),
    daysLeftInYear,
    // 3 decimals, not 2: early in the year 1/365 would round to a flat 0 and read as
    // "the year hasn't started".
    yearElapsedFraction: Math.round(yearElapsedFraction * 1000) / 1000,
    status,
  }
}
