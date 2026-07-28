import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { permissionCreateSchema } from '@/server/schemas'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { searchParams } = new URL(request.url)
  const employeeId = searchParams.get('employee_id')
  const date = searchParams.get('date')

  let query = 'SELECT p.*, json_build_object(\'id\', e.id, \'name\', e.name) as employee FROM permissions p LEFT JOIN employees e ON p.employee_id = e.id'
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (employeeId) {
    params.push(employeeId)
    conditions.push(`p.employee_id = $${params.length}`)
  }
  if (date) {
    params.push(date)
    conditions.push(`p.date = $${params.length}`)
  }

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
  const { employee_id, date, leave_time, reason } = valid.data

  // Required fields and their formats are enforced by permissionCreateSchema above.

  // Employees can only create for themselves
  if (user.role === 'employee' && user.id !== employee_id) return forbidden()

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

  const { rows } = await pool.query(
    'INSERT INTO permissions (employee_id, date, leave_time, reason, status, approved_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [employee_id, date, leave_time, reason || null, status, user.role === 'admin' ? user.username : null]
  )

  return NextResponse.json(rows[0])
}
