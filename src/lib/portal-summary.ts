// Pure aggregation behind the employee portal's monthly summary and its "you didn't
// check out" prompt. Kept free of React and fetch so it is unit-tested directly; the
// portal hands it rows exactly as the APIs return them (NUMERIC columns arrive as strings).

import { addDays, monthEnd } from '@/lib/oman-date'
import { weekdayOf } from '@/lib/schedule-core'

export interface SummaryAttendanceRow {
  date: string
  check_in?: string | null
  check_out?: string | null
  work_hours?: number | string | null
  overtime_hours?: number | string | null
  status?: string | null
  notes?: string | null
}

export interface SummaryTardinessRow {
  date: string
  minutes_late: number
}

export interface SummaryLeaveRow {
  start_date: string
  end_date: string
  days_count: number | string
  status: string
}

export interface MonthlySummary {
  presentDays: number
  absentDays: number
  totalHours: number
  overtimeHours: number
  lateCount: number
  lateMinutes: number
  leaveDays: number
}

const num = (v: number | string | null | undefined) => {
  const n = parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}
const round2 = (n: number) => Math.round(n * 100) / 100
const inMonth = (date: string, month: string) => date.slice(0, 7) === month

/**
 * Days of one approved leave that fall in `month`.
 *
 * A leave wholly inside the month counts its own days_count — that figure already
 * excludes weekends and holidays and is what came off the balance. One that crosses a
 * month boundary is split by counting the employee's working weekdays on each side
 * (capped at days_count). Public holidays inside such a leave aren't known here, so the
 * split can be a day generous; the total across both months never exceeds days_count.
 */
export function leaveDaysInMonth(leave: SummaryLeaveRow, month: string, workDays: number[]): number {
  const first = `${month}-01`
  const last = monthEnd(month)
  const from = leave.start_date > first ? leave.start_date : first
  const to = leave.end_date < last ? leave.end_date : last
  if (from > to) return 0
  const total = num(leave.days_count)
  if (leave.start_date >= first && leave.end_date <= last) return total

  let working = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (workDays.includes(weekdayOf(d))) working++
  }
  return Math.min(working, total)
}

/** Everything the summary card shows for one YYYY-MM month. */
export function summariseMonth(
  month: string,
  data: {
    attendance: SummaryAttendanceRow[]
    tardiness: SummaryTardinessRow[]
    leaves: SummaryLeaveRow[]
    workDays: number[]
  }
): MonthlySummary {
  const rows = data.attendance.filter(r => inMonth(r.date, month))
  const late = data.tardiness.filter(r => inMonth(r.date, month))
  const leaveDays = data.leaves
    .filter(l => l.status === 'approved')
    .reduce((sum, l) => sum + leaveDaysInMonth(l, month, data.workDays), 0)

  return {
    // A day counts as attended when there is a check-in — the same test the automation
    // uses before it would mark someone absent.
    presentDays: rows.filter(r => !!r.check_in).length,
    absentDays: rows.filter(r => r.status === 'absent' && !r.check_in).length,
    totalHours: round2(rows.reduce((s, r) => s + num(r.work_hours), 0)),
    overtimeHours: round2(rows.reduce((s, r) => s + num(r.overtime_hours), 0)),
    lateCount: late.length,
    lateMinutes: late.reduce((s, r) => s + (r.minutes_late || 0), 0),
    leaveDays: round2(leaveDays),
  }
}

/**
 * The working day before `today` for this schedule (YYYY-MM-DD). With no working days
 * configured it degrades to plain yesterday rather than looping.
 */
export function previousWorkingDay(today: string, workDays: number[]): string {
  let d = addDays(today, -1)
  if (workDays.length === 0) return d
  for (let i = 0; i < 7 && !workDays.includes(weekdayOf(d)); i++) d = addDays(d, -1)
  return d
}

export interface MissedCheckout {
  date: string
  checkIn: string // HH:MM
  /** HH:MM the automation filled in, or null when the day is still open. */
  autoCheckout: string | null
}

/**
 * A recent day the employee checked in but never checked out — still open, or closed
 * by the nightly automation at the end of their schedule (its '[Auto checkout]' note).
 *
 * Looks from the previous working day up to yesterday, so a weekend or holiday shift
 * in between is caught too. A day that already has a correction request (in any state)
 * or was corrected is left alone: the employee has dealt with it.
 */
export function findMissedCheckout(
  records: SummaryAttendanceRow[],
  today: string,
  workDays: number[],
  correctedDates: Iterable<string>
): MissedCheckout | null {
  const floor = previousWorkingDay(today, workDays)
  const handled = new Set(correctedDates)
  const recent = records
    .filter(r => r.date < today && r.date >= floor)
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  for (const r of recent) {
    if (!r.check_in || handled.has(r.date)) continue
    const notes = r.notes ?? ''
    if (notes.includes('[Corrected]')) continue
    const auto = !!r.check_out && notes.includes('[Auto checkout]')
    if (r.check_out && !auto) continue
    return {
      date: r.date,
      checkIn: r.check_in.slice(0, 5),
      autoCheckout: auto ? String(r.check_out).slice(0, 5) : null,
    }
  }
  return null
}
