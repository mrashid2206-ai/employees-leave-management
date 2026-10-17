import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { respond } from '@/server/result'
import { deleteAdminUser } from '@/server/services/admin-user-service'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  // Refuses self-deletion and removing the last active admin; see the service.
  return respond(await deleteAdminUser(id, admin))
}
