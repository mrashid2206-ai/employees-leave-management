// The caller's IP, for rate limiting and the office-network check at check-in.
//
// X-Forwarded-For is a list each proxy APPENDS to, so only the entries our own proxies
// added can be trusted. The first entry is whatever the client chose to send: reading it
// let anyone reset the login IP bucket on every request, or claim the office IP at
// check-in and be recorded on-site. Railway's edge is one hop, so by default we read the
// last entry. Put another proxy in front (e.g. Cloudflare) and set TRUSTED_PROXY_HOPS=2.
export function clientIp(request: Request): string {
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1)
  const chain = (request.headers.get('x-forwarded-for') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (chain.length > 0) return chain[Math.max(0, chain.length - hops)]
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}
