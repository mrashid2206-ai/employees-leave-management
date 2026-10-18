import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { checkLoginRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'

export async function POST(request: Request) {
  const { username, password } = await request.json()

  const limit = await checkLoginRateLimit('admin-login', username || '', clientIp(request))
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  const result = await authenticate(username, password)
  if (!result) {
    return NextResponse.json({ error: 'Invalid username or password / اسم المستخدم أو كلمة المرور غير صحيحة', hint: 'employee_portal' }, { status: 401 })
  }

  await limit.reset()

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
