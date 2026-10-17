import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { id } = await params

  if (user.role === 'employee' && String(user.id) !== id) return forbidden()
  const { rows } = await pool.query(`
    SELECT lr.id, lr.employee_id, lr.leave_type_id,
      lr.start_date::text as start_date, lr.end_date::text as end_date,
      lr.days_count::float8 as days_count, lr.notes, lr.status, lr.created_at, lr.updated_at,
      (SELECT COUNT(*)::int FROM leave_attachments la WHERE la.leave_request_id = lr.id) as attachment_count,
      lr.reviewed_by, lr.reviewed_at, lr.decision_note,
      json_build_object('id', lt.id, 'name_ar', lt.name_ar, 'name_en', lt.name_en, 'color', lt.color) as leave_type
    FROM leave_requests lr
    LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
    WHERE lr.employee_id = $1
    ORDER BY lr.start_date DESC
  `, [id])
  return NextResponse.json(rows)
}
