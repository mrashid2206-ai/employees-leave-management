import { describe, it, expect } from 'vitest'
import { interpolate, t, translations } from '@/lib/translations'

describe('interpolate', () => {
  it('fills placeholders', () => {
    expect(interpolate('{name} balance low ({days} days)', { name: 'Ahmed', days: 3 })).toBe(
      'Ahmed balance low (3 days)'
    )
  })

  it('fills the same placeholder more than once', () => {
    expect(interpolate('{n} of {n}', { n: 2 })).toBe('2 of 2')
  })

  it('leaves an unknown placeholder visible rather than printing undefined', () => {
    // A visible {missing} is a bug report; "undefined" shown to an employee is not.
    expect(interpolate('hello {missing}', { name: 'x' })).toBe('hello {missing}')
  })

  it('is a no-op without vars', () => {
    expect(interpolate('nothing to fill')).toBe('nothing to fill')
    expect(interpolate('{name} stays')).toBe('{name} stays')
  })

  it('coerces numbers and does not treat replacement text as a pattern', () => {
    expect(interpolate('{a}', { a: 0 })).toBe('0')
    // '$&' in a replacement value must not be re-expanded by String.replace.
    expect(interpolate('{a}', { a: '$& $1' })).toBe('$& $1')
  })

  it('translates with interpolation in both languages', () => {
    expect(t('employeesOnLeaveToday', 'en', { count: 4 })).toBe('4 employees on leave today')
    expect(t('employeesOnLeaveToday', 'ar', { count: 4 })).toContain('4')
  })
})

describe('translation table', () => {
  it('every key has both languages, non-empty', () => {
    for (const [key, value] of Object.entries(translations)) {
      expect(value.ar, `${key}.ar`).toBeTruthy()
      expect(value.en, `${key}.en`).toBeTruthy()
    }
  })

  it('a key with placeholders declares the same ones in both languages', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    for (const [key, value] of Object.entries(translations)) {
      expect(names(value.ar), `${key}: Arabic and English placeholders differ`).toEqual(names(value.en))
    }
  })
})
