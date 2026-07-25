import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'
import { omanToday } from '@/lib/db'
import { forecastLeave } from '@/lib/leave-forecast'

// Where an employee's balance is heading before the clean-slate yearly reset.
// Employees may only see their own; admins may look at anyone's.

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const requested = new URL(request.url).searchParams.get('employee_id')

  // Check the REQUESTED id, before it gets coerced to the caller's own. Comparing after
  // coercion made this guard unreachable: an employee asking for a colleague's forecast
  // quietly received their own with a 200 instead of being refused.
  if (user.role === 'employee' && requested && Number(requested) !== Number(user.id)) {
    return forbidden()
  }

  const employeeId = user.role === 'employee' ? Number(user.id) : Number(requested || user.id)
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: 'employee_id is required' }, { status: 400 })
  }

  const { rows: empRows } = await pool.query(
    'SELECT id, name, leave_balance FROM employees WHERE id = $1',
    [employeeId]
  )
  if (empRows.length === 0) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  const { rows: settingsRows } = await pool.query(
    'SELECT year_start::text as year_start, year_end::text as year_end, annual_leave_balance FROM settings ORDER BY id LIMIT 1'
  )
  const settings = settingsRows[0]
  if (!settings) return NextResponse.json({ error: 'Settings not configured' }, { status: 500 })

  const today = omanToday()

  // Approved-but-not-yet-taken days are already deducted from leave_balance; they are
  // reported for context only. Pending days are the ones still to come off.
  const { rows: leaveRows } = await pool.query(
    `SELECT
       COALESCE(SUM(days_count) FILTER (WHERE status = 'approved' AND end_date >= $2), 0)::float8 AS approved_upcoming,
       COALESCE(SUM(days_count) FILTER (WHERE status = 'pending'), 0)::float8 AS pending
     FROM leave_requests
     WHERE employee_id = $1 AND start_date >= $3 AND start_date <= $4`,
    [employeeId, today, settings.year_start, settings.year_end]
  )

  const { rows: tardyRows } = await pool.query(
    `SELECT COALESCE(SUM(leave_deducted), 0)::float8 AS ytd
       FROM tardiness_log
      WHERE employee_id = $1 AND date >= $2 AND date <= $3`,
    [employeeId, settings.year_start, today]
  )

  const forecast = forecastLeave({
    currentBalance: parseFloat(empRows[0].leave_balance),
    approvedUpcomingDays: leaveRows[0].approved_upcoming,
    pendingDays: leaveRows[0].pending,
    tardinessDeductedYtd: tardyRows[0].ytd,
    fiscalYearStart: settings.year_start,
    fiscalYearEnd: settings.year_end,
    today,
  })

  return NextResponse.json({
    employee: { id: empRows[0].id, name: empRows[0].name },
    fiscalYearStart: settings.year_start,
    fiscalYearEnd: settings.year_end,
    annualAllowance: parseFloat(settings.annual_leave_balance),
    ...forecast,
  })
}
