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

  // Calculate new working days
  const { rows: settingsRows } = await pool.query('SELECT work_days FROM settings LIMIT 1')
  const workDays = settingsRows[0]?.work_days?.split(',').map(Number) || [0,1,2,3,4]
  const { rows: holidays } = await pool.query('SELECT date::text as date FROM holidays WHERE date >= $1 AND date <= $2', [start_date, end_date])
  const holidaySet = new Set(holidays.map((h: any) => h.date))

  const [sy, sm, sd] = start_date.split('-').map(Number)
  const [ey, em, ed] = end_date.split('-').map(Number)
  const startMs = Date.UTC(sy, sm - 1, sd)
  const endMs = Date.UTC(ey, em - 1, ed)
  let newDays = 0
  for (let ms = startMs; ms <= endMs; ms += 86400000) {
    const d = new Date(ms)
    const dayOfWeek = d.getUTCDay()
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dy = String(d.getUTCDate()).padStart(2, '0')
    const dateStr = `${d.getUTCFullYear()}-${mo}-${dy}`
    if (workDays.includes(dayOfWeek) && !holidaySet.has(dateStr)) {
      newDays++
    }
  }

  if (newDays <= 0) {
    return NextResponse.json({ error: 'No working days in selected range' }, { status: 400 })
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
