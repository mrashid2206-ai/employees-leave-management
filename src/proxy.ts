import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  return new TextEncoder().encode(secret)
}

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

  // Security headers on all responses
  const addSecurityHeaders = (response: NextResponse) => {
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('X-XSS-Protection', '1; mode=block')
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    return response
  }

  // Block external API requests (CORS-like protection)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')) {
    const origin = request.headers.get('origin')
    const referer = request.headers.get('referer')
    const host = request.headers.get('host') || ''

    // Allow same-origin requests and requests with no origin (server-side, curl for testing)
    if (origin && !origin.includes(host)) {
      return addSecurityHeaders(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    }
  }

  // Allow fully public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const response = NextResponse.next()
    return addSecurityHeaders(response)
  }

  // Allow all API routes (auth checked per-route)
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
      await jwtVerify(empToken, getSecret())
      return NextResponse.next()
    } catch {
      return NextResponse.redirect(new URL('/employee-login', request.url))
    }
  }

  // Admin pages — check admin token
  const adminToken = request.cookies.get('auth-token')?.value
  if (!adminToken) {
    // If user has an employee token, redirect to employee portal instead of admin login
    const empToken = request.cookies.get('emp-auth-token')?.value
    if (empToken) {
      return NextResponse.redirect(new URL('/check-in', request.url))
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }
  try {
    await jwtVerify(adminToken, getSecret())
    return NextResponse.next()
  } catch {
    const empToken = request.cookies.get('emp-auth-token')?.value
    if (empToken) {
      return NextResponse.redirect(new URL('/check-in', request.url))
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
