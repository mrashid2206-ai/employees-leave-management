import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { runDailyAutomation } from '@/lib/automation'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { date } = await request.json().catch(() => ({}))
  const result = await runDailyAutomation(date, admin)
  return NextResponse.json(result)
}
