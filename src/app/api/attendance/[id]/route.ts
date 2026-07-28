import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { attendanceUpdateSchema } from '@/server/schemas'
import { updateAttendance, deleteAttendance } from '@/server/services/attendance-service'

// Thin: authenticate, validate, delegate. The logic lives in attendance-service because
// these writes move leave balances and must be testable without going through HTTP.

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params

  const valid = parseBody(attendanceUpdateSchema, await request.json())
  if (!valid.ok) return valid.response

  const result = await updateAttendance(id, valid.data as Record<string, unknown>, {
    role: 'admin',
    username: admin.username,
  })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })

  // Flattened for backwards compatibility: callers read refundedDays/chargedDays
  // alongside the record itself.
  const { record, refundedDays, chargedDays } = result.data
  return NextResponse.json({ ...(record as object), refundedDays, chargedDays })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params

  const result = await deleteAttendance(id, { role: 'admin', username: admin.username })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })

  return NextResponse.json({ success: true, ...result.data })
}
