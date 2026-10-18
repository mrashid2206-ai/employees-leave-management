import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

// verifyAdmin, not a bare signature check: a logged-out or revoked session must stop
// getting an identity back here too.
export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  return NextResponse.json({ user: { username: admin.username, role: admin.role, name: admin.name } })
}
