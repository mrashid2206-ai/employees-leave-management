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

  const { rows: settingsRows } = await pool.query('SELECT work_days FROM settings LIMIT 1')
  const workDays = settingsRows[0]?.work_days?.split(',').map(Number) || [0,1,2,3,4]

  const { rows: holidays } = await pool.query(
    'SELECT date::text as date FROM holidays WHERE date >= $1 AND date <= $2',
    [startDate, endDate]
  )
  const holidaySet = new Set(holidays.map(h => h.date))

  let workingDays = 0
  let totalDays = 0
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    totalDays++
    const dayOfWeek = d.getDay()
    const dateStr = d.toISOString().split('T')[0]
    if (workDays.includes(dayOfWeek) && !holidaySet.has(dateStr)) {
      workingDays++
    }
  }

  return NextResponse.json({ workingDays, totalDays, holidays: holidays.length })
}
