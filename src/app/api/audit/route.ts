import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

// The audit log used to return a bare `SELECT * ... LIMIT 100` with no filters, so the
// page's action dropdown was filtering a window of the 100 most recent rows and quietly
// showing nothing for anything older. Filtering now happens in SQL across the whole table,
// and the response reports the true total so the UI can never imply it is showing
// everything when it is not.

const PAGE_MAX = 200
const EXPORT_MAX = 5000

export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const p = new URL(request.url).searchParams
  const isExport = p.get('export') === '1'

  const conditions: string[] = []
  const params: (string | number)[] = []
  // Returns the placeholder ($1, $2, ...) for a newly bound value.
  const bind = (value: string | number): string => {
    params.push(value)
    return `$${params.length}`
  }

  const action = p.get('action')
  if (action && action !== 'all') conditions.push(`action = ${bind(action)}`)

  const role = p.get('role')
  if (role && role !== 'all') conditions.push(`user_role = ${bind(role)}`)

  const user = p.get('user')
  if (user) conditions.push(`user_id ILIKE ${bind(`%${user}%`)}`)

  // Free-text across the human-readable part of the entry. Bound once, referenced twice.
  const q = p.get('q')
  if (q) {
    const ph = bind(`%${q}%`)
    conditions.push(`(details ILIKE ${ph} OR action ILIKE ${ph})`)
  }

  // Dates are inclusive; `to` covers the whole of that day.
  const from = p.get('from')
  if (from) conditions.push(`created_at >= ${bind(from)}::date`)
  const to = p.get('to')
  if (to) conditions.push(`created_at < (${bind(to)}::date + INTERVAL '1 day')`)

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_log${where}`,
    params
  )
  const total: number = countRows[0].total

  const requestedLimit = Number(p.get('limit'))
  const cap = isExport ? EXPORT_MAX : PAGE_MAX
  const limit = Math.min(cap, Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : cap)
  const offsetRaw = Number(p.get('offset'))
  const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0

  const { rows } = await pool.query(
    `SELECT id, action, user_id, user_role, details, created_at
       FROM audit_log${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )

  // The filter dropdowns must offer every value in the table, not just the ones that
  // happen to appear on this page.
  const { rows: actionRows } = await pool.query(
    'SELECT DISTINCT action FROM audit_log ORDER BY action'
  )
  const { rows: roleRows } = await pool.query(
    'SELECT DISTINCT user_role FROM audit_log WHERE user_role IS NOT NULL ORDER BY user_role'
  )

  return NextResponse.json({
    rows,
    total,
    limit,
    offset,
    // True when the response is a partial view of the matching rows, so the UI can say so
    // rather than presenting a silent truncation as the full result.
    truncated: offset + rows.length < total,
    actions: actionRows.map(r => r.action),
    roles: roleRows.map(r => r.user_role),
  })
}
