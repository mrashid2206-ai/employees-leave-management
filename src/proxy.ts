import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'employees-secret-key-2026-do-not-share')

// Fully public
const PUBLIC_PATHS = ['/login', '/employee-login', '/api/auth']

// Employee-only pages (require employee token)
const EMPLOYEE_PATHS = ['/check-in', '/apply-leave']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow static files
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next()
  }

  // Allow fully public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow all API routes
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Employee pages — check employee token
  if (EMPLOYEE_PATHS.some(p => pathname.startsWith(p))) {
    const empToken = request.cookies.get('emp-auth-token')?.value
    if (!empToken) {
      return NextResponse.redirect(new URL('/employee-login', request.url))
    }
    try {
      await jwtVerify(empToken, SECRET)
      return NextResponse.next()
    } catch {
      return NextResponse.redirect(new URL('/employee-login', request.url))
    }
  }

  // Admin pages — check admin token
  const adminToken = request.cookies.get('auth-token')?.value
  if (!adminToken) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  try {
    await jwtVerify(adminToken, SECRET)
    return NextResponse.next()
  } catch {
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
