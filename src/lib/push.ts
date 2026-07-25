import webpush from 'web-push'
import pool from '@/lib/db'
import { logger } from '@/lib/log'
import { ensurePushSubscriptionsTable } from '@/lib/ensure-schema'

// Web Push. Disabled (no-op) unless VAPID keys are configured, so the app runs fine
// without them. Generate a key pair once with:  npx web-push generate-vapid-keys
let configured: boolean | null = null

function ensureConfigured(): boolean {
  if (configured !== null) return configured
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    configured = false
    return false
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    publicKey,
    privateKey
  )
  configured = true
  return true
}

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

// Send to every registered device for an employee. Subscriptions that the push service
// reports as gone (404/410) are pruned. Never throws.
export async function pushToEmployee(employeeId: number, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0
  let sent = 0
  try {
    await ensurePushSubscriptionsTable()
    const { rows } = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE employee_id = $1',
      [employeeId]
    )
    for (const s of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        )
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]).catch(() => {})
        } else {
          logger.warn('push send failed', { employeeId, status })
        }
      }
    }
  } catch (e) {
    logger.warn('push lookup failed', { employeeId, error: e instanceof Error ? e.message : String(e) })
  }
  return sent
}
