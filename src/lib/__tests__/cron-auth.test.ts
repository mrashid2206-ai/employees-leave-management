import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { authorizeCron } from '@/lib/cron-auth'

const SECRET = 'cron-unit-secret-0123456789'
const URL_BASE = 'https://app.example/api/cron/daily'

describe('authorizeCron', () => {
  let prev: string | undefined

  beforeEach(() => {
    prev = process.env.CRON_SECRET
    process.env.CRON_SECRET = SECRET
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  })

  it('accepts the secret as a bearer token', () => {
    expect(authorizeCron(new Request(URL_BASE, { headers: { authorization: `Bearer ${SECRET}` } }))).toBe(true)
  })

  it('rejects the secret in a ?key= query string, which would land in access logs', () => {
    expect(authorizeCron(new Request(`${URL_BASE}?key=${SECRET}`))).toBe(false)
  })

  it('rejects a wrong or missing token', () => {
    expect(authorizeCron(new Request(URL_BASE, { headers: { authorization: 'Bearer nope' } }))).toBe(false)
    expect(authorizeCron(new Request(URL_BASE, { headers: { authorization: SECRET } }))).toBe(false)
    expect(authorizeCron(new Request(URL_BASE))).toBe(false)
  })

  it('is disabled entirely while CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET
    expect(authorizeCron(new Request(URL_BASE, { headers: { authorization: 'Bearer ' } }))).toBe(false)
  })
})
