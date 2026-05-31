import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { ensureFractionalLeaveColumns } from '@/lib/ensure-schema'
import { countLeaveDays } from '@/lib/leave-days'
import { LEAVE_TYPE_EMERGENCY, EMERGENCY_LEAVE_MAX_DAYS, MAX_CONSECUTIVE_LEAVE_DAYS } from '@/lib/constants'

// Edit leave request (admin only) — change dates, recalculate days, adjust balance.
// Mirrors the validation the create path enforces and runs in a single transaction
// with row locks so concurrent approve/edit/delete cannot corrupt the balance.
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

  await ensureFractionalLeaveColumns().catch(() => {})

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: cur } = await client.query('SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE', [id])
    if (cur.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const oldLeave = cur[0]
    const oldDays = parseFloat(oldLeave.days_count)

    // Fiscal-year bounds
    const { rows: settingsRows } = await client.query(
      'SELECT year_start::text as year_start, year_end::text as year_end FROM settings ORDER BY id LIMIT 1'
    )
    if (!settingsRows[0]) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'System settings are not configured' }, { status: 500 })
    }
    const { year_start, year_end } = settingsRows[0]
    if (start_date < year_start || end_date > year_end) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: `Leave dates must be within the fiscal year (${year_start} to ${year_end})` }, { status: 400 })
    }

    // Recompute days, honoring the original half-day intent for single-day leaves.
    const newDays = oldLeave.is_half_day && start_date === end_date
      ? 0.5
      : await countLeaveDays(start_date, end_date, client)
    if (newDays <= 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }
    if (newDays > MAX_CONSECUTIVE_LEAVE_DAYS) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: `Maximum consecutive leave is ${MAX_CONSECUTIVE_LEAVE_DAYS} days` }, { status: 400 })
    }

    // Overlap with the employee's other pending/approved leaves (exclude self)
    const { rows: overlap } = await client.query(
      "SELECT id FROM leave_requests WHERE employee_id = $1 AND id != $2 AND status IN ('pending', 'approved') AND start_date <= $3 AND end_date >= $4",
      [oldLeave.employee_id, id, end_date, start_date]
    )
    if (overlap.length > 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Overlaps another pending or approved leave for this employee' }, { status: 409 })
    }

    // Conflict with recorded attendance
    const { rows: att } = await client.query(
      "SELECT date::text as date FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3 AND status = 'present' AND check_in IS NOT NULL",
      [oldLeave.employee_id, start_date, end_date]
    )
    if (att.length > 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: `Employee has attendance records on: ${att.map(r => r.date).join(', ')}` }, { status: 409 })
    }

    // Emergency annual cap (dynamic type id, exclude self) — days-based, matches create
    const { rows: typeInfo } = await client.query('SELECT name_en FROM leave_types WHERE id = $1', [oldLeave.leave_type_id])
    if (typeInfo[0]?.name_en === LEAVE_TYPE_EMERGENCY) {
      const { rows: em } = await client.query(
        "SELECT COALESCE(SUM(days_count), 0)::numeric as total FROM leave_requests WHERE employee_id = $1 AND leave_type_id = $2 AND id != $3 AND status IN ('approved', 'pending') AND start_date >= $4 AND end_date <= $5",
        [oldLeave.employee_id, oldLeave.leave_type_id, id, year_start, year_end]
      )
      if (parseFloat(em[0].total) + newDays > EMERGENCY_LEAVE_MAX_DAYS) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: `Emergency leave limit would be exceeded (max ${EMERGENCY_LEAVE_MAX_DAYS} days/year)` }, { status: 400 })
      }
    }

    // Adjust balance only for approved leaves, with row lock + sufficiency check when lengthening.
    if (oldLeave.status === 'approved' && newDays !== oldDays) {
      const diff = oldDays - newDays // positive => days returned; negative => extra days consumed
      const { rows: emp } = await client.query('SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE', [oldLeave.employee_id])
      if (diff < 0 && emp[0] && parseFloat(emp[0].leave_balance) < -diff) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Insufficient leave balance for the extended dates' }, { status: 400 })
      }
      await client.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [diff, oldLeave.employee_id])
    }

    const { rows } = await client.query(
      'UPDATE leave_requests SET start_date = $1, end_date = $2, days_count = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [start_date, end_date, newDays, id]
    )

    await client.query('COMMIT')
    await logAudit('leave_edited', admin.username, 'admin', `Leave #${id} edited: ${oldLeave.start_date}→${start_date}, ${oldLeave.end_date}→${end_date}, days ${oldDays}→${newDays}`)
    return NextResponse.json(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query('SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE', [id])
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const leave = rows[0]

    // Employees may only cancel their own, still-pending requests.
    if (user.role === 'employee') {
      if (leave.employee_id !== user.id) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (leave.status !== 'pending') {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Only pending requests can be cancelled' }, { status: 400 })
      }
    }

    // Restore balance for an approved leave before deleting.
    if (leave.status === 'approved') {
      await client.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [leave.days_count, leave.employee_id])
    }

    await client.query('DELETE FROM leave_requests WHERE id = $1', [id])
    await client.query('COMMIT')

    await logAudit('leave_deleted', user.username || String(user.id), user.role, `Leave #${id} (${leave.status}) deleted for emp ${leave.employee_id}`)
    return NextResponse.json({ success: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
