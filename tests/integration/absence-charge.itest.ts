import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { applyAutoAbsenceLeave, reverseAutoAbsenceLeave } from '@/lib/auto-absence'
import { AUTO_ABSENCE_LEAVE_NOTE } from '@/lib/constants'
import { HAS_TEST_DB, resetDb, balanceOf, closePool, adminToken, authedRequest, routeParams } from './helpers'

// An unexcused absence costs one annual leave day. The bug this covers: only the nightly
// automation charged it. Marking someone absent by hand — or importing absences in bulk —
// recorded the absence and deducted nothing, so days taken without a leave request were
// free. Meanwhile un-marking an absence always refunded, so the two directions disagreed.
describe.skipIf(!HAS_TEST_DB)('absence charges leave on every path', () => {
  const BASE = 'http://localhost'
  const DATE = '2026-06-10'
  let empId: number
  let adminCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    adminCookie = await adminToken()
  })

  afterAll(async () => {
    await closePool()
  })

  const autoLeaves = async (id: number) => {
    const { rows } = await pool.query(
      'SELECT id, days_count, status FROM leave_requests WHERE employee_id = $1 AND notes = $2',
      [id, AUTO_ABSENCE_LEAVE_NOTE]
    )
    return rows
  }

  const tx = async <T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const out = await fn(client)
      await client.query('COMMIT')
      return out
    } finally {
      client.release()
    }
  }

  describe('the shared charge helper', () => {
    it('charges one day and records an auto-absence leave', async () => {
      const before = await balanceOf(empId)

      const applied = await tx(c => applyAutoAbsenceLeave(c, empId, DATE))

      expect(applied?.days).toBe(1)
      expect(await balanceOf(empId)).toBe(before - 1)
      expect(await autoLeaves(empId)).toHaveLength(1)
    })

    it('is idempotent — charging the same day twice costs one day', async () => {
      const before = await balanceOf(empId)

      await tx(c => applyAutoAbsenceLeave(c, empId, DATE))
      const second = await tx(c => applyAutoAbsenceLeave(c, empId, DATE))

      expect(second).toBeNull()
      expect(await balanceOf(empId)).toBe(before - 1)
      expect(await autoLeaves(empId)).toHaveLength(1)
    })

    it('does not charge when the employee already filed leave for that day', async () => {
      const { rows: type } = await pool.query("SELECT id FROM leave_types WHERE name_en = 'Annual'")
      await pool.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
         VALUES ($1, $2, $3, $3, 1, 'approved')`,
        [empId, type[0].id, DATE]
      )
      const before = await balanceOf(empId)

      const applied = await tx(c => applyAutoAbsenceLeave(c, empId, DATE))

      expect(applied).toBeNull()
      expect(await balanceOf(empId)).toBe(before)
    })

    it('does not push the balance negative when it is exhausted', async () => {
      await pool.query('UPDATE employees SET leave_balance = 0 WHERE id = $1', [empId])

      const applied = await tx(c => applyAutoAbsenceLeave(c, empId, DATE))

      expect(applied).toBeNull()
      expect(await balanceOf(empId)).toBe(0)
    })

    it('charge then reverse returns the balance exactly', async () => {
      const before = await balanceOf(empId)

      await tx(c => applyAutoAbsenceLeave(c, empId, DATE))
      const refunded = await tx(c => reverseAutoAbsenceLeave(c, empId, DATE))

      expect(refunded).toBe(1)
      expect(await balanceOf(empId)).toBe(before)
    })
  })

  describe('admin attendance routes', () => {
    it('POST /api/attendance marking absent deducts a day', async () => {
      const { POST } = await import('@/app/api/attendance/route')
      const before = await balanceOf(empId)

      const res = await POST(
        authedRequest(`${BASE}/api/attendance`, { admin: adminCookie }, {
          method: 'POST',
          body: JSON.stringify({ employee_id: empId, date: DATE, status: 'absent' }),
        })
      )
      expect(res.status).toBe(200)

      expect(await balanceOf(empId)).toBe(before - 1)
      expect(await autoLeaves(empId)).toHaveLength(1)
    })

    it('POST marking present does NOT deduct', async () => {
      const { POST } = await import('@/app/api/attendance/route')
      const before = await balanceOf(empId)

      await POST(
        authedRequest(`${BASE}/api/attendance`, { admin: adminCookie }, {
          method: 'POST',
          body: JSON.stringify({ employee_id: empId, date: DATE, status: 'present', check_in: '08:00', check_out: '16:00' }),
        })
      )

      expect(await balanceOf(empId)).toBe(before)
    })

    it('re-saving the same absent day does not charge twice', async () => {
      const { POST } = await import('@/app/api/attendance/route')
      const before = await balanceOf(empId)
      const body = JSON.stringify({ employee_id: empId, date: DATE, status: 'absent' })

      await POST(authedRequest(`${BASE}/api/attendance`, { admin: adminCookie }, { method: 'POST', body }))
      await POST(authedRequest(`${BASE}/api/attendance`, { admin: adminCookie }, { method: 'POST', body }))

      expect(await balanceOf(empId)).toBe(before - 1)
    })

    it('a bulk import of absences charges each distinct day once', async () => {
      const { POST } = await import('@/app/api/attendance/route')
      const before = await balanceOf(empId)
      const days = ['2026-06-10', '2026-06-11', '2026-06-14']

      await POST(
        authedRequest(`${BASE}/api/attendance`, { admin: adminCookie }, {
          method: 'POST',
          body: JSON.stringify(days.map(date => ({ employee_id: empId, date, status: 'absent' }))),
        })
      )

      // This is the reported scenario: days taken with no leave request must cost leave.
      expect(await balanceOf(empId)).toBe(before - days.length)
      expect(await autoLeaves(empId)).toHaveLength(days.length)
    })

    it('PUT flipping present -> absent charges, and back again refunds', async () => {
      const { POST } = await import('@/app/api/attendance/route')
      const { PUT } = await import('@/app/api/attendance/[id]/route')
      const before = await balanceOf(empId)

      const created = await POST(
        authedRequest(`${BASE}/api/attendance`, { admin: adminCookie }, {
          method: 'POST',
          body: JSON.stringify({ employee_id: empId, date: DATE, status: 'present', check_in: '08:00' }),
        })
      )
      const rowId = (await created.json())[0].id
      expect(await balanceOf(empId)).toBe(before)

      const toAbsent = await PUT(
        authedRequest(`${BASE}/api/attendance/${rowId}`, { admin: adminCookie }, {
          method: 'PUT', body: JSON.stringify({ status: 'absent' }),
        }),
        routeParams({ id: String(rowId) })
      )
      expect((await toAbsent.json()).chargedDays).toBe(1)
      expect(await balanceOf(empId)).toBe(before - 1)

      const backToPresent = await PUT(
        authedRequest(`${BASE}/api/attendance/${rowId}`, { admin: adminCookie }, {
          method: 'PUT', body: JSON.stringify({ status: 'present' }),
        }),
        routeParams({ id: String(rowId) })
      )
      expect((await backToPresent.json()).refundedDays).toBe(1)
      expect(await balanceOf(empId)).toBe(before)
    })
  })
})
