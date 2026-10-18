import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { HAS_TEST_DB, resetDb, closePool } from './helpers'

// Login throttling (src/lib/rate-limit.ts, checkLoginRateLimit). Two things went wrong
// before: the IP came from the client-controlled first X-Forwarded-For entry, and five
// wrong guesses from anywhere locked the account's real owner out.

const BASE = 'http://localhost'

async function login(xff: string, username = 'nobody') {
  const { POST } = await import('@/app/api/auth/employee-login/route')
  const res = await POST(new Request(`${BASE}/api/auth/employee-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    body: JSON.stringify({ username, password: 'wrong-password' }),
  }))
  return res.status
}

describe.skipIf(!HAS_TEST_DB)('login rate limit', () => {
  beforeEach(async () => {
    await resetDb()
    await pool.query('DELETE FROM rate_limits')
  })

  afterAll(async () => {
    await closePool()
  })

  it('locks out the guessing source, not the account owner', async () => {
    for (let i = 0; i < 5; i++) expect(await login('203.0.113.7')).toBe(401)
    expect(await login('203.0.113.7')).toBe(429)

    // Someone else trying the same username from their own network is not locked out.
    expect(await login('198.51.100.20')).toBe(401)
  })

  it('a spoofed X-Forwarded-For prefix does not buy fresh attempts', async () => {
    // The client can prepend anything; the proxy-appended last entry is the real source.
    for (let i = 0; i < 5; i++) expect(await login(`10.0.0.${i}, 203.0.113.7`)).toBe(401)
    expect(await login('10.0.0.99, 203.0.113.7')).toBe(429)
  })

  it('the per-IP cap still stops spraying many usernames from one source', async () => {
    for (let i = 0; i < 20; i++) expect(await login('203.0.113.7', `user${i}`)).toBe(401)
    expect(await login('203.0.113.7', 'user-next')).toBe(429)
  })
})
