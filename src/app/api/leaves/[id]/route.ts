import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { leaveEditSchema } from '@/server/schemas'
import { respond } from '@/server/result'
import { editLeaveDates, deleteLeave } from '@/server/services/leave-service'

// Edit leave request (admin only) — change dates, recalculate days, adjust balance.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params

  const valid = parseBody(leaveEditSchema, await request.json())
  if (!valid.ok) return valid.response

  return respond(await editLeaveDates(id, valid.data.start_date, valid.data.end_date, admin))
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params
  return respond(await deleteLeave(id, user))
}
