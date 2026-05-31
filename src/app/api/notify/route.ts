import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { sendMail, isEmailConfigured } from '@/lib/email'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { to, subject, html } = await request.json()

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email not configured', sent: false })
  }

  const sent = await sendMail({ to, subject, html })
  return NextResponse.json({ success: sent, sent })
}
