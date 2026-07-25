import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { listErrors } from '@/lib/error-log'

// Admin-only: stack traces and request paths are exactly the kind of internal detail that
// must not leak to employees.
export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const p = new URL(request.url).searchParams
  const limit = Number(p.get('limit')) || 50
  const offset = Number(p.get('offset')) || 0
  return NextResponse.json(await listErrors(limit, offset))
}
