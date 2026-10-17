import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { respond } from '@/server/result'
import { createAdminUser } from '@/server/services/admin-user-service'

export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  // is_self lets the UI hide the delete button on the caller's own row (the API refuses it anyway).
  const { rows } = await pool.query(
    'SELECT id, username, name, role, is_active, created_at, username = $1 AS is_self FROM admin_users ORDER BY id',
    [admin.username]
  )
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  return respond(await createAdminUser(await request.json(), admin))
}
