import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { leaveBulkStatusSchema } from '@/server/schemas'
import { respond } from '@/server/result'
import { bulkChangeLeaveStatus } from '@/server/services/leave-service'

// Approve or reject several leave requests in one go. The page used to fire one request
// per row all at once and report success no matter what came back; this processes them in
// order through the single-decision service and answers with a result per id.
export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const valid = parseBody(leaveBulkStatusSchema, await request.json())
  if (!valid.ok) return valid.response

  const { ids, status, note, force } = valid.data
  return respond(await bulkChangeLeaveStatus(ids, status, admin, { note, force }))
}
