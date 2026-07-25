import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { leaveStatusSchema } from '@/server/schemas'
import { respond } from '@/server/result'
import { changeLeaveStatus } from '@/server/services/leave-service'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params

  const valid = parseBody(leaveStatusSchema, await request.json())
  if (!valid.ok) return valid.response

  return respond(await changeLeaveStatus(id, valid.data.status, admin))
}
