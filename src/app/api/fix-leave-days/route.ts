import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const results: string[] = []

  try {
    // 1. Recalculate all leave days_count to calendar days
    const { rows: allLeaves } = await pool.query(
      "SELECT id, employee_id, start_date::text as start_date, end_date::text as end_date, days_count, status FROM leave_requests"
    )
    let leavesFixed = 0
    for (const leave of allLeaves) {
      const [sy, sm, sd] = leave.start_date.split('-').map(Number)
      const [ey, em, ed] = leave.end_date.split('-').map(Number)
      const calendarDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1

      if (calendarDays !== parseFloat(leave.days_count)) {
        await pool.query('UPDATE leave_requests SET days_count = $1 WHERE id = $2', [calendarDays, leave.id])
        results.push(`Leave #${leave.id}: ${leave.days_count}→${calendarDays} (${leave.start_date} to ${leave.end_date})`)
        leavesFixed++
      }
    }
    results.push(`Leaves fixed: ${leavesFixed}`)

    // 2. Recalculate all employee balances from approved leaves
    const { rows: settings } = await pool.query('SELECT annual_leave_balance FROM settings LIMIT 1')
    const annualBalance = settings[0]?.annual_leave_balance || 30

    const { rows: employees } = await pool.query('SELECT id, leave_balance FROM employees')
    let balancesFixed = 0
    for (const emp of employees) {
      const { rows } = await pool.query(
        "SELECT COALESCE(SUM(days_count), 0)::numeric as total FROM leave_requests WHERE employee_id = $1 AND status = 'approved'",
        [emp.id]
      )
      const used = parseFloat(rows[0].total)
      const correct = annualBalance - used
      if (emp.leave_balance !== correct) {
        await pool.query('UPDATE employees SET leave_balance = $1 WHERE id = $2', [correct, emp.id])
        results.push(`Emp ${emp.id}: balance ${emp.leave_balance}→${correct} (used: ${used})`)
        balancesFixed++
      }
    }
    results.push(`Balances fixed: ${balancesFixed}`)

    return NextResponse.json({ success: true, fixes: results })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, completedSteps: results }, { status: 500 })
  }
}
