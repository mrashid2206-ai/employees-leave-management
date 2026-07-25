import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyEmployee, unauthorized } from '@/lib/api-auth'
import { ensurePushSubscriptionsTable } from '@/lib/ensure-schema'
import { pushPublicKey } from '@/lib/push'

// The browser needs the VAPID public key to subscribe; it is not a secret.
export async function GET() {
  return NextResponse.json({ key: pushPublicKey() })
}

// Store (or refresh) this device's push subscription for the logged-in employee.
export async function POST(request: Request) {
  const user = await verifyEmployee(request)
  if (!user || user.id == null) return unauthorized()

  const body = await request.json().catch(() => null)
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  await ensurePushSubscriptionsTable()
  await pool.query(
    `INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET employee_id = $1, p256dh = $3, auth = $4`,
    [user.id, endpoint, p256dh, auth]
  )
  return NextResponse.json({ success: true })
}

// Unsubscribe this device (e.g. the employee turns reminders off).
export async function DELETE(request: Request) {
  const user = await verifyEmployee(request)
  if (!user) return unauthorized()
  const body = await request.json().catch(() => null)
  if (!body?.endpoint) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [body.endpoint]).catch(() => {})
  return NextResponse.json({ success: true })
}
