import { describe, it, expect } from 'vitest'
import { decisionMessage } from '@/lib/decision-message'

// What the employee reads in the bell and in the push notification. The reason for a
// rejection is the point of the message, so it must survive into both languages.
describe('decisionMessage', () => {
  it('carries the reason for a rejected leave, in both languages', () => {
    const m = decisionMessage('leave', 'rejected', { start: '2026-05-01', end: '2026-05-03' }, 'Team is short that week')
    expect(m.en).toBe('Your leave request (2026-05-01 to 2026-05-03) was rejected. Reason: Team is short that week')
    expect(m.ar).toContain('تم رفض طلب إجازتك')
    expect(m.ar).toContain('السبب: Team is short that week')
    expect(m.title).toContain('Leave rejected')
    expect(m.title).toContain('تم رفض الإجازة')
  })

  it('labels an approval note as a note, not a reason', () => {
    const m = decisionMessage('leave', 'approved', { start: '2026-05-01', end: '2026-05-01' }, 'Enjoy')
    expect(m.en).toMatch(/approved\. Note: Enjoy$/)
    expect(m.ar).toContain('ملاحظة: Enjoy')
    expect(m.en).not.toContain('Reason')
  })

  it('says nothing extra when there is no note', () => {
    const m = decisionMessage('correction', 'approved', { date: '2026-06-10' }, '   ')
    expect(m.en).toBe('Your attendance correction request for 2026-06-10 was approved.')
    expect(m.ar).toBe('تمت الموافقة على طلب تصحيح الحضور بتاريخ 2026-06-10.')
  })

  it('names the day and time of a permission', () => {
    const m = decisionMessage('permission', 'rejected', { date: '2026-06-10', time: '10:30' }, 'Busy day')
    expect(m.en).toBe('Your permission request on 2026-06-10 at 10:30 was rejected. Reason: Busy day')
    expect(m.ar).toContain('بتاريخ 2026-06-10 الساعة 10:30')
    expect(m.title).toContain('Permission rejected')
  })

  it('writes Arabic as real characters', () => {
    for (const kind of ['leave', 'permission', 'correction'] as const) {
      for (const d of ['approved', 'rejected'] as const) {
        const m = decisionMessage(kind, d, { start: 'a', end: 'b', date: 'c', time: 'd' }, 'x')
        expect(m.ar).not.toMatch(/\\u[0-9a-fA-F]{4}/)
        expect(m.title).not.toMatch(/\\u[0-9a-fA-F]{4}/)
      }
    }
  })
})
