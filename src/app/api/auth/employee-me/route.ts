import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  return new TextEncoder().encode(secret)
}

export async function GET(request: Request) {
  const token = request.headers.get('cookie')?.split(';').find(c => c.trim().startsWith('emp-auth-token='))?.split('=')[1]

  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { payload } = await jwtVerify(token, getSecret())
    return NextResponse.json({ user: payload })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
