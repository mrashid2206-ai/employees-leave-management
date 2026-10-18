import { NextResponse } from 'next/server'
import pool, { omanToday, omanTime } from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'
import { parseBody, parseDateParam, parseDateRange, rangeConditions } from '@/server/validation'
import { permissionCreateSchema } from '@/server/schemas'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { searchParams } = new URL(request.url)
  const employeeId = searchParams.get('employee_id')
  const date = parseDateParam(searchParams, 'date')
  if (!date.ok) return date.response
  const range = parseDateRange(searchParams)
  if (!range.ok) return range.response

  // date as text: a bare DATE column reaches the client as a timestamp
  // ("2026-06-01T00:00:00.000Z"), which never equals the YYYY-MM-DD every page compares it
  // with, so "today's permissions" and the portal's open permission were never found.
  let query = `SELECT p.id, p.employee_id, p.date::text AS date, p.leave_time, p.return_time, p.reason,
      p.status, p.approved_by, p.reviewed_at, p.decision_note, p.created_at,
      json_build_object('id', e.id, 'name', e.name) as employee
    FROM permissions p LEFT JOIN employees e ON p.employee_id = e.id`
  const conditions: string[] = []
  const params: unknown[] = []

  if (employeeId) {
    params.push(employeeId)
    conditions.push(`p.employee_id = $${params.length}`)
  }
  if (date.data) {
    params.push(date.data)
    conditions.push(`p.date = $${params.length}`)
  }
  conditions.push(...rangeConditions('p.date', range.data, params))

  // Employees can only see their own
  if (user.role === 'employee') {
    params.push(user.id as number)
    conditions.push(`p.employee_id = $${params.length}`)
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
  query += ' ORDER BY p.created_at DESC'

  const { rows } = await pool.query(query, params)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const valid = parseBody(permissionCreateSchema, await request.json())
  if (!valid.ok) return valid.response
  const { employee_id, reason } = valid.data

  // Employees can only create for themselves
  if (user.role === 'employee' && user.id !== employee_id) return forbidden()

  // "I'm leaving now" is stamped here, in Oman time. The portal used to send the phone's
  // own clock, so a wrong or foreign-zone device recorded a leave time hours off — and
  // that time feeds the paid-hours deduction. Employees can't choose it; an admin
  // recording a permission after the fact may still give the date and time explicitly.
  const stampNow = user.role === 'employee'
  const date = stampNow ? omanToday() : (valid.data.date ?? omanToday())
  const leave_time = stampNow ? omanTime() : (valid.data.leave_time ?? omanTime())

  // Monthly cap. Employees are held to it; admins are not, consistent with every other
  // limit in the system (the cap is guidance for an admin, not a wall). 0 = unlimited.
  if (user.role === 'employee') {
    const { rows: cfg } = await pool.query(
      'SELECT max_permissions_per_month FROM settings ORDER BY id LIMIT 1'
    )
    const cap = cfg[0]?.max_permissions_per_month ?? 0
    if (cap > 0) {
      const { rows: used } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM permissions
          WHERE employee_id = $1 AND status <> 'rejected'
            AND date_trunc('month', date) = date_trunc('month', $2::date)`,
        [employee_id, date]
      )
      if (used[0].n >= cap) {
        return NextResponse.json(
          { error: `Monthly permission limit reached (${cap} per month) / تم بلوغ الحد الشهري للاستئذان` },
          { status: 409 }
        )
      }
    }
  }

  const status = user.role === 'admin' ? 'approved' : 'pending'

  // An admin recording a permission is also deciding it, so it carries the same trace as
  // one approved from the queue.
  const isAdmin = user.role === 'admin'
  const { rows } = await pool.query(
    `INSERT INTO permissions (employee_id, date, leave_time, reason, status, approved_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN NOW() END) RETURNING *`,
    [employee_id, date, leave_time, reason || null, status, isAdmin ? user.username : null, isAdmin]
  )

  return NextResponse.json(rows[0])
}
