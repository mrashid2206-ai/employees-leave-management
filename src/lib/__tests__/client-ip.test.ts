import { describe, it, expect, afterEach } from 'vitest'
import { clientIp } from '@/lib/client-ip'

const req = (headers: Record<string, string>) => new Request('http://localhost/', { headers })

describe('clientIp', () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS
  })

  it('reads the entry our proxy appended, not the one the client wrote', () => {
    // A client sends "X-Forwarded-For: <office ip>"; Railway appends the real address.
    expect(clientIp(req({ 'x-forwarded-for': '192.168.1.10, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('handles a single entry and stray whitespace', () => {
    expect(clientIp(req({ 'x-forwarded-for': ' 203.0.113.7 ' }))).toBe('203.0.113.7')
    expect(clientIp(req({ 'x-forwarded-for': '1.1.1.1 ,  203.0.113.7,' }))).toBe('203.0.113.7')
  })

  it('counts back TRUSTED_PROXY_HOPS entries when there is more than one proxy', () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    // client-written, real client (added by the CDN), CDN (added by Railway)
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 104.16.0.1' }))).toBe('203.0.113.7')
  })

  it('treats a nonsense TRUSTED_PROXY_HOPS as 1', () => {
    process.env.TRUSTED_PROXY_HOPS = 'abc'
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7')
    process.env.TRUSTED_PROXY_HOPS = '0'
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip, then unknown', () => {
    expect(clientIp(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIp(req({}))).toBe('unknown')
  })
})
