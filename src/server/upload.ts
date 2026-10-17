import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments'
import { ok, fail, type ServiceResult } from '@/server/result'
import type { UploadInput } from '@/server/services/attachment-service'

// Reading a multipart upload without letting the sender decide how much memory it costs.
//
// request.formData() reads the whole body before it can say anything about it, so the
// size is enforced first, on the raw stream: a declared Content-Length over the cap is
// refused without reading a byte, and an undeclared or understated one is cut off as soon
// as the running total passes the cap. Only a body under the cap is parsed.
//
// (The proxy in front of every route also buffers request bodies, up to Next's 10 MB
// proxyClientMaxBodySize, and beyond that passes on a TRUNCATED body. A truncated body is
// still over our cap, so it is refused here rather than half-parsed.)

// The multipart envelope (boundary lines, part headers) adds a little on top of the file.
const MAX_BODY_BYTES = MAX_ATTACHMENT_BYTES + 64 * 1024

const TOO_LARGE = 'The file is larger than 5 MB / حجم الملف أكبر من 5 ميغابايت'

async function readCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** The single `file` field of a multipart/form-data request, size-capped. */
export async function readUploadedFile(request: Request): Promise<ServiceResult<UploadInput>> {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return fail(400, 'Send the file as multipart/form-data / أرسل الملف بصيغة multipart/form-data')
  }

  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail(413, TOO_LARGE)

  if (!request.body) return fail(400, 'No file was sent / لم يتم إرسال ملف')
  const raw = await readCapped(request.body, MAX_BODY_BYTES)
  if (!raw) return fail(413, TOO_LARGE)

  let form: FormData
  try {
    // Re-wrap the bytes we already hold so the platform's multipart parser can read them.
    form = await new Response(raw as BodyInit, { headers: { 'content-type': contentType } }).formData()
  } catch {
    return fail(400, 'The upload could not be read / تعذّرت قراءة الملف المرفوع')
  }

  const entry = form.get('file')
  if (!entry || typeof entry === 'string') return fail(400, 'No file was sent / لم يتم إرسال ملف')
  return ok({ name: entry.name, bytes: new Uint8Array(await entry.arrayBuffer()) })
}
