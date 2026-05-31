import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt'
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit'
import { ensureEmployeeAuthColumns } from '@/lib/ensure-schema'

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(request: Request) {
  const body = await request.json()
  const username = (body.username || '').trim().toLowerCase()
  const password = (body.password || '').trim()

  // Rate limit per-username (5/15min) AND per-IP (20/15min).
  const rateKey = `emp-login:${username}`
  const ipKey = `emp-login-ip:${clientIp(request)}`
  const userLimit = checkRateLimit(rateKey, 5, 900000)
  const ipLimit = checkRateLimit(ipKey, 20, 900000)
  if (!userLimit.allowed || !ipLimit.allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  await ensureEmployeeAuthColumns()

  const { rows } = await pool.query(
    'SELECT id, name, username, password_hash, department_id, must_change_password FROM employees WHERE username = $1 AND is_active = true',
    [username]
  )

  if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return NextResponse.json({ error: 'Invalid username or password / اسم المستخدم أو كلمة المرور غير صحيحة' }, { status: 401 })
  }

  // Reset rate limit on successful login
  resetRateLimit(rateKey)

  const emp = rows[0]
  const token = await new SignJWT({
    id: emp.id,
    username: emp.username,
    name: emp.name,
    role: 'employee',
    department_id: emp.department_id,
    must_change_password: !!emp.must_change_password,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('12h')
    .setIssuedAt()
    .sign(getJwtSecret())

  const response = NextResponse.json({
    user: {
      id: emp.id,
      name: emp.name,
      username: emp.username,
      role: 'employee',
      must_change_password: !!emp.must_change_password,
    }
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
