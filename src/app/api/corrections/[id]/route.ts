import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { correctionReviewSchema } from '@/server/schemas'
import { respond } from '@/server/result'
import { reviewCorrection } from '@/server/services/correction-service'

// Admin approves (applies the corrected times to attendance) or rejects a request.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params

  const valid = parseBody(correctionReviewSchema, await request.json())
  if (!valid.ok) return valid.response

  return respond(await reviewCorrection(id, valid.data.status, admin))
}
