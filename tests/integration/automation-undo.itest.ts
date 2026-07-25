import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { runDailyAutomation, runYearlyReset } from '@/lib/automation'
import { listRuns, reverseRun } from '@/lib/automation-journal'
import { HAS_TEST_DB, resetDb, balanceOf, closePool, ADMIN } from './helpers'

// The automation charges annual leave unattended. These tests are the safety net for the
// recovery path: after a bad run, an admin must be able to put every balance back exactly
// as it was — without a human's own edits being reverted along with the robot's.
describe.skipIf(!HAS_TEST_DB)('automation undo', () => {
  let employeeId: number

  beforeEach(async () => {
    const seeded = await resetDb()
    employeeId = seeded.employeeId
  })

  afterAll(async () => {
    await closePool()
  })

  // A completed day (strictly before today) that is a configured work day (Sun–Thu).
  function pastWorkingDay(): string {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  }

  const latestRunId = async (): Promise<number> => (await listRuns(1))[0].id

  it('undoing an absence run refunds the day and removes the absence', async () => {
    const date = pastWorkingDay()
    const before = await balanceOf(employeeId)

    await runDailyAutomation(date, ADMIN)
    expect(await balanceOf(employeeId)).toBe(before - 1)

    const outcome = await reverseRun(await latestRunId(), ADMIN)
    expect(outcome.ok).toBe(true)

    expect(await balanceOf(employeeId)).toBe(before)
    const { rows: att } = await pool.query('SELECT * FROM attendance WHERE employee_id = $1 AND date = $2', [employeeId, date])
    expect(att).toHaveLength(0)
    const { rows: lv } = await pool.query('SELECT * FROM leave_requests WHERE employee_id = $1', [employeeId])
    expect(lv).toHaveLength(0)
  })

  it('refuses to undo the same run twice', async () => {
    await runDailyAutomation(pastWorkingDay(), ADMIN)
    const runId = await latestRunId()
    const before = await balanceOf(employeeId)

    expect((await reverseRun(runId, ADMIN)).ok).toBe(true)
    const balanceAfterUndo = await balanceOf(employeeId)

    const second = await reverseRun(runId, ADMIN)
    expect(second.ok).toBe(false)
    expect(second.status).toBe(409)
    // Crucially, the second attempt must not refund a second time.
    expect(await balanceOf(employeeId)).toBe(balanceAfterUndo)
    expect(balanceAfterUndo).toBe(before + 1)
  })

  it('undoing tardiness refunds exactly what that row deducted', async () => {
    const date = pastWorkingDay()
    // Present but 90 minutes late against the 08:00 schedule.
    await pool.query(
      "INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, $2, '09:30', 'present')",
      [employeeId, date]
    )
    const before = await balanceOf(employeeId)

    await runDailyAutomation(date, ADMIN)
    const { rows: tardy } = await pool.query('SELECT leave_deducted FROM tardiness_log WHERE employee_id = $1', [employeeId])
    expect(tardy).toHaveLength(1)
    const charged = parseFloat(tardy[0].leave_deducted)
    expect(charged).toBeGreaterThan(0)
    expect(await balanceOf(employeeId)).toBeCloseTo(before - charged, 3)

    await reverseRun(await latestRunId(), ADMIN)

    expect(await balanceOf(employeeId)).toBeCloseTo(before, 3)
    const { rows: after } = await pool.query('SELECT * FROM tardiness_log WHERE employee_id = $1', [employeeId])
    expect(after).toHaveLength(0)
  })

  it('undoing an auto check-out restores the row to open', async () => {
    const date = pastWorkingDay()
    await pool.query(
      "INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, $2, '08:00', 'present')",
      [employeeId, date]
    )

    await runDailyAutomation(date, ADMIN)
    const { rows: closed } = await pool.query(
      'SELECT check_out::text AS check_out, notes FROM attendance WHERE employee_id = $1 AND date = $2',
      [employeeId, date]
    )
    expect(closed[0].check_out).not.toBeNull()
    expect(closed[0].notes).toContain('[Auto checkout]')

    await reverseRun(await latestRunId(), ADMIN)

    const { rows: reopened } = await pool.query(
      'SELECT check_out, work_hours, notes FROM attendance WHERE employee_id = $1 AND date = $2',
      [employeeId, date]
    )
    expect(reopened[0].check_out).toBeNull()
    // The '[Auto checkout]' note the run appended is gone too.
    expect(reopened[0].notes ?? '').not.toContain('[Auto checkout]')
  })

  it('does not delete an absence row a human has since edited', async () => {
    const date = pastWorkingDay()
    await runDailyAutomation(date, ADMIN)

    // An admin corrects the record: the person was actually here.
    await pool.query(
      "UPDATE attendance SET status = 'present', check_in = '08:05' WHERE employee_id = $1 AND date = $2",
      [employeeId, date]
    )

    await reverseRun(await latestRunId(), ADMIN)

    // Undoing the robot must not undo the human.
    const { rows } = await pool.query(
      'SELECT status, check_in::text AS check_in FROM attendance WHERE employee_id = $1 AND date = $2',
      [employeeId, date]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('present')
    expect(rows[0].check_in).toBe('08:05:00')
  })

  it('undoing a yearly reset restores balances and the fiscal year', async () => {
    // Spend some balance so the reset has something to overwrite.
    await pool.query('UPDATE employees SET leave_balance = 12.5 WHERE id = $1', [employeeId])
    const { rows: before } = await pool.query('SELECT year_start::text AS ys, year_end::text AS ye FROM settings ORDER BY id LIMIT 1')

    const reset = await runYearlyReset(ADMIN, { force: true })
    expect(reset.success).toBe(true)
    expect(await balanceOf(employeeId)).toBe(30)

    await reverseRun(await latestRunId(), ADMIN)

    expect(await balanceOf(employeeId)).toBe(12.5)
    const { rows: after } = await pool.query('SELECT year_start::text AS ys, year_end::text AS ye, last_reset_year FROM settings ORDER BY id LIMIT 1')
    expect(after[0].ys).toBe(before[0].ys)
    expect(after[0].ye).toBe(before[0].ye)
    // The reset guard is rolled back too, so the year can legitimately be reset again.
    expect(after[0].last_reset_year).toBeNull()
  })

  it('records a run with its effect count and marks it undone', async () => {
    await runDailyAutomation(pastWorkingDay(), ADMIN)

    const [run] = await listRuns(1)
    expect(run.kind).toBe('daily')
    expect(run.effect_count).toBeGreaterThan(0)
    expect(run.reversed_at).toBeNull()

    await reverseRun(run.id, ADMIN)

    const [afterUndo] = await listRuns(1)
    expect(afterUndo.reversed_at).not.toBeNull()
    expect(afterUndo.reversed_by).toBe(ADMIN.username)
  })

  it('a re-run after an undo behaves like a fresh run', async () => {
    const date = pastWorkingDay()
    const before = await balanceOf(employeeId)

    await runDailyAutomation(date, ADMIN)
    await reverseRun(await latestRunId(), ADMIN)
    await runDailyAutomation(date, ADMIN)

    // Exactly one day charged overall — the undo genuinely cleared the way.
    expect(await balanceOf(employeeId)).toBe(before - 1)
  })
})
