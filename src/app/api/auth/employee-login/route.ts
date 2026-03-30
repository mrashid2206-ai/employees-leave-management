import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'employees-secret-key-2026-do-not-share')

export async function POST(request: Request) {
  const { username, password } = await request.json()

  const { rows } = await pool.query(
    'SELECT id, name, username, password_hash, department_id FROM employees WHERE username = $1 AND is_active = true',
    [username]
  )

  if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return NextResponse.json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }, { status: 401 })
  }

  const emp = rows[0]
  const token = await new SignJWT({
    id: emp.id,
    username: emp.username,
    name: emp.name,
    role: 'employee',
    department_id: emp.department_id
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('12h')
    .setIssuedAt()
    .sign(SECRET)

  const response = NextResponse.json({
    user: { id: emp.id, name: emp.name, username: emp.username, role: 'employee' }
  })
  response.cookies.set('emp-auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 12,
    path: '/',
  })

  return response
}
