import { jwtVerify } from 'jose'
import { NextResponse } from 'next/server'
import { getJwtSecret, getCookie } from '@/lib/jwt'

export interface AuthUser {
  id?: number
  username: string
  role: 'admin' | 'employee'
  name: string
  department_id?: number
}

export async function verifyAdmin(request: Request): Promise<AuthUser | null> {
  const token = getCookie(request, 'auth-token')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
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
    const { payload } = await jwtVerify(token, getJwtSecret())
    // Assert this is actually an employee token (don't trust any signed token).
    if (payload.role !== 'employee' || typeof payload.id !== 'number') return null
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
