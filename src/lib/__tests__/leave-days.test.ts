import { describe, it, expect } from 'vitest'
import { countLeaveDays } from '@/lib/leave-days'

// Minimal stub matching the Queryable shape countLeaveDays expects — returns a fixed
// holiday count so the calendar-day math can be tested without a real database.
function stubClient(holidayCount: number) {
  return {
    query: async () => ({ rows: [{ cnt: String(holidayCount) }] }),
  }
}

describe('countLeaveDays', () => {
  it('counts inclusive calendar days (weekends included)', async () => {
    expect(await countLeaveDays('2026-03-01', '2026-03-05', stubClient(0))).toBe(5)
  })
  it('subtracts public holidays in range', async () => {
    expect(await countLeaveDays('2026-03-01', '2026-03-05', stubClient(1))).toBe(4)
  })
  it('is 1 for a single day', async () => {
    expect(await countLeaveDays('2026-03-10', '2026-03-10', stubClient(0))).toBe(1)
  })
  it('never returns less than 1 even if holidays cover the whole range', async () => {
    expect(await countLeaveDays('2026-03-01', '2026-03-02', stubClient(5))).toBe(1)
  })
  it('spans month boundaries correctly', async () => {
    // Mar 30, 31, Apr 1 = 3 days
    expect(await countLeaveDays('2026-03-30', '2026-04-01', stubClient(0))).toBe(3)
  })
})
