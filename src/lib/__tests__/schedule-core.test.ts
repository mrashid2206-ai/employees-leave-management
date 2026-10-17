import { describe, it, expect } from 'vitest'
import { buildSchedule, formatWorkDays, resolveScheduleFrom, weekdayOf } from '@/lib/schedule-core'

// The portal shows "Your schedule" from the same three rows the server COALESCEs in
// SQL (src/lib/schedule.ts). If the two resolved differently, an employee would be told
// one start time and judged late against another.
describe('resolveScheduleFrom', () => {
  const settings = { work_start_time: '08:00:00', work_days: '0,1,2,3,4', work_hours_per_day: 8 }

  it('falls back to the company settings when nothing is overridden', () => {
    const s = resolveScheduleFrom({}, {}, settings)
    expect(s.workStartTime).toBe('08:00:00')
    expect(s.workDays).toEqual([0, 1, 2, 3, 4])
    expect(s.workHoursPerDay).toBe(8)
  })

  it('takes the department over the company', () => {
    const s = resolveScheduleFrom({}, { work_start_time: '07:30:00', work_hours_per_day: 7 }, settings)
    expect(s.workStartTime).toBe('07:30:00')
    expect(s.workStartMinutes).toBe(450)
    expect(s.workHoursPerDay).toBe(7)
    expect(s.workDays).toEqual([0, 1, 2, 3, 4]) // not overridden -> inherited
  })

  it('takes the employee over the department, field by field', () => {
    const s = resolveScheduleFrom(
      { work_days: '6,0,1,2,3' },
      { work_start_time: '07:30:00', work_days: '0,1,2,3' },
      settings
    )
    expect(s.workDays).toEqual([6, 0, 1, 2, 3])
    expect(s.workStartTime).toBe('07:30:00')
  })

  it('treats NULL and empty string as "inherit", like the admin form stores them', () => {
    const s = resolveScheduleFrom(
      { work_start_time: null, work_days: '', work_hours_per_day: null },
      { work_start_time: '09:00:00' },
      settings
    )
    expect(s.workStartTime).toBe('09:00:00')
    expect(s.workDays).toEqual([0, 1, 2, 3, 4])
  })

  it('accepts hours that arrive as a string from json_build_object', () => {
    const s = resolveScheduleFrom({}, { work_hours_per_day: '6' as unknown as number }, settings)
    expect(s.workHoursPerDay).toBe(6)
  })

  it('uses the built-in defaults when even settings are missing', () => {
    expect(resolveScheduleFrom(null, undefined, null)).toEqual(buildSchedule(undefined))
    expect(buildSchedule(undefined).workStartTime).toBe('08:00:00')
  })
})

describe('weekdayOf', () => {
  it('reads the weekday of the calendar date, not of a local-time instant', () => {
    expect(weekdayOf('2026-10-18')).toBe(0) // Sunday
    expect(weekdayOf('2026-10-22')).toBe(4) // Thursday
    expect(weekdayOf('2026-10-17')).toBe(6) // Saturday
  })
})

describe('formatWorkDays', () => {
  it('collapses a consecutive week into a range', () => {
    expect(formatWorkDays([0, 1, 2, 3, 4], 'en-US')).toBe('Sun–Thu')
  })

  it('handles a run that wraps past Saturday', () => {
    expect(formatWorkDays([6, 0, 1, 2, 3], 'en-US')).toBe('Sat–Wed')
  })

  it('lists days that are not consecutive', () => {
    expect(formatWorkDays([0, 2, 4], 'en-US')).toBe('Sun, Tue, Thu')
  })

  it('names a single day and the whole week', () => {
    expect(formatWorkDays([5], 'en-US')).toBe('Fri')
    expect(formatWorkDays([0, 1, 2, 3, 4, 5, 6], 'en-US')).toBe('Sun–Sat')
  })

  it('is order- and duplicate-insensitive', () => {
    expect(formatWorkDays([4, 3, 2, 1, 0, 0], 'en-US')).toBe('Sun–Thu')
  })

  it('uses Arabic day names and separator for Arabic', () => {
    const out = formatWorkDays([0, 2], 'ar-OM')
    expect(out).toContain('،')
    expect(out).not.toMatch(/Sun|Tue/)
  })

  it('is empty for no working days', () => {
    expect(formatWorkDays([], 'en-US')).toBe('')
  })
})
