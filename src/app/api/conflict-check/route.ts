import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { employee_id, start_date, end_date, exclude_request_id } = await request.json()

  // Get employee's department
  const empResult = await pool.query('SELECT department_id FROM employees WHERE id = $1', [employee_id])
  if (empResult.rows.length === 0) return NextResponse.json({ conflict: false, message: '', absentCount: 0 })

  const deptId = empResult.rows[0].department_id

  // Get max_absent_same_dept setting
  const settingsResult = await pool.query('SELECT max_absent_same_dept FROM settings LIMIT 1')
  const maxAbsent = settingsResult.rows[0]?.max_absent_same_dept || 2

  // Count overlapping leaves from same department for each day in range
  let query = `
    SELECT COUNT(DISTINCT lr.employee_id) as cnt
    FROM leave_requests lr
    JOIN employees e ON lr.employee_id = e.id
    WHERE e.department_id = $1
    AND lr.status = 'approved'
    AND lr.start_date <= $2
    AND lr.end_date >= $3
  `
  const params: any[] = [deptId, end_date, start_date]

  if (exclude_request_id) {
    query += ` AND lr.id != $4`
    params.push(exclude_request_id)
  }

  const { rows } = await pool.query(query, params)
  const count = parseInt(rows[0].cnt)

  const conflict = count >= maxAbsent
  return NextResponse.json({
    conflict,
    message: conflict
      ? `تجاوز الحد (${count + 1}/${maxAbsent})`
      : `مسموح (${count + 1}/${maxAbsent})`,
    absentCount: count + 1
  })
}
