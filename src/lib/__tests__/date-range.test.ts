import { describe, it, expect } from 'vitest'
import { isIsoDate, parseDateRange, parseDateParam, rangeConditions } from '@/server/validation'

const params = (q: string) => new URLSearchParams(q)

describe('isIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-1-01')).toBe(false)
    expect(isIsoDate("2026-01-01' OR 1=1")).toBe(false)
  })
})

describe('parseDateRange', () => {
  it('is empty when neither bound is given', () => {
    const r = parseDateRange(params(''))
    expect(r.ok && r.data).toEqual({ from: null, to: null })
  })

  it('takes either bound alone, or both', () => {
    const a = parseDateRange(params('from=2026-03-01'))
    expect(a.ok && a.data).toEqual({ from: '2026-03-01', to: null })
    const b = parseDateRange(params('from=2026-03-01&to=2027-02-28'))
    expect(b.ok && b.data).toEqual({ from: '2026-03-01', to: '2027-02-28' })
  })

  it('answers 400 for a malformed or reversed range', async () => {
    for (const q of ['from=2026-02-30', 'to=yesterday', 'from=2026-05-01&to=2026-04-01']) {
      const r = parseDateRange(params(q))
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.response.status).toBe(400)
        expect((await r.response.json()).error).toBeTruthy()
      }
    }
  })
})

describe('parseDateParam', () => {
  it('treats an empty value as absent', () => {
    const r = parseDateParam(params('date='), 'date')
    expect(r.ok && r.data).toBeNull()
  })
})

describe('rangeConditions', () => {
  it('binds each bound as a parameter after the ones already there', () => {
    const bound: unknown[] = [7]
    const sql = rangeConditions('t.date', { from: '2026-01-01', to: '2026-12-31' }, bound)
    expect(sql).toEqual(['t.date >= $2', 't.date <= $3'])
    expect(bound).toEqual([7, '2026-01-01', '2026-12-31'])
  })
})
