import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'

export async function POST(request: Request) {
  const { username, password } = await request.json()

  const result = await authenticate(username, password)
  if (!result) {
    return NextResponse.json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة', hint: 'employee_portal' }, { status: 401 })
  }

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
