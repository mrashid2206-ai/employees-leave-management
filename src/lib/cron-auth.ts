import crypto from 'crypto'

// Authorize a scheduled (cron) request by a constant-time bearer-token check against
// CRON_SECRET. Returns false when CRON_SECRET is unset (cron disabled) or the token
// doesn't match.
//
// Header only: `Authorization: Bearer <secret>`. A `?key=<secret>` form used to be
// accepted too, but a query string is part of the URL, and URLs get written to access
// logs (Railway's, any proxy in front of it, a scheduler's own run output). The secret
// ended up stored in plain text in places nobody thinks of as holding credentials. Every
// scheduler we use (.github/workflows/*.yml) already sends the header.
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided || provided.length !== secret.length) return false

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
}
