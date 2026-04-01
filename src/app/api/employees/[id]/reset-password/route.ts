import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const { password } = await request.json()
  const pwd = password || '123456'

  if (pwd.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const newPassword = await bcrypt.hash(pwd, 10)

  await pool.query(
    'UPDATE employees SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [newPassword, id]
  )

  return NextResponse.json({ success: true })
}
