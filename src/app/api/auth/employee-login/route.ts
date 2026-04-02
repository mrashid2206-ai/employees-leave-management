import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  return new TextEncoder().encode(secret)
}

export async function POST(request: Request) {
  const body = await request.json()
  const username = (body.username || '').trim().toLowerCase()
  const password = (body.password || '').trim()

  // Rate limit: 5 attempts per 15 minutes per username
  const rateKey = `emp-login:${username}`
  const { allowed } = checkRateLimit(rateKey, 5, 900000)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  const { rows } = await pool.query(
    'SELECT id, name, username, password_hash, department_id FROM employees WHERE username = $1 AND is_active = true',
    [username]
  )

  if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return NextResponse.json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }, { status: 401 })
  }

  // Reset rate limit on successful login
  resetRateLimit(rateKey)

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
    .sign(getSecret())

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
