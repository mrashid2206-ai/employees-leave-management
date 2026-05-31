import crypto from 'crypto'

// Authorize a scheduled (cron) request by a constant-time bearer-token check against
// CRON_SECRET. Returns false when CRON_SECRET is unset (cron disabled) or the token
// doesn't match. Accept either `Authorization: Bearer <secret>` or `?key=<secret>`.
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const queryKey = new URL(request.url).searchParams.get('key') || ''
  const provided = bearer || queryKey
  if (!provided || provided.length !== secret.length) return false

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
}
