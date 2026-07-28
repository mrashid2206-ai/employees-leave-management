import pool, { omanToday, omanYesterday } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/log'
import { TARDINESS_GRACE_MINUTES, TARDINESS_DEDUCTS_LEAVE, TARDINESS_PENALTY_GRACE_MINUTES } from '@/lib/constants'
import { tardinessLeaveDeduction } from '@/lib/tardiness-penalty'
import { notifyEmployee } from '@/lib/employee-notify'
import { actorLabel, type Actor as ActorType } from '@/server/result'
import { computeWorkHours, computeOvertime, isNonWorkingWeekday } from '@/lib/attendance-calc'
import { resolveScheduleMap, globalSchedule, scheduleEndTime } from '@/lib/schedule'
import { startRun, recordEffect, finishRun } from '@/lib/automation-journal'
import { applyAutoAbsenceLeave } from '@/lib/auto-absence'

// Single shared Actor shape (see src/server/result.ts) so services, routes and the
// automation jobs all describe "who did this" the same way.
export type { Actor } from '@/server/result'

export interface DailyResult {
  success: true
  absentMarked: number
  leaveDeducted: number
  tardinessCreated: number
  missingCheckout: number
  date: string
  permissionsClosed: number
}

// Mark absentees, auto-deduct leave, log tardiness, close stale permissions for a day.
// Idempotent: safe to run repeatedly for the same date (ON CONFLICT + NOT EXISTS guards).
export async function runDailyAutomation(date: string | undefined, actor: ActorType): Promise<DailyResult> {
  // Default to the previous COMPLETED day. Absence-marking only runs for days strictly
  // before today, so an in-progress day (where people haven't checked in yet) can never
  // flag everyone absent.
  const processDate = date || omanYesterday()
  const dayIsComplete = processDate < omanToday()

  // Journal every mutation so a misfiring run can be undone from the UI.
  const runId = await startRun('daily', processDate, actor)

  const results = {
    absentMarked: 0,
    leaveDeducted: 0,
    tardinessCreated: 0,
    missingCheckout: 0,
    date: processDate,
  }

  const { rows: employees } = await pool.query('SELECT id FROM employees WHERE is_active = true')

  const { rows: onLeave } = await pool.query(
    `SELECT DISTINCT employee_id FROM leave_requests
     WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1`,
    [processDate]
  )
  const onLeaveIds = new Set(onLeave.map(r => r.employee_id))

  const { rows: attended } = await pool.query(
    'SELECT employee_id, check_in, check_out, excused_tardiness FROM attendance WHERE date = $1',
    [processDate]
  )
  const attendedMap = new Map(attended.map(r => [r.employee_id, { check_in: r.check_in, check_out: r.check_out, excused: r.excused_tardiness }]))

  const { rows: holidays } = await pool.query('SELECT id FROM holidays WHERE date = $1', [processDate])
  const isHoliday = holidays.length > 0

  // Each employee's effective schedule (employee -> department -> global). Working days,
  // start time and day length can all differ, so every per-person decision below —
  // "is this their weekend?", "were they late?", "when does their day end?" — uses theirs.
  const schedules = await resolveScheduleMap()
  const fallbackSchedule = await globalSchedule()
  const scheduleFor = (id: number) => schedules.get(id) ?? fallbackSchedule

  if (!isHoliday) {
    for (const emp of employees) {
      const schedule = scheduleFor(emp.id)
      const workStartMinutes = schedule.workStartMinutes
      const workHoursDay = schedule.workHoursPerDay
      // Not a working day for THIS employee — nothing to mark or charge.
      if (isNonWorkingWeekday(schedule.workDays, processDate)) continue

      if (attendedMap.has(emp.id) && attendedMap.get(emp.id)?.check_in) {
        // present — only tardiness below
      } else if (onLeaveIds.has(emp.id)) {
        continue
      }

      if (!attendedMap.has(emp.id) && dayIsComplete) {
        const marked = await pool.query(`
          INSERT INTO attendance (employee_id, date, status)
          VALUES ($1, $2, 'absent')
          ON CONFLICT (employee_id, date) DO NOTHING
          RETURNING id
        `, [emp.id, processDate])
        results.absentMarked++
        // Only journal rows this run actually created — ON CONFLICT means a pre-existing
        // row was left alone, and undoing the run must not delete it.
        if ((marked.rowCount || 0) > 0) {
          await recordEffect(runId, 'absence_marked', emp.id, { date: processDate })
        }

        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          // Shared with the admin attendance routes so every path that marks a day
          // 'absent' charges the day the same way (src/lib/auto-absence.ts).
          const applied = await applyAutoAbsenceLeave(client, emp.id, processDate)
          if (applied) {
            results.leaveDeducted++
            // Inside the same transaction as the deduction, so the journal can never
            // disagree with the balance it is meant to be able to refund.
            await recordEffect(runId, 'absence_leave', emp.id, { leave_id: applied.leaveId, days: applied.days }, client)
          }
          await client.query('COMMIT')
          if (applied) {
            await notifyEmployee(
              emp.id,
              `You were marked absent on ${processDate}; 1 day was deducted from your leave balance.`,
              `تم تسجيلك غائباً بتاريخ ${processDate} وتم خصم يوم واحد من رصيد إجازتك.`
            )
          }
        } catch (err) {
          await client.query('ROLLBACK')
          logger.error('daily auto-absence deduction failed', err, { employeeId: emp.id, date: processDate })
        } finally {
          client.release()
        }
      } else {
        const record = attendedMap.get(emp.id)
        if (record?.check_in && !record.excused) {
          const [h, m] = record.check_in.split(':').map(Number)
          const minutesLate = (h * 60 + m) - workStartMinutes
          if (minutesLate > TARDINESS_GRACE_MINUTES) {
            const { rows: existing } = await pool.query(
              'SELECT id FROM tardiness_log WHERE employee_id = $1 AND date = $2',
              [emp.id, processDate]
            )
            if (existing.length === 0) {
              const deduction = TARDINESS_DEDUCTS_LEAVE ? tardinessLeaveDeduction(minutesLate, workHoursDay, TARDINESS_PENALTY_GRACE_MINUTES) : 0
              const tc = await pool.connect()
              try {
                await tc.query('BEGIN')
                const tardyRow = await tc.query(`
                  INSERT INTO tardiness_log (employee_id, date, time, minutes_late, notes, leave_deducted)
                  VALUES ($1, $2, $3, $4, 'Auto-generated from attendance', $5)
                  RETURNING id
                `, [emp.id, processDate, record.check_in, minutesLate, deduction])
                if (deduction > 0) {
                  await tc.query('UPDATE employees SET leave_balance = leave_balance - $1 WHERE id = $2', [deduction, emp.id])
                }
                await recordEffect(
                  runId, 'tardiness_created', emp.id,
                  { tardiness_id: tardyRow.rows[0].id, leave_deducted: deduction },
                  tc
                )
                await tc.query('COMMIT')
                results.tardinessCreated++
                await notifyEmployee(
                  emp.id,
                  `Late arrival recorded for ${processDate}: ${minutesLate} min late${deduction > 0 ? `; ${deduction} day deducted from your leave balance.` : ' (within grace — no deduction).'}`,
                  `تم تسجيل تأخير بتاريخ ${processDate}: ${minutesLate} دقيقة${deduction > 0 ? `؛ تم خصم ${deduction} يوم من رصيد إجازتك.` : ' (ضمن فترة السماح — بدون خصم).'}`
                )
              } catch (err) {
                await tc.query('ROLLBACK')
                logger.error('auto-tardiness deduction failed', err, { employeeId: emp.id, date: processDate })
              } finally {
                tc.release()
              }
            }
          }
        }
      }

    }
  }

  // Auto-close forgotten check-outs on ALL completed days — including the historical
  // backlog from before this feature existed, so old '0 hours' days heal themselves on
  // the next run. Idempotent (only rows with check_out IS NULL match) and never touches
  // today: people may still be working.
  const { rows: openCheckouts } = await pool.query(
    `SELECT employee_id, date::text as date, check_in::text as check_in, is_holiday_work,
            work_hours, overtime_hours, notes
       FROM attendance
      WHERE check_in IS NOT NULL AND check_out IS NULL AND date < $1`,
    [omanToday()]
  )
  for (const o of openCheckouts) {
    // Close at the end of THAT employee's working day, not a single global time.
    const oSchedule = scheduleFor(o.employee_id)
    const oEndTime = scheduleEndTime(oSchedule)
    const autoHours = computeWorkHours(o.check_in, oEndTime)
    if (autoHours !== null) {
      const autoOvertime = computeOvertime(autoHours, oSchedule.workHoursPerDay, !!o.is_holiday_work)
      const closed = await pool.query(
        `UPDATE attendance SET check_out = $1, work_hours = $2, overtime_hours = $3,
           notes = COALESCE(notes, '') || ' [Auto checkout]'
         WHERE employee_id = $4 AND date = $5 AND check_out IS NULL`,
        [oEndTime, autoHours, autoOvertime, o.employee_id, o.date]
      )
      if ((closed.rowCount || 0) > 0) {
        // Keep the prior values verbatim so an undo restores the row exactly, including
        // the notes we appended '[Auto checkout]' to.
        await recordEffect(runId, 'auto_checkout', o.employee_id, {
          date: o.date,
          check_out: oEndTime,
          prev_work_hours: o.work_hours,
          prev_overtime: o.overtime_hours,
          prev_notes: o.notes,
        })
      }
      await notifyEmployee(
        o.employee_id,
        `You forgot to check out on ${o.date}; your check-out was auto-recorded at ${oEndTime.slice(0, 5)}. Contact admin if this is wrong.`,
        `نسيت تسجيل الانصراف بتاريخ ${o.date}؛ تم تسجيل انصرافك تلقائياً الساعة ${oEndTime.slice(0, 5)}. تواصل مع المدير إذا كان ذلك غير صحيح.`
      )
      results.missingCheckout++
    } else {
      // Implausible span (e.g. checked in after end-of-day) — flag once for admin review.
      await pool.query(
        `UPDATE attendance SET notes = COALESCE(notes, '') || ' [Missing checkout]'
         WHERE employee_id = $1 AND date = $2 AND check_out IS NULL
           AND COALESCE(notes, '') NOT LIKE '%[Missing checkout]%'`,
        [o.employee_id, o.date]
      )
    }
  }

  // Close permissions the employee forgot to return from, at their own end-of-day.
  let permissionsClosed = 0
  try {
    const { rows: openPerms } = await pool.query(
      `SELECT id, employee_id FROM permissions
        WHERE date = $1 AND return_time IS NULL AND status = 'approved'`,
      [processDate]
    )
    for (const p of openPerms) {
      const closeAt = scheduleEndTime(scheduleFor(p.employee_id))
      await pool.query('UPDATE permissions SET return_time = $1 WHERE id = $2', [closeAt, p.id])
      await recordEffect(runId, 'permission_closed', p.employee_id, {
        permission_id: p.id,
        return_time: closeAt,
        prev_return_time: null,
      })
      permissionsClosed++
    }
  } catch {} // Table might not exist yet

  await logAudit('daily_process', actorLabel(actor), actor.role, `Daily process (${processDate}): ${results.absentMarked} absent, ${results.tardinessCreated} tardiness, ${results.missingCheckout} missing checkout, ${permissionsClosed} permissions auto-closed`)

  await finishRun(runId, { ...results, permissionsClosed })

  return { success: true, ...results, permissionsClosed }
}

export type YearlyResult =
  | { success: true; employeesReset: number; newBalance: number; newYearStart: string; newYearEnd: string }
  | { success: false; alreadyReset?: boolean; notDue?: boolean; message: string }

// Reset balances + advance the fiscal year. Idempotent via last_reset_year.
// When not forced (cron), it only fires once the fiscal year has actually ended,
// so it is safe to call daily — it no-ops every day until year_end passes.
export async function runYearlyReset(actor: ActorType, opts: { force?: boolean } = {}): Promise<YearlyResult> {

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: settings } = await client.query(
      "SELECT id, year_start::text as year_start, year_end::text as year_end, annual_leave_balance, last_reset_year, to_char(last_reset_at, 'YYYY-MM-DD') as last_reset_day FROM settings ORDER BY id LIMIT 1 FOR UPDATE"
    )
    if (settings.length === 0) {
      await client.query('ROLLBACK')
      return { success: false, message: 'No settings' }
    }
    const s = settings[0]
    const fromYear = new Date(`${s.year_start}T00:00:00Z`).getUTCFullYear()

    // Cron path: only run once the fiscal year has actually ended.
    if (!opts.force && omanToday() <= s.year_end) {
      await client.query('ROLLBACK')
      return { success: false, notDue: true, message: `Fiscal year ends ${s.year_end}; not due yet.` }
    }

    // Idempotency, two ways. (a) never reset the same fiscal year twice; (b) never reset
    // twice in one day — needed because a successful reset ADVANCES the fiscal year, so an
    // immediate second run sees a different fromYear and would otherwise slip past (a) and
    // double-advance.
    if (s.last_reset_year === fromYear) {
      await client.query('ROLLBACK')
      return { success: false, alreadyReset: true, message: `Fiscal year starting ${s.year_start} has already been reset.` }
    }
    if (s.last_reset_day && s.last_reset_day === new Date().toISOString().split('T')[0]) {
      await client.query('ROLLBACK')
      return { success: false, alreadyReset: true, message: 'A yearly reset has already run today.' }
    }

    // Journal every prior balance BEFORE overwriting it. A reset is a clean slate — the
    // old balances are gone the moment this UPDATE lands — so this snapshot is the only
    // way back if the reset fires on the wrong day.
    const runId = await startRun('yearly', s.year_end, actor)
    const { rows: priorBalances } = await client.query(
      'SELECT id, leave_balance FROM employees WHERE is_active = true'
    )
    for (const b of priorBalances) {
      await recordEffect(runId, 'yearly_balance', b.id, { prev_balance: b.leave_balance }, client)
    }
    await recordEffect(runId, 'yearly_settings', null, {
      settings_id: s.id,
      prev_year_start: s.year_start,
      prev_year_end: s.year_end,
      prev_last_reset_year: s.last_reset_year,
      prev_last_reset_at: s.last_reset_day,
    }, client)

    const { rowCount } = await client.query(
      'UPDATE employees SET leave_balance = $1, updated_at = NOW() WHERE is_active = true',
      [s.annual_leave_balance]
    )

    const ys = new Date(`${s.year_start}T00:00:00Z`)
    const ye = new Date(`${s.year_end}T00:00:00Z`)
    ys.setUTCFullYear(ys.getUTCFullYear() + 1)
    ye.setUTCFullYear(ye.getUTCFullYear() + 1)
    const newYearStart = ys.toISOString().split('T')[0]
    const newYearEnd = ye.toISOString().split('T')[0]

    await client.query(
      'UPDATE settings SET year_start = $1, year_end = $2, last_reset_year = $3, last_reset_at = NOW() WHERE id = $4',
      [newYearStart, newYearEnd, fromYear, s.id]
    )

    await client.query('COMMIT')

    await logAudit('yearly_reset', actorLabel(actor), actor.role, `Yearly reset: ${rowCount} employees, fiscal year ${s.year_start} → ${newYearStart}`)

    await finishRun(runId, {
      employeesReset: rowCount || 0,
      newBalance: s.annual_leave_balance,
      fromYearStart: s.year_start,
      newYearStart,
      newYearEnd,
    })

    return { success: true, employeesReset: rowCount || 0, newBalance: s.annual_leave_balance, newYearStart, newYearEnd }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
