import { jwtVerify } from 'jose'
import { NextResponse } from 'next/server'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  return new TextEncoder().encode(secret)
}

export interface AuthUser {
  id?: number
  username: string
  role: 'admin' | 'employee'
  name: string
  department_id?: number
}

function getCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie') || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? match[1] : undefined
}

export async function verifyAdmin(request: Request): Promise<AuthUser | null> {
  const token = getCookie(request, 'auth-token')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (payload.role !== 'admin') return null
    return payload as unknown as AuthUser
  } catch {
    return null
  }
}

export async function verifyEmployee(request: Request): Promise<AuthUser | null> {
  const token = getCookie(request, 'emp-auth-token')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload as unknown as AuthUser
  } catch {
    return null
  }
}

// Verify either admin or employee
export async function verifyAnyAuth(request: Request): Promise<AuthUser | null> {
  const admin = await verifyAdmin(request)
  if (admin) return admin
  return verifyEmployee(request)
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
