import { describe, it, expect } from 'vitest'
import { omanToday, omanYesterday, omanTime, addDays } from '@/lib/oman-date'

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
