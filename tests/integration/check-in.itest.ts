import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { omanToday, omanTime } from '@/lib/oman-date'
import { HAS_TEST_DB, resetDb, addEmployee, balanceOf, closePool, employeeToken, adminToken, authedRequest } from './helpers'

// The most-used endpoint in the system, and until now it had no test at all — despite
// already causing a production incident (the geofence once locked everyone out of checking
// in). It also silently moves a leave balance: checking in on a day covered by a one-day
// approved leave cancels that leave and refunds the day.
describe.skipIf(!HAS_TEST_DB)('check-in / check-out', () => {
  const BASE = 'http://localhost'
  let empId: number
  let otherId: number
  let empCookie: string
  let adminCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    otherId = await addEmployee()
    empCookie = await employeeToken(empId)
    adminCookie = await adminToken()
  })

  afterAll(async () => {
    await closePool()
  })

  // Times relative to NOW, so the assertions hold whenever the suite runs. computeWorkHours
  // wraps past midnight, so a negative offset stays valid in the small hours too.
  const shiftedTime = (hours: number): string => {
    const [h, m, s] = omanTime().split(':').map(Number)
    const total = ((h + hours) * 60 + m + 1440) % 1440
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const act = (action: 'check-in' | 'check-out', cookie = empCookie, body: Record<string, unknown> = {}) =>
    import('@/app/api/attendance/check-in/route').then(({ POST }) =>
      POST(
        authedRequest(`${BASE}/api/attendance/check-in`, { employee: cookie }, {
          method: 'POST',
          body: JSON.stringify({ employee_id: empId, action, ...body }),
        })
      )
    )

  const todayRow = async (id = empId) => {
    const { rows } = await pool.query(
      `SELECT check_in::text AS check_in, check_out::text AS check_out, status,
              work_hours::float8 AS work_hours, is_offsite, is_offsite_checkout
         FROM attendance WHERE employee_id = $1 AND date = $2`,
      [id, omanToday()]
    )
    return rows[0]
  }

  describe('check-in', () => {
    it('records a check-in for today', async () => {
      const res = await act('check-in')
      expect(res.status).toBe(200)

      const row = await todayRow()
      expect(row.status).toBe('present')
      expect(row.check_in).toBeTruthy()
    })

    it('refuses a second check-in the same day', async () => {
      await act('check-in')

      const second = await act('check-in')
      expect(second.status).toBe(409)
      expect((await second.json()).error).toBe('already_checked_in')
    })

    it('refuses an inactive employee', async () => {
      await pool.query('UPDATE employees SET is_active = false WHERE id = $1', [empId])
      // A deactivated employee's token is rejected outright by the auth layer.
      const res = await act('check-in')
      expect([401, 403]).toContain(res.status)
    })

    it('refuses an employee checking in for someone else', async () => {
      const res = await import('@/app/api/attendance/check-in/route').then(({ POST }) =>
        POST(
          authedRequest(`${BASE}/api/attendance/check-in`, { employee: empCookie }, {
            method: 'POST',
            body: JSON.stringify({ employee_id: otherId, action: 'check-in' }),
          })
        )
      )
      expect(res.status).toBe(403)
    })

    it('lets an admin check someone in', async () => {
      const res = await import('@/app/api/attendance/check-in/route').then(({ POST }) =>
        POST(
          authedRequest(`${BASE}/api/attendance/check-in`, { admin: adminCookie }, {
            method: 'POST',
            body: JSON.stringify({ employee_id: empId, action: 'check-in' }),
          })
        )
      )
      expect(res.status).toBe(200)
    })
  })

  describe('leave interaction', () => {
    const approvedLeave = async (start: string, end: string, days: number) => {
      const { rows: t } = await pool.query("SELECT id FROM leave_types WHERE name_en = 'Annual'")
      await pool.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
         VALUES ($1, $2, $3, $4, $5, 'approved')`,
        [empId, t[0].id, start, end, days]
      )
      await pool.query('UPDATE employees SET leave_balance = leave_balance - $1 WHERE id = $2', [days, empId])
    }

    it('cancels a one-day leave and refunds the day when the employee turns up', async () => {
      await approvedLeave(omanToday(), omanToday(), 1)
      const before = await balanceOf(empId)

      const res = await act('check-in')
      expect(res.status).toBe(200)
      expect((await res.json()).leaveCancelled).toBe(true)

      // The day is given back — they worked it.
      expect(await balanceOf(empId)).toBe(before + 1)
      const { rows } = await pool.query("SELECT status FROM leave_requests WHERE employee_id = $1", [empId])
      expect(rows[0].status).toBe('cancelled')
    })

    it('refunds only once even if check-in is retried', async () => {
      await approvedLeave(omanToday(), omanToday(), 1)
      const before = await balanceOf(empId)

      await act('check-in')
      await act('check-in') // second attempt is refused as already_checked_in

      expect(await balanceOf(empId)).toBe(before + 1)
    })

    it('blocks check-in during a multi-day leave instead of cancelling it', async () => {
      const today = omanToday()
      await approvedLeave(today, '2027-01-01', 5)
      const before = await balanceOf(empId)

      const res = await act('check-in')
      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe('on_leave')

      // Nothing was cancelled or refunded — an admin has to amend the leave first.
      expect(await balanceOf(empId)).toBe(before)
    })
  })

  describe('check-out', () => {
    const checkedInAt = (time: string) =>
      pool.query(
        `INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, $2, $3, 'present')`,
        [empId, omanToday(), time]
      )

    it('refuses a check-out with no check-in', async () => {
      const res = await act('check-out')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('not_checked_in')
    })

    it('records a check-out and computes the hours worked', async () => {
      await checkedInAt(shiftedTime(-2)) // two hours ago

      const res = await act('check-out')
      expect(res.status).toBe(200)

      const row = await todayRow()
      expect(row.check_out).toBeTruthy()
      expect(row.work_hours).toBeGreaterThan(1.9)
      expect(row.work_hours).toBeLessThan(2.1)
    })

    it('refuses a second check-out', async () => {
      await checkedInAt(shiftedTime(-2))
      await act('check-out')

      const second = await act('check-out')
      expect(second.status).toBe(409)
      expect((await second.json()).error).toBe('already_checked_out')
    })

    it('refuses an implausible span rather than inflating the hours', async () => {
      // Checked in "later" than now — the resulting span is negative or absurd.
      await checkedInAt(shiftedTime(1))

      const res = await act('check-out')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('check_out_before_check_in')
    })

    it('auto-closes an open permission on check-out', async () => {
      await checkedInAt(shiftedTime(-2))
      await pool.query(
        `INSERT INTO permissions (employee_id, date, leave_time, status) VALUES ($1, $2, '10:00', 'approved')`,
        [empId, omanToday()]
      )

      await act('check-out')

      const { rows } = await pool.query('SELECT return_time FROM permissions WHERE employee_id = $1', [empId])
      expect(rows[0].return_time).not.toBeNull()
    })

    it('subtracts permission time from the hours when that setting is on', async () => {
      await pool.query('UPDATE settings SET deduct_permission_hours = true')
      await checkedInAt(shiftedTime(-4))
      // A closed 1-hour permission earlier in the day.
      await pool.query(
        `INSERT INTO permissions (employee_id, date, leave_time, return_time, status)
         VALUES ($1, $2, '10:00', '11:00', 'approved')`,
        [empId, omanToday()]
      )

      await act('check-out')

      const row = await todayRow()
      // ~4h present minus 1h of permission.
      expect(row.work_hours).toBeGreaterThan(2.9)
      expect(row.work_hours).toBeLessThan(3.1)
    })
  })

  describe('geofence is record-only', () => {
    beforeEach(async () => {
      // Office in Muscat, tight radius.
      await pool.query(
        "UPDATE settings SET office_lat = 23.5880, office_lng = 58.3829, office_radius = 100"
      )
    })

    it('records an off-site check-in without blocking it', async () => {
      // Salalah — about 1000 km away.
      const res = await act('check-in', empCookie, { latitude: 17.0197, longitude: 54.0897 })

      expect(res.status).toBe(200) // never blocked: laptops have no GPS
      expect((await res.json()).isOffsite).toBe(true)
      expect((await todayRow()).is_offsite).toBe(true)
    })

    it('does not flag a check-in at the office', async () => {
      const res = await act('check-in', empCookie, { latitude: 23.5880, longitude: 58.3829 })
      expect((await res.json()).isOffsite).toBe(false)
      expect((await todayRow()).is_offsite).toBe(false)
    })

    it('flags an off-site check-out too', async () => {
      await act('check-in', empCookie, { latitude: 23.5880, longitude: 58.3829 })
      await pool.query("UPDATE attendance SET check_in = $1 WHERE employee_id = $2", [shiftedTime(-2), empId])

      await act('check-out', empCookie, { latitude: 17.0197, longitude: 54.0897 })

      expect((await todayRow()).is_offsite_checkout).toBe(true)
    })
  })
})
