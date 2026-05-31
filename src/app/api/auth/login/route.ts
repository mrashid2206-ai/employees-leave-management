import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit'

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(request: Request) {
  const { username, password } = await request.json()

  // Rate limit per-username (5/15min) AND per-IP (20/15min) so rotating the
  // username during a password-spray still trips the IP bucket.
  const rateKey = `admin-login:${(username || '').trim().toLowerCase()}`
  const ipKey = `admin-login-ip:${clientIp(request)}`
  const userLimit = checkRateLimit(rateKey, 5, 900000)
  const ipLimit = checkRateLimit(ipKey, 20, 900000)
  if (!userLimit.allowed || !ipLimit.allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  const result = await authenticate(username, password)
  if (!result) {
    return NextResponse.json({ error: 'Invalid username or password / اسم المستخدم أو كلمة المرور غير صحيحة', hint: 'employee_portal' }, { status: 401 })
  }

  resetRateLimit(rateKey)

  const response = NextResponse.json({ user: result.user })
  response.cookies.set('auth-token', result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  })

  return response
}
