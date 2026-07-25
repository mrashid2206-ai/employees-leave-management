import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { tardinessLeaveDeduction } from '@/lib/tardiness-penalty'
import { TARDINESS_DEDUCTS_LEAVE, TARDINESS_PENALTY_GRACE_MINUTES } from '@/lib/constants'
import { logger } from '@/lib/log'
import { notifyEmployee } from '@/lib/employee-notify'
import { parseBody } from '@/server/validation'
import { tardinessCreateSchema } from '@/server/schemas'
import { resolveSchedule } from '@/lib/schedule'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()


  // Employees may only read their own tardiness; admins see all.
  const scoped = user.role === 'employee'
  const { rows } = await pool.query(`
    SELECT t.id, t.employee_id, t.date::text as date, t.time::text as time,
      t.minutes_late, t.hours_late_decimal, COALESCE(t.leave_deducted, 0)::float8 as leave_deducted, t.notes, t.created_at, t.updated_at,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee
    FROM tardiness_log t
    LEFT JOIN employees e ON t.employee_id = e.id
    ${scoped ? 'WHERE t.employee_id = $1' : ''}
    ORDER BY t.date DESC, t.id DESC
  `, scoped ? [user.id] : [])
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  // Supports bulk insert (array of records) or a single record.
  const valid = parseBody(tardinessCreateSchema, await request.json())
  if (!valid.ok) return valid.response
  const records = Array.isArray(valid.data) ? valid.data : [valid.data]


  // Insert each record and deduct the proportional leave penalty in one transaction so a
  // failure can't leave a tardiness row without its matching balance deduction (or vice
  // versa). leave_deducted is stored per row so a later delete refunds exactly that much.
  const client = await pool.connect()
  const inserted: unknown[] = []
  const skipped: number[] = []
  const toNotify: { employee_id: number; date: string; minutes_late: number; deduction: number }[] = []
  try {
    await client.query('BEGIN')
    for (const r of records) {
      // Recompute lateness against THIS employee's schedule — a bulk add can cover people
      // with different start times, so a single client-side figure would be wrong.
      const schedule = await resolveSchedule(r.employee_id)
      const [h, m] = r.time.split(':').map(Number)
      const minutesLate = h * 60 + m - schedule.workStartMinutes
      if (minutesLate <= 0) {
        skipped.push(r.employee_id) // arrived on time on their own schedule
        continue
      }

      const hoursLateDecimal = Math.round((minutesLate / 60) * 100000) / 100000
      const deduction = TARDINESS_DEDUCTS_LEAVE
        ? tardinessLeaveDeduction(minutesLate, schedule.workHoursPerDay, TARDINESS_PENALTY_GRACE_MINUTES)
        : 0
      const { rows } = await client.query(
        `INSERT INTO tardiness_log (employee_id, date, time, minutes_late, hours_late_decimal, notes, leave_deducted)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [r.employee_id, r.date, r.time, minutesLate, hoursLateDecimal, r.notes || null, deduction]
      )
      if (deduction > 0) {
        // Allow negative balance (penalty is never lost) per policy.
        await client.query('UPDATE employees SET leave_balance = leave_balance - $1, updated_at = NOW() WHERE id = $2', [deduction, r.employee_id])
      }
      inserted.push(rows[0])
      toNotify.push({ employee_id: r.employee_id, date: r.date, minutes_late: minutesLate, deduction })
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    logger.error('tardiness insert/deduction failed', err)
    return NextResponse.json({ error: 'Failed to record tardiness' }, { status: 500 })
  } finally {
    client.release()
  }

  // Tell each employee (best-effort, after commit) so the deduction isn't a surprise.
  for (const n of toNotify) {
    await notifyEmployee(
      n.employee_id,
      `Late arrival recorded for ${n.date}: ${n.minutes_late} min late${n.deduction > 0 ? `; ${n.deduction} day deducted from your leave balance.` : ' (within grace — no deduction).'}`,
      `تم تسجيل تأخير بتاريخ ${n.date}: ${n.minutes_late} دقيقة${n.deduction > 0 ? `؛ تم خصم ${n.deduction} يوم من رصيد إجازتك.` : ' (ضمن فترة السماح — بدون خصم).'}`
    )
  }

  // Response stays a plain array (unchanged client contract). Employees who turned out to
  // be on time for their OWN schedule are simply absent from it — the UI compares counts.
  if (skipped.length > 0) {
    logger.info('tardiness: skipped on-time employees', { skipped: skipped.length })
  }
  return NextResponse.json(inserted)
}
