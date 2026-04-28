import { NextResponse } from 'next/server'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('start')
  const endDate = searchParams.get('end')

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'Missing start/end' }, { status: 400 })
  }

  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const totalDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1

  // Calendar days = leave days (company policy: weekends count as leave)
  return NextResponse.json({ workingDays: totalDays, totalDays, holidays: 0 })
}
