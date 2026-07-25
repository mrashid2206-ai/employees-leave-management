import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { runYearlyReset } from '@/lib/automation'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  // Manual admin run is allowed any time (force), but still idempotency-guarded.
  const result = await runYearlyReset(admin, { force: true })
  if (!result.success) {
    return NextResponse.json(result, { status: result.message === 'No settings' ? 400 : 409 })
  }
  return NextResponse.json(result)
}
