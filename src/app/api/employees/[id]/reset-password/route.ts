import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { password } = await request.json()

  const newPassword = await bcrypt.hash(password || '123456', 10)

  await pool.query(
    'UPDATE employees SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [newPassword, id]
  )

  return NextResponse.json({ success: true })
}
