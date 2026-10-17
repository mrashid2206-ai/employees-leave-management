import { NextResponse } from 'next/server'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { respond } from '@/server/result'
import { readUploadedFile } from '@/server/upload'
import { listAttachments, uploadAttachment } from '@/server/services/attachment-service'

type Ctx = { params: Promise<{ id: string }> }

// 20 uploads per user per 15 minutes is far more than attaching a few certificates
// needs, and caps how fast one account can fill the database with 5 MB rows.
const UPLOADS_PER_WINDOW = 20
const UPLOAD_WINDOW_MS = 15 * 60 * 1000

// Attachment metadata for one leave (no file contents): the leave's employee or an admin.
export async function GET(request: Request, { params }: Ctx) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params
  return respond(await listAttachments(id, user))
}

// multipart/form-data with a single `file` field. Origin is checked by src/proxy.ts like
// every other /api mutation.
export async function POST(request: Request, { params }: Ctx) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params

  // Counted before the body is read, so a refused caller costs nothing to turn away.
  const limit = await checkRateLimit(
    `attachment-upload:${user.role}:${user.id ?? user.username}`,
    UPLOADS_PER_WINDOW,
    UPLOAD_WINDOW_MS
  )
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads, try again later / عدد كبير من عمليات الرفع، حاول لاحقاً' },
      { status: 429 }
    )
  }

  const file = await readUploadedFile(request)
  if (!file.ok) return respond(file)

  return respond(await uploadAttachment(id, file.data, user))
}
