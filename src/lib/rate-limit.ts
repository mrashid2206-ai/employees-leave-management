// Simple in-memory rate limiter
const attempts = new Map<string, { count: number; resetAt: number }>()

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of attempts) {
    if (val.resetAt < now) attempts.delete(key)
  }
}, 600000)

export function checkRateLimit(key: string, maxAttempts: number = 5, windowMs: number = 900000): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = attempts.get(key)

  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxAttempts - 1 }
  }

  if (entry.count >= maxAttempts) {
    return { allowed: false, remaining: 0 }
  }

  entry.count++
  return { allowed: true, remaining: maxAttempts - entry.count }
}

export function resetRateLimit(key: string) {
  attempts.delete(key)
}
