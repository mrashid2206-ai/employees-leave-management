import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { getJwtSecret } from '@/lib/jwt'

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

  // Cross-origin protection for ALL API routes (including /api/auth, so login/logout
  // POSTs are covered too). Requests with no Origin header (server-side, curl) are
  // allowed; when present, the Origin host must match the request Host or an
  // allow-listed host from APP_URL/ALLOWED_ORIGINS.
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host') || ''

    if (origin) {
      const allowedHosts = new Set<string>([host])
      for (const envUrl of [process.env.APP_URL, ...(process.env.ALLOWED_ORIGINS?.split(',') || [])]) {
        if (!envUrl) continue
        try {
          allowedHosts.add(new URL(envUrl.trim()).host)
        } catch {
          /* ignore malformed env entry */
        }
      }
      try {
        const originHost = new URL(origin).host
        if (!allowedHosts.has(originHost)) {
          return addSecurityHeaders(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
        }
      } catch {
        return addSecurityHeaders(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
      }
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
      await jwtVerify(empToken, getJwtSecret())
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
    await jwtVerify(adminToken, getJwtSecret())
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
