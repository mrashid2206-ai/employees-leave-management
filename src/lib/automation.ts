import pool, { omanToday, omanYesterday } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/log'
import { ensureFractionalLeaveColumns, ensureSettingsColumns, ensureTardinessPenaltyColumns } from '@/lib/ensure-schema'
import { LEAVE_TYPE_ANNUAL, TARDINESS_GRACE_MINUTES, AUTO_ABSENCE_LEAVE_NOTE, TARDINESS_DEDUCTS_LEAVE, TARDINESS_PENALTY_GRACE_MINUTES } from '@/lib/constants'
import { tardinessLeaveDeduction } from '@/lib/tardiness-penalty'
import { notifyEmployee } from '@/lib/employee-notify'
import { computeWorkHours, computeOvertime } from '@/lib/attendance-calc'

export interface Actor {
  id: string
  role: string
}

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
export async function runDailyAutomation(date: string | undefined, actor: Actor): Promise<DailyResult> {
  // Default to the previous COMPLETED day. Absence-marking only runs for days strictly
  // before today, so an in-progress day (where people haven't checked in yet) can never
  // flag everyone absent.
  const processDate = date || omanYesterday()
  const dayIsComplete = processDate < omanToday()

  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_tardiness_unique ON tardiness_log (employee_id, date)').catch(() => {})
  await ensureFractionalLeaveColumns().catch(() => {})
  await ensureTardinessPenaltyColumns().catch(() => {})

  const { rows: annualType } = await pool.query(
    'SELECT id FROM leave_types WHERE name_en = $1 ORDER BY id LIMIT 1',
    [LEAVE_TYPE_ANNUAL]
  )
  const annualLeaveTypeId = annualType[0]?.id || 1

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

  const { rows: settingsRows } = await pool.query('SELECT work_days, work_start_time::text as work_start_time, work_hours_per_day FROM settings ORDER BY id LIMIT 1')
  const workDays = settingsRows[0]?.work_days?.split(',').map(Number) || [0, 1, 2, 3, 4]
  const workStartTime = settingsRows[0]?.work_start_time || '08:00'
  const [startH, startM] = workStartTime.split(':').map(Number)
  const workStartMinutes = startH * 60 + startM
  const workHoursDay = settingsRows[0]?.work_hours_per_day || 8
  // Official end of day = start + work hours (previously hardcoded a :30 end minute,
  // which was only correct for a 07:30 start).
  const endTotalMinutes = workStartMinutes + workHoursDay * 60
  const workEndTime = `${String(Math.floor(endTotalMinutes / 60) % 24).padStart(2, '0')}:${String(endTotalMinutes % 60).padStart(2, '0')}:00`

  const dayOfWeek = new Date(`${processDate}T00:00:00Z`).getUTCDay()
  const isWeekend = !workDays.includes(dayOfWeek)

  if (!isHoliday && !isWeekend) {
    for (const emp of employees) {
      if (attendedMap.has(emp.id) && attendedMap.get(emp.id)?.check_in) {
        // present — only tardiness below
      } else if (onLeaveIds.has(emp.id)) {
        continue
      }

      if (!attendedMap.has(emp.id) && dayIsComplete) {
        await pool.query(`
          INSERT INTO attendance (employee_id, date, status)
          VALUES ($1, $2, 'absent')
          ON CONFLICT (employee_id, date) DO NOTHING
        `, [emp.id, processDate])
        results.absentMarked++

        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const { rows: empBalance } = await client.query('SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE', [emp.id])
          const balance = parseFloat(empBalance[0]?.leave_balance ?? '0')
          const inserted = await client.query(`
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status)
            SELECT $1, $2, $3, $3, 1, $5, 'approved'
            WHERE $4 > 0
              AND NOT EXISTS (SELECT 1 FROM leave_requests WHERE employee_id = $1 AND start_date = $3 AND end_date = $3)
            RETURNING id
          `, [emp.id, annualLeaveTypeId, processDate, balance, AUTO_ABSENCE_LEAVE_NOTE])
          if ((inserted.rowCount || 0) > 0) {
            await client.query('UPDATE employees SET leave_balance = leave_balance - 1 WHERE id = $1', [emp.id])
            results.leaveDeducted++
          }
          await client.query('COMMIT')
          if ((inserted.rowCount || 0) > 0) {
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
              const hoursDecimal = Math.round((minutesLate / 60) * 100000) / 100000
              const deduction = TARDINESS_DEDUCTS_LEAVE ? tardinessLeaveDeduction(minutesLate, workHoursDay, TARDINESS_PENALTY_GRACE_MINUTES) : 0
              const tc = await pool.connect()
              try {
                await tc.query('BEGIN')
                await tc.query(`
                  INSERT INTO tardiness_log (employee_id, date, time, minutes_late, hours_late_decimal, notes, leave_deducted)
                  VALUES ($1, $2, $3, $4, $5, 'Auto-generated from attendance', $6)
                `, [emp.id, processDate, record.check_in, minutesLate, hoursDecimal, deduction])
                if (deduction > 0) {
                  await tc.query('UPDATE employees SET leave_balance = leave_balance - $1 WHERE id = $2', [deduction, emp.id])
                }
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

      // Forgotten check-out on a COMPLETED day: auto-close at the official end-of-day
      // time so the employee doesn't silently lose the day's hours, flagged for review.
      // (Never auto-close an in-progress day — people may still be working.)
      if (dayIsComplete && attendedMap.has(emp.id)) {
        const record = attendedMap.get(emp.id)
        if (record?.check_in && !record.check_out) {
          const autoHours = computeWorkHours(String(record.check_in), workEndTime)
          if (autoHours !== null) {
            const autoOvertime = computeOvertime(autoHours, workHoursDay, false)
            await pool.query(
              `UPDATE attendance SET check_out = $1, work_hours = $2, overtime_hours = $3,
                 notes = COALESCE(notes, '') || ' [Auto checkout]'
               WHERE employee_id = $4 AND date = $5 AND check_out IS NULL`,
              [workEndTime, autoHours, autoOvertime, emp.id, processDate]
            )
            await notifyEmployee(
              emp.id,
              `You forgot to check out on ${processDate}; your check-out was auto-recorded at ${workEndTime.slice(0, 5)}. Contact admin if this is wrong.`,
              `نسيت تسجيل الانصراف بتاريخ ${processDate}؛ تم تسجيل انصرافك تلقائياً الساعة ${workEndTime.slice(0, 5)}. تواصل مع المدير إذا كان ذلك غير صحيح.`
            )
          } else {
            // Implausible span (e.g. checked in after end-of-day) — just flag for admin.
            await pool.query(
              "UPDATE attendance SET notes = COALESCE(notes, '') || ' [Missing checkout]' WHERE employee_id = $1 AND date = $2 AND check_out IS NULL",
              [emp.id, processDate]
            )
          }
          results.missingCheckout++
        }
      }
    }
  }

  let permissionsClosed = 0
  try {
    const { rowCount } = await pool.query(
      `UPDATE permissions SET return_time = $2 WHERE date = $1 AND return_time IS NULL AND status = 'approved'`,
      [processDate, workEndTime]
    )
    permissionsClosed = rowCount || 0
  } catch {} // Table might not exist yet

  await logAudit('daily_process', actor.id, actor.role, `Daily process (${processDate}): ${results.absentMarked} absent, ${results.tardinessCreated} tardiness, ${results.missingCheckout} missing checkout, ${permissionsClosed} permissions auto-closed`)

  return { success: true, ...results, permissionsClosed }
}

export type YearlyResult =
  | { success: true; employeesReset: number; newBalance: number; newYearStart: string; newYearEnd: string }
  | { success: false; alreadyReset?: boolean; notDue?: boolean; message: string }

// Reset balances + advance the fiscal year. Idempotent via last_reset_year.
// When not forced (cron), it only fires once the fiscal year has actually ended,
// so it is safe to call daily — it no-ops every day until year_end passes.
export async function runYearlyReset(actor: Actor, opts: { force?: boolean } = {}): Promise<YearlyResult> {
  await ensureSettingsColumns().catch(() => {})

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: settings } = await client.query(
      'SELECT id, year_start::text as year_start, year_end::text as year_end, annual_leave_balance, last_reset_year FROM settings ORDER BY id LIMIT 1 FOR UPDATE'
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

    // Idempotency: never reset/advance the same fiscal year twice.
    if (s.last_reset_year === fromYear) {
      await client.query('ROLLBACK')
      return { success: false, alreadyReset: true, message: `Fiscal year starting ${s.year_start} has already been reset.` }
    }

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
      'UPDATE settings SET year_start = $1, year_end = $2, last_reset_year = $3 WHERE id = $4',
      [newYearStart, newYearEnd, fromYear, s.id]
    )

    await client.query('COMMIT')

    await logAudit('yearly_reset', actor.id, actor.role, `Yearly reset: ${rowCount} employees, fiscal year ${s.year_start} → ${newYearStart}`)

    return { success: true, employeesReset: rowCount || 0, newBalance: s.annual_leave_balance, newYearStart, newYearEnd }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
