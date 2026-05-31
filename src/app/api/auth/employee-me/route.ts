import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getJwtSecret, getCookie } from '@/lib/jwt'

export async function GET(request: Request) {
  const token = getCookie(request, 'emp-auth-token')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    if (payload.role !== 'employee') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ user: payload })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
