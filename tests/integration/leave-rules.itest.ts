import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { createLeave } from '@/server/services/leave-service'
import {
  EMERGENCY_LEAVE_MAX_DAYS, SICK_LEAVE_NOTES_THRESHOLD, MAX_CONSECUTIVE_LEAVE_DAYS,
} from '@/lib/constants'
import { HAS_TEST_DB, resetDb, addEmployee, closePool, ADMIN } from './helpers'

// The rules that decide whether a leave request is allowed at all. Every one of them was
// previously untested, which is how three separate balance bugs reached production
// unnoticed. These assert the REFUSALS — the paths that protect entitlement — not just
// the happy path.
describe.skipIf(!HAS_TEST_DB)('leave request rules', () => {
  let empId: number
  let annualId: number
  let sickId: number
  let emergencyId: number

  const EMPLOYEE = (id: number) => ({ role: 'employee' as const, id, username: 'test.employee' })

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    annualId = seeded.annualTypeId
    const { rows } = await pool.query('SELECT id, name_en FROM leave_types')
    sickId = rows.find(r => r.name_en === 'Sick').id
    emergencyId = rows.find(r => r.name_en === 'Emergency').id
  })

  afterAll(async () => {
    await closePool()
  })

  const create = (over: Partial<Parameters<typeof createLeave>[0]> = {}, actor = ADMIN) =>
    createLeave(
      {
        employee_id: empId,
        leave_type_id: annualId,
        start_date: '2026-09-01',
        end_date: '2026-09-03',
        status: 'approved',
        ...over,
      },
      actor
    )

  describe('date validity', () => {
    it('refuses an end date before the start date', async () => {
      const res = await create({ start_date: '2026-09-10', end_date: '2026-09-01' })
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(400)
    })

    it('refuses dates outside the fiscal year', async () => {
      // resetDb configures 2020-01-01 → 2030-12-31.
      const res = await create({ start_date: '2031-01-01', end_date: '2031-01-02' })
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(400)
    })

    it('refuses past dates for an employee but allows them for an admin', async () => {
      const past = { start_date: '2021-01-04', end_date: '2021-01-05' }
      expect((await create(past, EMPLOYEE(empId))).ok).toBe(false)
      expect((await create(past)).ok).toBe(true) // admin may backdate
    })
  })

  describe('leave-type limits', () => {
    it(`caps emergency leave at ${EMERGENCY_LEAVE_MAX_DAYS} days per year`, async () => {
      const first = await create({
        leave_type_id: emergencyId,
        start_date: '2026-09-01',
        end_date: `2026-09-0${EMERGENCY_LEAVE_MAX_DAYS}`,
      })
      expect(first.ok).toBe(true)

      const overCap = await create({
        leave_type_id: emergencyId,
        start_date: '2026-10-01',
        end_date: '2026-10-01',
      })
      expect(overCap.ok).toBe(false)
      expect(!overCap.ok && overCap.body.error).toContain('Emergency leave limit')
    })

    it('counts PENDING emergency days toward the cap, not just approved', async () => {
      await create({
        leave_type_id: emergencyId,
        start_date: '2026-09-01',
        end_date: `2026-09-0${EMERGENCY_LEAVE_MAX_DAYS}`,
        status: 'pending',
      })
      const res = await create({ leave_type_id: emergencyId, start_date: '2026-10-01', end_date: '2026-10-01' })
      expect(res.ok).toBe(false)
    })

    it(`requires notes for sick leave over ${SICK_LEAVE_NOTES_THRESHOLD} days`, async () => {
      const withoutNotes = await create({
        leave_type_id: sickId,
        start_date: '2026-09-01',
        end_date: '2026-09-06', // 6 days
      })
      expect(withoutNotes.ok).toBe(false)
      expect(!withoutNotes.ok && withoutNotes.body.error).toContain('notes')

      const withNotes = await create({
        leave_type_id: sickId,
        start_date: '2026-09-01',
        end_date: '2026-09-06',
        notes: 'medical certificate #123',
      })
      expect(withNotes.ok).toBe(true)
    })

    it('allows short sick leave without notes', async () => {
      const res = await create({ leave_type_id: sickId, start_date: '2026-09-01', end_date: '2026-09-02' })
      expect(res.ok).toBe(true)
    })

    it(`refuses more than ${MAX_CONSECUTIVE_LEAVE_DAYS} consecutive days`, async () => {
      const res = await create({ start_date: '2026-09-01', end_date: '2026-10-15' }) // 45 days
      expect(res.ok).toBe(false)
      expect(!res.ok && res.body.error).toContain('Maximum consecutive')
    })
  })

  describe('conflicts', () => {
    it('refuses a request overlapping an existing one', async () => {
      expect((await create({ start_date: '2026-09-01', end_date: '2026-09-05' })).ok).toBe(true)

      const overlap = await create({ start_date: '2026-09-04', end_date: '2026-09-08' })
      expect(overlap.ok).toBe(false)
      expect(!overlap.ok && overlap.status).toBe(409)
    })

    it('allows a request that merely touches the day after', async () => {
      expect((await create({ start_date: '2026-09-01', end_date: '2026-09-03' })).ok).toBe(true)
      expect((await create({ start_date: '2026-09-04', end_date: '2026-09-06' })).ok).toBe(true)
    })

    it('ignores a cancelled leave when checking overlap', async () => {
      const first = await create({ start_date: '2026-09-01', end_date: '2026-09-05' })
      const id = (first as { data: { id: number } }).data.id
      await pool.query("UPDATE leave_requests SET status = 'cancelled' WHERE id = $1", [id])

      expect((await create({ start_date: '2026-09-01', end_date: '2026-09-05' })).ok).toBe(true)
    })

    it('refuses leave on a day the employee actually worked', async () => {
      await pool.query(
        "INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, '2026-09-02', '08:00', 'present')",
        [empId]
      )
      const res = await create({ start_date: '2026-09-01', end_date: '2026-09-03' })
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(409)
      expect(!res.ok && res.body.error).toContain('attendance records')
    })
  })

  describe('department absence cap', () => {
    // resetDb sets max_absent_same_dept = 2 and puts everyone in department 1.
    beforeEach(async () => {
      const a = await addEmployee('Colleague A', 'colleague.a')
      const b = await addEmployee('Colleague B', 'colleague.b')
      for (const id of [a, b]) {
        await createLeave(
          { employee_id: id, leave_type_id: annualId, start_date: '2026-09-01', end_date: '2026-09-05', status: 'approved' },
          ADMIN
        )
      }
    })

    it('blocks an employee once the department is at its limit', async () => {
      const res = await create({ start_date: '2026-09-02', end_date: '2026-09-03' }, EMPLOYEE(empId))
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(409)
    })

    it('warns an admin rather than blocking, and honours force', async () => {
      // An admin must be able to override — the cap is guidance for them, not a wall.
      const forced = await create({ start_date: '2026-09-02', end_date: '2026-09-03', force: true })
      expect(forced.ok).toBe(true)
    })
  })

  describe('balance gate', () => {
    it('refuses an employee with no remaining balance', async () => {
      await pool.query('UPDATE employees SET leave_balance = 0 WHERE id = $1', [empId])
      const res = await create({}, EMPLOYEE(empId))
      expect(res.ok).toBe(false)
      expect(!res.ok && res.body.error).toContain('balance')
    })

    it('still allows an admin to record leave into a negative balance', async () => {
      await pool.query('UPDATE employees SET leave_balance = 0 WHERE id = $1', [empId])
      const res = await create()
      expect(res.ok).toBe(true)
    })
  })

  describe('day counting', () => {
    it('subtracts public holidays from the days charged', async () => {
      await pool.query("INSERT INTO holidays (name, date) VALUES ('Test Holiday', '2026-09-02')")
      const res = await create({ start_date: '2026-09-01', end_date: '2026-09-03' }) // 3 days - 1 holiday
      expect(res.ok).toBe(true)
      expect(parseFloat(String((res as { data: { days_count: string } }).data.days_count))).toBe(2)
    })

    it('records a same-day half day as 0.5', async () => {
      const res = await create({ start_date: '2026-09-01', end_date: '2026-09-01', is_half_day: true })
      expect(parseFloat(String((res as { data: { days_count: string } }).data.days_count))).toBe(0.5)
    })

    it('ignores the half-day flag on a multi-day request', async () => {
      const res = await create({ start_date: '2026-09-01', end_date: '2026-09-03', is_half_day: true })
      expect(parseFloat(String((res as { data: { days_count: string } }).data.days_count))).toBe(3)
    })
  })
})
