import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params

  await pool.query('DELETE FROM admin_users WHERE id = $1', [id])
  await logAudit('admin_user_deleted', admin.username, 'admin', `Deleted admin user ID: ${id}`)
  return NextResponse.json({ success: true })
}
