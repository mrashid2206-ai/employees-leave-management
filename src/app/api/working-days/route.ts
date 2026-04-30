import { NextResponse } from 'next/server'
import pool from '@/lib/db'
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

  // Subtract public holidays from leave days
  const { rows: holidays } = await pool.query(
    'SELECT COUNT(*) as cnt FROM holidays WHERE date >= $1 AND date <= $2',
    [startDate, endDate]
  )
  const holidayCount = parseInt(holidays[0]?.cnt || '0')
  const leaveDays = Math.max(0, totalDays - holidayCount)

  return NextResponse.json({ workingDays: leaveDays, totalDays, holidays: holidayCount })
}
