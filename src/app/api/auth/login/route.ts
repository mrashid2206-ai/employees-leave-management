import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const { username, password } = await request.json()

  // Rate limit: 5 attempts per 15 minutes
  const rateKey = `admin-login:${(username || '').trim()}`
  const { allowed } = checkRateLimit(rateKey, 5, 900000)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  const result = await authenticate(username, password)
  if (!result) {
    return NextResponse.json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة', hint: 'employee_portal' }, { status: 401 })
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
