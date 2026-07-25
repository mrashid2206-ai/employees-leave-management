import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { correctionCreateSchema } from '@/server/schemas'
import { respond } from '@/server/result'
import { createCorrection } from '@/server/services/correction-service'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()


  // Employees only ever see their own requests; admins see the whole queue.
  const scoped = user.role === 'employee'
  const { rows } = await pool.query(
    `SELECT c.id, c.employee_id, c.date::text as date,
            c.requested_check_in::text as requested_check_in,
            c.requested_check_out::text as requested_check_out,
            c.reason, c.status, c.reviewed_by, c.created_at,
            json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee
       FROM attendance_corrections c
       LEFT JOIN employees e ON c.employee_id = e.id
      ${scoped ? 'WHERE c.employee_id = $1' : ''}
      ORDER BY (c.status = 'pending') DESC, c.date DESC, c.id DESC`,
    scoped ? [user.id] : []
  )
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const valid = parseBody(correctionCreateSchema, await request.json())
  if (!valid.ok) return valid.response

  return respond(await createCorrection(valid.data, user))
}
