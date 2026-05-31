// Shared JWT secret + cookie helpers (edge-safe: no pg/node-only imports).

const MIN_SECRET_LENGTH = 32
let warnedWeakSecret = false

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  // Validate strength but do not hard-fail an already-running deployment that
  // happens to use a shorter secret — warn once instead of locking everyone out.
  if (secret.length < MIN_SECRET_LENGTH && !warnedWeakSecret) {
    warnedWeakSecret = true
    console.warn(
      `[security] JWT_SECRET is only ${secret.length} chars; use at least ${MIN_SECRET_LENGTH} random chars for HS256.`
    )
  }
  return new TextEncoder().encode(secret)
}

// Parse a single cookie value from a raw Cookie header (full value, '=' safe).
export function getCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie') || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? match[1] : undefined
}
