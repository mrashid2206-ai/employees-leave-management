import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { getJwtSecret } from '@/lib/jwt'

// Fully public
const PUBLIC_PATHS = ['/login', '/employee-login', '/api/auth']

// Employee-only pages (require employee token)
const EMPLOYEE_PATHS = ['/check-in', '/apply-leave']

// Files from public/ the browser fetches by itself, with no session: the manifest and
// icons from the login page, and the service worker script. They used to fall through to
// the page checks and get redirected to /login or /check-in, and a service worker behind a
// redirect is refused outright, so push reminders and PWA install never worked. An exact
// list rather than "anything with an extension", so no route can opt out of auth by
// accident. None of these hold anything private.
const PUBLIC_FILES = new Set([
  '/sw.js',
  '/manifest.json',
  '/robots.txt',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow static files
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || PUBLIC_FILES.has(pathname)) {
    return NextResponse.next()
  }

  // Security headers are NOT set here: they live in next.config.ts headers(), which
  // reaches every response, including the static files this matcher skips.

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
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  // An employee who is already signed in has no business on the login form — send them
  // to the portal. Only the signature/expiry is checked here (no DB in the proxy), so a
  // revoked-but-unexpired token also lands on /check-in; the portal then gets a 401,
  // clears the cookie and comes back here, which is why this can't loop.
  if (pathname === '/employee-login') {
    const empToken = request.cookies.get('emp-auth-token')?.value
    if (empToken) {
      try {
        const { payload } = await jwtVerify(empToken, getJwtSecret())
        if (payload.role === 'employee') {
          return NextResponse.redirect(new URL('/check-in', request.url))
        }
      } catch {
        /* expired or invalid — show the login form */
      }
    }
  }

  // Allow fully public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
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
