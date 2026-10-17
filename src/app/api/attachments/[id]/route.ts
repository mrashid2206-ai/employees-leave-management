import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { contentDisposition } from '@/lib/attachments'
import { respond } from '@/server/result'
import { deleteAttachment, getAttachmentFile } from '@/server/services/attachment-service'

type Ctx = { params: Promise<{ id: string }> }

// Download. Always `attachment`, never rendered inside the app's own origin: the bytes
// came from a user, and a file that passes the signature check can still carry script for
// a viewer that sniffs. nosniff and a sandboxing CSP back that up. no-store because these
// are medical documents and the device may be shared.
export async function GET(request: Request, { params }: Ctx) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params

  const result = await getAttachmentFile(id, user)
  if (!result.ok) return respond(result)
  const file = result.data

  return new Response(new Uint8Array(file.data), {
    status: 200,
    headers: {
      'Content-Type': file.content_type,
      'Content-Length': String(file.size_bytes),
      'Content-Disposition': contentDisposition(file.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}

// The leave's employee while it is pending, or an admin.
export async function DELETE(request: Request, { params }: Ctx) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params
  return respond(await deleteAttachment(id, user))
}
