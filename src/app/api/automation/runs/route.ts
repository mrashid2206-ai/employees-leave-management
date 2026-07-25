import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { listRuns } from '@/lib/automation-journal'

export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const limit = Number(new URL(request.url).searchParams.get('limit')) || 30
  return NextResponse.json(await listRuns(limit))
}
