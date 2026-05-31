import pool from '@/lib/db'

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: { cnt?: string }[] }>
}

// Count all calendar days in range (weekends included — company policy) minus public
// holidays. Accepts an optional transaction client so callers can run it inside BEGIN.
export async function countLeaveDays(
  startDate: string,
  endDate: string,
  client: Queryable = pool
): Promise<number> {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const totalCalendarDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1

  const { rows } = await client.query(
    'SELECT COUNT(*) as cnt FROM holidays WHERE date >= $1 AND date <= $2',
    [startDate, endDate]
  )
  const holidayCount = parseInt(rows[0]?.cnt || '0')

  return Math.max(1, totalCalendarDays - holidayCount)
}
