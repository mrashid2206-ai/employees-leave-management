import { describe, it, expect } from 'vitest'
import { changedFields, formatChanges } from '@/lib/audit-diff'

describe('changedFields', () => {
  it('reports only fields whose value differs', () => {
    const changes = changedFields({ a: 1, b: 'x', c: null }, { a: 2, b: 'x', c: null }, ['a', 'b', 'c'])
    expect(changes).toEqual([{ field: 'a', from: 1, to: 2 }])
  })

  it('treats null, undefined and empty string as the same blank', () => {
    expect(changedFields({ a: null, b: '' }, { a: '', b: undefined }, ['a', 'b'])).toEqual([])
  })

  it('compares numbers numerically, so a numeric string is not a change', () => {
    expect(changedFields({ a: 29.5 }, { a: '29.50' }, ['a'])).toEqual([])
    expect(changedFields({ a: 29.5 }, { a: 29.25 }, ['a'])).toHaveLength(1)
  })

  it('ignores fields not asked about', () => {
    expect(changedFields({ a: 1, updated_at: 'then' }, { a: 1, updated_at: 'now' }, ['a'])).toEqual([])
  })
})

describe('formatChanges', () => {
  it('writes old→new, marking blanks', () => {
    expect(formatChanges([
      { field: 'name', from: 'A', to: 'B' },
      { field: 'work_days', from: null, to: '0,1,2' },
    ])).toBe('name A→B, work_days (none)→0,1,2')
  })

  it('lists private fields by name only', () => {
    expect(formatChanges([{ field: 'phone', from: '111', to: '222' }], ['phone'])).toBe('phone')
  })
})
