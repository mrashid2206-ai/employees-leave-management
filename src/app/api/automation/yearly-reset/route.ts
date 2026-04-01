import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  // Get settings
  const { rows: settings } = await pool.query('SELECT * FROM settings LIMIT 1')
  if (settings.length === 0) return NextResponse.json({ error: 'No settings' }, { status: 400 })

  const { annual_leave_balance } = settings[0]

  // Reset all active employees' leave balance
  const { rowCount } = await pool.query(
    'UPDATE employees SET leave_balance = $1, updated_at = NOW() WHERE is_active = true',
    [annual_leave_balance]
  )

  // Update fiscal year dates (advance by 1 year)
  const yearStart = new Date(settings[0].year_start)
  const yearEnd = new Date(settings[0].year_end)
  yearStart.setFullYear(yearStart.getFullYear() + 1)
  yearEnd.setFullYear(yearEnd.getFullYear() + 1)

  await pool.query(
    'UPDATE settings SET year_start = $1, year_end = $2 WHERE id = 1',
    [yearStart.toISOString().split('T')[0], yearEnd.toISOString().split('T')[0]]
  )

  return NextResponse.json({
    success: true,
    employeesReset: rowCount,
    newBalance: annual_leave_balance,
    newYearStart: yearStart.toISOString().split('T')[0],
    newYearEnd: yearEnd.toISOString().split('T')[0],
  })
}
