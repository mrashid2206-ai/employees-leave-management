import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { verifyEmployee, unauthorized } from '@/lib/api-auth'

export async function POST(request: Request) {
  const user = await verifyEmployee(request)
  if (!user) return unauthorized()

  const { current_password, new_password } = await request.json()

  if (!current_password || !new_password) {
    return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 })
  }

  if (new_password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  // Verify current password
  const { rows } = await pool.query('SELECT password_hash FROM employees WHERE id = $1', [user.id])
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const valid = await bcrypt.compare(current_password, rows[0].password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  const hash = await bcrypt.hash(new_password, 10)
  await pool.query('UPDATE employees SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, user.id])

  return NextResponse.json({ success: true })
}
