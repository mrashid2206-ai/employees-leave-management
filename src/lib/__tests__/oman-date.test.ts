import { describe, it, expect } from 'vitest'
import {
  omanToday, omanYesterday, omanTime, addDays,
  omanMonth, addMonths, monthEnd, formatOmanTime, formatOmanDate, formatMonthLabel,
} from '@/lib/oman-date'

// Oman is UTC+4 with no DST. The bug these guard against: `toISOString()` returns the UTC
// date, so for the first four hours of every Oman day it reports YESTERDAY. That shipped
// twice — in five client components, and in reviewCorrection, where it rewrote attendance
// a day early.
describe('oman date helpers', () => {
  it('reports the Oman date, not the UTC date, just after midnight', () => {
    // 2026-06-10T21:30Z is 2026-06-11 01:30 in Oman — a different calendar day.
    const instant = new Date('2026-06-10T21:30:00Z')
    expect(omanToday(instant)).toBe('2026-06-11')
    expect(instant.toISOString().split('T')[0]).toBe('2026-06-10') // what the old code gave
  })

  it('agrees with UTC during the rest of the day', () => {
    const instant = new Date('2026-06-10T09:00:00Z') // 13:00 Oman
    expect(omanToday(instant)).toBe('2026-06-10')
  })

  it('rolls over exactly at Oman midnight (20:00 UTC)', () => {
    expect(omanToday(new Date('2026-06-10T19:59:59Z'))).toBe('2026-06-10')
    expect(omanToday(new Date('2026-06-10T20:00:00Z'))).toBe('2026-06-11')
  })

  it('formats as YYYY-MM-DD', () => {
    expect(omanToday(new Date('2026-01-05T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(omanToday(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05')
  })

  it('yesterday is the previous Oman day', () => {
    expect(omanYesterday(new Date('2026-06-10T21:30:00Z'))).toBe('2026-06-10') // Oman: 11th
    expect(omanYesterday(new Date('2026-06-10T09:00:00Z'))).toBe('2026-06-09')
  })

  it('gives Oman wall-clock time', () => {
    expect(omanTime(new Date('2026-06-10T09:00:00Z'))).toBe('13:00:00')
    expect(omanTime(new Date('2026-06-10T21:30:00Z'))).toBe('01:30:00')
  })

  describe('addDays', () => {
    it('crosses month boundaries', () => {
      expect(addDays('2026-06-30', 1)).toBe('2026-07-01')
      expect(addDays('2026-07-01', -1)).toBe('2026-06-30')
    })

    it('crosses year boundaries', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    })

    it('handles leap day', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
      expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    })

    it('is a no-op for zero', () => {
      expect(addDays('2026-06-10', 0)).toBe('2026-06-10')
    })
  })
})

// The portal clock and month picker. The clock used toLocaleTimeString() with no zone,
// i.e. the PHONE's zone, so a device set to another country showed a different time from
// the one the server then recorded.
describe('portal display helpers', () => {
  it('formats the clock in Oman time regardless of the instant', () => {
    // 03:05:09 UTC is 07:05:09 in Oman.
    const instant = new Date('2026-10-17T03:05:09Z')
    expect(formatOmanTime(instant, 'en-US')).toBe('07:05 AM')
    expect(formatOmanTime(instant, 'en-US', true)).toBe('07:05:09 AM')
  })

  it('formats the date as Oman sees it just after midnight', () => {
    // 20:30 UTC on the 17th is already Sunday the 18th in Oman.
    expect(formatOmanDate(new Date('2026-10-17T20:30:00Z'), 'en-US')).toBe('Sunday, October 18, 2026')
  })

  it('reports the Oman month', () => {
    expect(omanMonth(new Date('2026-10-31T20:30:00Z'))).toBe('2026-11')
    expect(omanMonth(new Date('2026-10-31T19:30:00Z'))).toBe('2026-10')
  })

  it('shifts months across a year', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-10', 0)).toBe('2026-10')
  })

  it('knows the last day of a month', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28')
    expect(monthEnd('2028-02')).toBe('2028-02-29')
    expect(monthEnd('2026-12')).toBe('2026-12-31')
  })

  it('labels a month', () => {
    expect(formatMonthLabel('2026-10', 'en-US')).toBe('October 2026')
  })
})
