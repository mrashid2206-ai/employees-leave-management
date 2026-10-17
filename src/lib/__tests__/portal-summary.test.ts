import { describe, it, expect } from 'vitest'
import {
  findMissedCheckout,
  leaveDaysInMonth,
  previousWorkingDay,
  summariseMonth,
  type SummaryAttendanceRow,
} from '@/lib/portal-summary'

const SUN_THU = [0, 1, 2, 3, 4]

describe('summariseMonth', () => {
  // Rows exactly as the APIs return them: NUMERIC columns arrive as strings.
  const attendance: SummaryAttendanceRow[] = [
    { date: '2026-10-01', check_in: '07:30:00', check_out: '16:30:00', work_hours: '9.00', overtime_hours: '1.00', status: 'present' },
    { date: '2026-10-04', check_in: '08:10:00', check_out: '16:00:00', work_hours: '7.83', overtime_hours: '0', status: 'present' },
    { date: '2026-10-05', status: 'absent' },
    { date: '2026-10-06', check_in: '07:55:00', check_out: null, work_hours: null, status: 'present' },
    // A different month must not leak in.
    { date: '2026-09-30', check_in: '07:30:00', check_out: '15:30:00', work_hours: '8', status: 'present' },
  ]
  const tardiness = [
    { date: '2026-10-04', minutes_late: 10 },
    { date: '2026-10-12', minutes_late: 25 },
    { date: '2026-09-29', minutes_late: 40 },
  ]

  it('counts the month and nothing else', () => {
    const s = summariseMonth('2026-10', { attendance, tardiness, leaves: [], workDays: SUN_THU })
    expect(s.presentDays).toBe(3)
    expect(s.absentDays).toBe(1)
    expect(s.totalHours).toBe(16.83)
    expect(s.overtimeHours).toBe(1)
    expect(s.lateCount).toBe(2)
    expect(s.lateMinutes).toBe(35)
    expect(s.leaveDays).toBe(0)
  })

  it('counts only approved leave', () => {
    const leaves = [
      { start_date: '2026-10-13', end_date: '2026-10-14', days_count: 2, status: 'approved' },
      { start_date: '2026-10-20', end_date: '2026-10-20', days_count: 1, status: 'pending' },
      { start_date: '2026-10-21', end_date: '2026-10-21', days_count: 1, status: 'rejected' },
      { start_date: '2026-10-22', end_date: '2026-10-22', days_count: '0.5', status: 'approved' },
    ]
    const s = summariseMonth('2026-10', { attendance: [], tardiness: [], leaves, workDays: SUN_THU })
    expect(s.leaveDays).toBe(2.5)
  })

  it('is all zeros for an empty month', () => {
    const s = summariseMonth('2026-02', { attendance, tardiness, leaves: [], workDays: SUN_THU })
    expect(s).toEqual({ presentDays: 0, absentDays: 0, totalHours: 0, overtimeHours: 0, lateCount: 0, lateMinutes: 0, leaveDays: 0 })
  })
})

describe('leaveDaysInMonth', () => {
  it('trusts days_count for a leave inside the month (it already excludes holidays)', () => {
    // 5 weekdays, but a public holiday made it 4 on the balance.
    const leave = { start_date: '2026-10-11', end_date: '2026-10-15', days_count: 4, status: 'approved' }
    expect(leaveDaysInMonth(leave, '2026-10', SUN_THU)).toBe(4)
  })

  it('splits a leave across a month boundary by working days', () => {
    // Wed 2026-09-30 .. Tue 2026-10-06 (Sun–Thu week): Sep has Wed 30 = 1 day;
    // Oct has Thu 1, Sun 4, Mon 5, Tue 6 = 4 days.
    const leave = { start_date: '2026-09-30', end_date: '2026-10-06', days_count: 5, status: 'approved' }
    expect(leaveDaysInMonth(leave, '2026-09', SUN_THU)).toBe(1)
    expect(leaveDaysInMonth(leave, '2026-10', SUN_THU)).toBe(4)
  })

  it('never gives a month more than the leave cost', () => {
    const leave = { start_date: '2026-09-28', end_date: '2026-10-08', days_count: 2, status: 'approved' }
    expect(leaveDaysInMonth(leave, '2026-10', SUN_THU)).toBe(2)
  })

  it('is zero for a leave outside the month', () => {
    const leave = { start_date: '2026-11-01', end_date: '2026-11-02', days_count: 2, status: 'approved' }
    expect(leaveDaysInMonth(leave, '2026-10', SUN_THU)).toBe(0)
  })
})

describe('previousWorkingDay', () => {
  it('is yesterday mid-week', () => {
    expect(previousWorkingDay('2026-10-21', SUN_THU)).toBe('2026-10-20') // Wed -> Tue
  })

  it('skips the weekend: Sunday looks back to Thursday', () => {
    expect(previousWorkingDay('2026-10-18', SUN_THU)).toBe('2026-10-15')
  })

  it('follows the employee schedule, not a fixed weekend', () => {
    // Works Sat–Wed: on Saturday the previous working day is Wednesday.
    expect(previousWorkingDay('2026-10-17', [6, 0, 1, 2, 3])).toBe('2026-10-14')
  })

  it('degrades to yesterday with no working days configured', () => {
    expect(previousWorkingDay('2026-10-18', [])).toBe('2026-10-17')
  })

  it('crosses a month boundary', () => {
    expect(previousWorkingDay('2026-11-01', SUN_THU)).toBe('2026-10-29') // Sun -> Thu
  })
})

describe('findMissedCheckout', () => {
  const today = '2026-10-18' // Sunday; previous working day Thursday 15th

  it('flags a previous working day that was never checked out', () => {
    const rows = [{ date: '2026-10-15', check_in: '07:40:00', check_out: null }]
    expect(findMissedCheckout(rows, today, SUN_THU, [])).toEqual({
      date: '2026-10-15', checkIn: '07:40', autoCheckout: null,
    })
  })

  it('flags a day the automation closed for them, with the time it used', () => {
    const rows = [{ date: '2026-10-15', check_in: '07:40:00', check_out: '16:00:00', notes: ' [Auto checkout]' }]
    expect(findMissedCheckout(rows, today, SUN_THU, [])).toEqual({
      date: '2026-10-15', checkIn: '07:40', autoCheckout: '16:00',
    })
  })

  it('ignores a day that was checked out normally', () => {
    const rows = [{ date: '2026-10-15', check_in: '07:40:00', check_out: '15:40:00' }]
    expect(findMissedCheckout(rows, today, SUN_THU, [])).toBeNull()
  })

  it('ignores a day already handled by a correction request or a correction', () => {
    const open = [{ date: '2026-10-15', check_in: '07:40:00', check_out: null }]
    expect(findMissedCheckout(open, today, SUN_THU, ['2026-10-15'])).toBeNull()
    const corrected = [{ date: '2026-10-15', check_in: '07:40:00', check_out: '16:00:00', notes: ' [Auto checkout] [Corrected]' }]
    expect(findMissedCheckout(corrected, today, SUN_THU, [])).toBeNull()
  })

  it('catches a weekend shift between the previous working day and today', () => {
    const rows = [
      { date: '2026-10-15', check_in: '07:40:00', check_out: '15:40:00' },
      { date: '2026-10-17', check_in: '09:00:00', check_out: null }, // Saturday holiday work
    ]
    expect(findMissedCheckout(rows, today, SUN_THU, [])?.date).toBe('2026-10-17')
  })

  it('never looks at today (the employee may still be at work) or further back', () => {
    const rows = [
      { date: '2026-10-18', check_in: '07:40:00', check_out: null },
      { date: '2026-10-14', check_in: '07:40:00', check_out: null },
    ]
    expect(findMissedCheckout(rows, today, SUN_THU, [])).toBeNull()
  })

  it('ignores an absence row with no check-in', () => {
    const rows = [{ date: '2026-10-15', status: 'absent' }]
    expect(findMissedCheckout(rows, today, SUN_THU, [])).toBeNull()
  })
})
