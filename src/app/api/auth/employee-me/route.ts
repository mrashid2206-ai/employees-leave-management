import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'employees-secret-key-2026-do-not-share')

export async function GET(request: Request) {
  const token = request.headers.get('cookie')?.split(';').find(c => c.trim().startsWith('emp-auth-token='))?.split('=')[1]

  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, SECRET)
    return NextResponse.json({ user: payload })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
