import { NextResponse } from 'next/server'
import pool, { omanToday } from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'

// Edit leave request (admin only) — change dates, recalculate days, adjust balance
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const { start_date, end_date } = await request.json()

  if (!start_date || !end_date) {
    return NextResponse.json({ error: 'Start and end date required' }, { status: 400 })
  }
  if (new Date(end_date) < new Date(start_date)) {
    return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
  }

  // Get current leave
  const { rows: current } = await pool.query('SELECT * FROM leave_requests WHERE id = $1', [id])
  if (current.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const oldLeave = current[0]
  const oldDays = oldLeave.days_count

  // Calculate calendar days (weekends included — company policy), minus public holidays
  const [sy, sm, sd] = start_date.split('-').map(Number)
  const [ey, em, ed] = end_date.split('-').map(Number)
  const calendarDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1

  // Subtract holidays in range
  const { rows: editHolidays } = await pool.query(
    'SELECT COUNT(*) as cnt FROM holidays WHERE date >= $1 AND date <= $2',
    [start_date, end_date]
  )
  const editHolidayCount = parseInt(editHolidays[0]?.cnt || '0')
  const newDays = Math.max(1, calendarDays - editHolidayCount)

  if (newDays <= 0) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  // Update leave
  const { rows } = await pool.query(
    'UPDATE leave_requests SET start_date = $1, end_date = $2, days_count = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
    [start_date, end_date, newDays, id]
  )

  // Adjust balance if leave was approved (difference between old and new days)
  if (oldLeave.status === 'approved' && newDays !== parseFloat(oldDays)) {
    const diff = parseFloat(oldDays) - newDays // positive = days returned to employee
    if (diff !== 0) {
      await pool.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [diff, oldLeave.employee_id])
    }
  }

  await logAudit('leave_edited', admin.username, 'admin', `Leave #${id} edited: ${oldLeave.start_date}→${start_date}, ${oldLeave.end_date}→${end_date}, days ${oldDays}→${newDays}`)

  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params

  // If employee (not admin), verify the leave belongs to them and is pending
  if (user.role === 'employee') {
    const { rows } = await pool.query('SELECT * FROM leave_requests WHERE id = $1', [id])
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (rows[0].employee_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (rows[0].status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be cancelled' }, { status: 400 })
  }

  // If approved, restore balance before deleting
  const { rows: leaveToDelete } = await pool.query('SELECT * FROM leave_requests WHERE id = $1', [id])
  if (leaveToDelete.length > 0 && leaveToDelete[0].status === 'approved') {
    await pool.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [leaveToDelete[0].days_count, leaveToDelete[0].employee_id])
  }

  await pool.query('DELETE FROM leave_requests WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
