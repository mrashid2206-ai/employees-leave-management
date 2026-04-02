import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'

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

  await pool.query('DELETE FROM leave_requests WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
