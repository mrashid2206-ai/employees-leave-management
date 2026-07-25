import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { previewOmanHolidays, seedOmanHolidays } from '@/server/services/holiday-service'
import { respond } from '@/server/result'

// GET  -> preview which holidays a year would add (and which already exist)
// POST -> actually insert them, skipping dates that are already on the calendar

export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const year = Number(new URL(request.url).searchParams.get('year'))
  return respond(await previewOmanHolidays(year))
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const body = await request.json().catch(() => ({}))
  const lang: 'ar' | 'en' = body?.lang === 'en' ? 'en' : 'ar'

  return respond(
    await seedOmanHolidays(Number(body?.year), lang, { role: 'admin', username: admin.username })
  )
}
