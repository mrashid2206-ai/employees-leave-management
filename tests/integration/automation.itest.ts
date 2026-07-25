import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { runDailyAutomation, runYearlyReset } from '@/lib/automation'
import { HAS_TEST_DB, resetDb, balanceOf, closePool, ADMIN } from './helpers'

// Cron safety depends entirely on these jobs being idempotent: the scheduler may retry,
// overlap, or be triggered manually on the same day. Running twice must never
// double-charge an employee or double-advance the fiscal year.
describe.skipIf(!HAS_TEST_DB)('automation idempotency', () => {
  let employeeId: number

  beforeEach(async () => {
    const seeded = await resetDb()
    employeeId = seeded.employeeId
  })

  afterAll(async () => {
    await closePool()
  })

  // A completed day (strictly before today) that falls on a configured work day (Sun–Thu).
  function pastWorkingDay(): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    while (![0, 1, 2, 3, 4].includes(d.getUTCDay())) {
      d.setUTCDate(d.getUTCDate() - 1)
    }
    return d.toISOString().split('T')[0]
  }

  it('marks an absentee once and deducts exactly one day, even when run twice', async () => {
    const day = pastWorkingDay()

    const first = await runDailyAutomation(day, ADMIN)
    expect(first.absentMarked).toBe(1)
    expect(first.leaveDeducted).toBe(1)
    expect(await balanceOf(employeeId)).toBe(29)

    // Second run: the attendance row already exists, so nothing is charged again.
    await runDailyAutomation(day, ADMIN)
    expect(await balanceOf(employeeId)).toBe(29)

    const { rows: att } = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM attendance WHERE employee_id = $1 AND date = $2 AND status = 'absent'",
      [employeeId, day]
    )
    expect(att[0].cnt).toBe(1)

    const { rows: auto } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM leave_requests WHERE employee_id = $1 AND start_date = $2',
      [employeeId, day]
    )
    expect(auto[0].cnt).toBe(1)
  })

  it('never marks an in-progress (today) day absent', async () => {
    const today = new Date().toISOString().split('T')[0]
    const res = await runDailyAutomation(today, ADMIN)
    expect(res.absentMarked).toBe(0)
    expect(await balanceOf(employeeId)).toBe(30)
  })

  it('does not charge an employee who is on approved leave that day', async () => {
    const day = pastWorkingDay()
    await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
       VALUES ($1, 1, $2, $2, 1, 'approved')`,
      [employeeId, day]
    )
    const before = await balanceOf(employeeId)
    const res = await runDailyAutomation(day, ADMIN)
    expect(res.absentMarked).toBe(0)
    expect(await balanceOf(employeeId)).toBe(before)
  })

  it('auto-closes a forgotten check-out on a completed day', async () => {
    const day = pastWorkingDay()
    await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, $2, '08:00', 'present')`,
      [employeeId, day]
    )
    await runDailyAutomation(day, ADMIN)

    const { rows } = await pool.query(
      'SELECT check_out::text AS check_out, work_hours FROM attendance WHERE employee_id = $1 AND date = $2',
      [employeeId, day]
    )
    expect(rows[0].check_out).not.toBeNull()
    expect(parseFloat(rows[0].work_hours)).toBeGreaterThan(0)
  })

  it('yearly reset runs once and refuses a second run for the same fiscal year', async () => {
    await pool.query('UPDATE employees SET leave_balance = 12 WHERE id = $1', [employeeId])

    const first = await runYearlyReset(ADMIN, { force: true })
    expect(first.success).toBe(true)
    expect(await balanceOf(employeeId)).toBe(30)

    const { rows: afterFirst } = await pool.query('SELECT year_start::text AS ys FROM settings ORDER BY id LIMIT 1')

    const second = await runYearlyReset(ADMIN, { force: true })
    expect(second.success).toBe(false)

    const { rows: afterSecond } = await pool.query('SELECT year_start::text AS ys FROM settings ORDER BY id LIMIT 1')
    expect(afterSecond[0].ys).toBe(afterFirst[0].ys) // fiscal year not double-advanced
  })
})
