import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { upsertAttendance, updateAttendance, deleteAttendance } from '@/server/services/attendance-service'
import { HAS_TEST_DB, resetDb, balanceOf, closePool, ADMIN } from './helpers'

// These writes move leave balances, which is why they were lifted out of the route
// handlers. Testing them directly — rather than through HTTP — is the point of that move.
describe.skipIf(!HAS_TEST_DB)('attendance service', () => {
  let empId: number
  const DATE = '2026-06-10'

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
  })

  afterAll(async () => {
    await closePool()
  })

  const rowFor = async (date = DATE) => {
    const { rows } = await pool.query(
      `SELECT id, check_in::text AS check_in, check_out::text AS check_out,
              work_hours::float8 AS work_hours, overtime_hours::float8 AS overtime_hours, status, notes
         FROM attendance WHERE employee_id = $1 AND date = $2`,
      [empId, date]
    )
    return rows[0]
  }

  describe('upsert', () => {
    it('computes hours and overtime rather than trusting the caller', async () => {
      // 08:00–19:00 is 11h against an 8h day. No hours are supplied by the caller.
      const res = await upsertAttendance([
        { employee_id: empId, date: DATE, check_in: '08:00', check_out: '19:00', status: 'present' },
      ])
      expect(res.ok).toBe(true)

      const row = await rowFor()
      expect(row.work_hours).toBe(11)
      expect(row.overtime_hours).toBe(3)
    })

    it('charges a leave day when a day is set absent', async () => {
      const before = await balanceOf(empId)
      await upsertAttendance([{ employee_id: empId, date: DATE, status: 'absent' }])
      expect(await balanceOf(empId)).toBe(before - 1)
    })

    it('refunds when the same day is corrected back to present', async () => {
      const before = await balanceOf(empId)
      await upsertAttendance([{ employee_id: empId, date: DATE, status: 'absent' }])
      await upsertAttendance([{ employee_id: empId, date: DATE, check_in: '08:00', status: 'present' }])
      expect(await balanceOf(empId)).toBe(before)
    })

    it('handles a bulk write of several days', async () => {
      const before = await balanceOf(empId)
      const res = await upsertAttendance([
        { employee_id: empId, date: '2026-06-10', status: 'absent' },
        { employee_id: empId, date: '2026-06-11', status: 'absent' },
        { employee_id: empId, date: '2026-06-14', check_in: '08:00', check_out: '16:00', status: 'present' },
      ])
      expect(res.ok && res.data).toHaveLength(3)
      expect(await balanceOf(empId)).toBe(before - 2) // only the two absences charge
    })

    it('falls back to present for an unrecognised status', async () => {
      await upsertAttendance([{ employee_id: empId, date: DATE, status: 'nonsense' }])
      expect((await rowFor()).status).toBe('present')
    })
  })

  describe('update', () => {
    it('rejects a patch with no recognised fields', async () => {
      await upsertAttendance([{ employee_id: empId, date: DATE, status: 'present' }])
      const id = String((await rowFor()).id)

      const res = await updateAttendance(id, { not_a_column: 'x' }, ADMIN)
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(400)
    })

    it('charges when flipped to absent and reports the days', async () => {
      await upsertAttendance([{ employee_id: empId, date: DATE, check_in: '08:00', status: 'present' }])
      const id = String((await rowFor()).id)
      const before = await balanceOf(empId)

      const res = await updateAttendance(id, { status: 'absent' }, ADMIN)

      expect(res.ok && res.data.chargedDays).toBe(1)
      expect(await balanceOf(empId)).toBe(before - 1)
    })

    it('refunds when flipped back, and nets to zero', async () => {
      await upsertAttendance([{ employee_id: empId, date: DATE, status: 'absent' }])
      const id = String((await rowFor()).id)
      const afterCharge = await balanceOf(empId)

      const res = await updateAttendance(id, { status: 'present' }, ADMIN)

      expect(res.ok && res.data.refundedDays).toBe(1)
      expect(await balanceOf(empId)).toBe(afterCharge + 1)
    })

    it('ignores columns outside the patchable set', async () => {
      await upsertAttendance([{ employee_id: empId, date: DATE, status: 'present' }])
      const id = String((await rowFor()).id)

      // employee_id is not patchable — the row must not be reassigned to someone else.
      const res = await updateAttendance(id, { notes: 'ok', employee_id: 9999 }, ADMIN)
      expect(res.ok).toBe(true)

      const { rows } = await pool.query('SELECT employee_id, notes FROM attendance WHERE id = $1', [id])
      expect(rows[0].employee_id).toBe(empId)
      expect(rows[0].notes).toBe('ok')
    })
  })

  describe('delete', () => {
    it('refunds the leave day when an absence is deleted', async () => {
      const before = await balanceOf(empId)
      await upsertAttendance([{ employee_id: empId, date: DATE, status: 'absent' }])
      const id = String((await rowFor()).id)

      const res = await deleteAttendance(id, ADMIN)

      expect(res.ok && res.data.refundedDays).toBe(1)
      expect(await balanceOf(empId)).toBe(before)
      expect(await rowFor()).toBeUndefined()
    })

    it('does not refund when deleting a present day', async () => {
      await upsertAttendance([{ employee_id: empId, date: DATE, check_in: '08:00', status: 'present' }])
      const id = String((await rowFor()).id)
      const before = await balanceOf(empId)

      const res = await deleteAttendance(id, ADMIN)

      expect(res.ok && res.data.refundedDays).toBe(0)
      expect(await balanceOf(empId)).toBe(before)
    })

    it('treats deleting a missing row as success', async () => {
      const res = await deleteAttendance('999999', ADMIN)
      expect(res.ok).toBe(true)
      expect(res.ok && res.data.refundedDays).toBe(0)
    })
  })
})
