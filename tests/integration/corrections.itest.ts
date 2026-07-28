import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { createCorrection, reviewCorrection } from '@/server/services/correction-service'
import { HAS_TEST_DB, resetDb, addEmployee, closePool, ADMIN } from './helpers'

// Attendance corrections were completely untested despite being the riskiest write in the
// system: approving one REWRITES an attendance row and recomputes work hours and overtime
// — the same data the automation, the reports and the payroll-adjacent figures read.
describe.skipIf(!HAS_TEST_DB)('attendance corrections', () => {
  let empId: number
  let otherId: number

  const EMPLOYEE = (id: number) => ({ role: 'employee' as const, id, username: 'test.employee' })
  const DATE = '2026-06-10'

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    otherId = await addEmployee()
  })

  afterAll(async () => {
    await closePool()
  })

  const file = (over = {}, actor = EMPLOYEE(0)) =>
    createCorrection(
      {
        employee_id: empId,
        date: DATE,
        requested_check_in: '08:00',
        requested_check_out: '16:00',
        reason: 'Forgot to check in',
        ...over,
      },
      actor.id === 0 ? EMPLOYEE(empId) : actor
    )

  const attendanceRow = async () => {
    const { rows } = await pool.query(
      `SELECT check_in::text AS check_in, check_out::text AS check_out,
              work_hours::float8 AS work_hours, overtime_hours::float8 AS overtime_hours,
              status, notes
         FROM attendance WHERE employee_id = $1 AND date = $2`,
      [empId, DATE]
    )
    return rows[0]
  }

  describe('filing', () => {
    it('an employee can file for themselves', async () => {
      const res = await file()
      expect(res.ok).toBe(true)
    })

    it('an employee cannot file for someone else', async () => {
      const res = await file({ employee_id: otherId })
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(403)
    })

    it('requires at least one corrected time', async () => {
      const res = await file({ requested_check_in: null, requested_check_out: null })
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(400)
    })

    it('allows correcting only the check-out', async () => {
      const res = await file({ requested_check_in: null })
      expect(res.ok).toBe(true)
    })

    it('refuses a second pending request for the same day', async () => {
      expect((await file()).ok).toBe(true)

      const duplicate = await file()
      expect(duplicate.ok).toBe(false)
      expect(!duplicate.ok && duplicate.status).toBe(409)
    })

    it('allows a new request once the previous one is resolved', async () => {
      const first = await file()
      await reviewCorrection(String((first as { data: { id: number } }).data.id), 'rejected', ADMIN)

      expect((await file()).ok).toBe(true)
    })
  })

  describe('reviewing', () => {
    const fileThen = async (status: 'approved' | 'rejected', over = {}) => {
      const created = await file(over)
      const id = String((created as { data: { id: number } }).data.id)
      return { id, result: await reviewCorrection(id, status, ADMIN) }
    }

    it('approving writes the corrected times and computes hours', async () => {
      const { result } = await fileThen('approved')
      expect(result.ok).toBe(true)

      const row = await attendanceRow()
      expect(row.check_in).toBe('08:00:00')
      expect(row.check_out).toBe('16:00:00')
      expect(row.work_hours).toBe(8)
      expect(row.status).toBe('present')
      expect(row.notes).toContain('[Corrected]')
    })

    it('computes overtime beyond the working day', async () => {
      // 08:00–19:00 is 11h against an 8h day.
      const { result } = await fileThen('approved', { requested_check_out: '19:00' })
      expect(result.ok).toBe(true)

      const row = await attendanceRow()
      expect(row.work_hours).toBe(11)
      expect(row.overtime_hours).toBe(3)
    })

    it('rejecting leaves attendance untouched', async () => {
      await fileThen('rejected')
      expect(await attendanceRow()).toBeUndefined()
    })

    it('merges with an existing attendance row rather than discarding it', async () => {
      await pool.query(
        "INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, $2, '09:15', 'present')",
        [empId, DATE]
      )
      // Correct only the missing check-out; the recorded check-in must survive.
      await fileThen('approved', { requested_check_in: null, requested_check_out: '17:00' })

      const row = await attendanceRow()
      expect(row.check_in).toBe('09:15:00')
      expect(row.check_out).toBe('17:00:00')
    })

    it('refuses to review the same request twice', async () => {
      const { id } = await fileThen('approved')

      const second = await reviewCorrection(id, 'rejected', ADMIN)
      expect(second.ok).toBe(false)
      expect(!second.ok && second.status).toBe(400)
    })

    it('returns 404 for a request that does not exist', async () => {
      const res = await reviewCorrection('999999', 'approved', ADMIN)
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(404)
    })

    it('records the reviewer and writes an audit entry', async () => {
      const { id } = await fileThen('approved')

      const { rows } = await pool.query('SELECT status, reviewed_by FROM attendance_corrections WHERE id = $1', [id])
      expect(rows[0].status).toBe('approved')
      expect(rows[0].reviewed_by).toBeTruthy()

      const { rows: audit } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'attendance_correction'"
      )
      expect(audit[0].n).toBe(1)
    })

    it('notifies the employee of the outcome', async () => {
      await fileThen('approved')
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM employee_notifications WHERE employee_id = $1',
        [empId]
      )
      expect(rows[0].n).toBeGreaterThan(0)
    })
  })
})
