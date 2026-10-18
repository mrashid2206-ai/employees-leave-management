import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, verifyEmployee, unauthorized, forbidden } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const empId = user.role === 'employee' ? user.id : new URL(request.url).searchParams.get('employee_id')
  if (user.role === 'employee' && String(user.id) !== String(empId)) return forbidden()

  const { rows } = await pool.query(
    'SELECT * FROM employee_notifications WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 20',
    [empId]
  )
  return NextResponse.json(rows)
}

// Admin sends notifications to employees
export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  // Only admin can send notifications
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { employee_ids, message, message_ar } = await request.json()

  if (!employee_ids || !message) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const ids = Array.isArray(employee_ids) ? employee_ids : [employee_ids]
  for (const empId of ids) {
    await pool.query(
      'INSERT INTO employee_notifications (employee_id, message, message_ar) VALUES ($1, $2, $3)',
      [empId, message, message_ar || null]
    )
  }

  return NextResponse.json({ success: true, sent: ids.length })
}

// Mark one notification ({ id }) or all of them ({ all: true }) as read. Employee-only:
// read state belongs to the person the notification is addressed to, and an admin token
// carries no employee id to scope the update by.
export async function PUT(request: Request) {
  const user = await verifyEmployee(request)
  if (!user || user.id == null) return unauthorized()

  const body = await request.json().catch(() => null)
  if (body?.all === true) {
    // Every unread row, not just the 20 the bell lists, so the badge actually clears.
    const { rowCount } = await pool.query(
      'UPDATE employee_notifications SET is_read = true WHERE employee_id = $1 AND is_read = false',
      [user.id]
    )
    return NextResponse.json({ success: true, updated: rowCount ?? 0 })
  }

  const id = Number(body?.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  await pool.query(
    'UPDATE employee_notifications SET is_read = true WHERE id = $1 AND employee_id = $2',
    [id, user.id]
  )
  return NextResponse.json({ success: true })
}
