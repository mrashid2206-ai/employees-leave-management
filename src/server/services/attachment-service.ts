import pool from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_LEAVE,
  sniffContentType,
  sanitizeFilename,
  type AttachmentContentType,
} from '@/lib/attachments'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'

// Certificates attached to leave requests. These are medical documents, so the access
// rule is narrow and the same everywhere: the employee the leave belongs to, or an admin.
// Anyone else gets 404 — not 403 — so ids can't be probed to learn what exists.
//
// Changing the set (add/remove) is further limited for employees to PENDING requests:
// once an admin has decided, the evidence the decision rested on stays as it was.

export interface AttachmentMeta {
  id: number
  leave_request_id: number
  filename: string
  content_type: AttachmentContentType
  size_bytes: number
  uploaded_by_role: 'admin' | 'employee'
  created_at: string
}

export interface AttachmentFile {
  filename: string
  content_type: AttachmentContentType
  size_bytes: number
  data: Buffer
}

export interface UploadInput {
  name: string
  bytes: Uint8Array
}

const META = 'id, leave_request_id, filename, content_type, size_bytes, uploaded_by_role, created_at'

const NOT_FOUND = 'Not found / غير موجود'
const ONLY_PENDING = 'Attachments can only be changed while the request is pending / يمكن تعديل المرفقات فقط ما دام الطلب قيد الانتظار'

function parseId(raw: string | number): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null
}

function canSee(employeeId: number, actor: Actor): boolean {
  if (actor.role === 'admin') return true
  return actor.role === 'employee' && actor.id === employeeId
}

/** Size and type, both decided from the bytes actually received. */
function validateFile(bytes: Uint8Array): ServiceResult<AttachmentContentType> {
  if (bytes.byteLength === 0) return fail(400, 'The file is empty / الملف فارغ')
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return fail(413, 'The file is larger than 5 MB / حجم الملف أكبر من 5 ميغابايت')
  }
  const type = sniffContentType(bytes)
  if (!type) return fail(415, 'Only PDF, JPEG or PNG files are accepted / يُقبل فقط ملف PDF أو JPEG أو PNG')
  return ok(type)
}

export async function uploadAttachment(
  leaveIdRaw: string | number,
  file: UploadInput,
  actor: Actor
): Promise<ServiceResult<AttachmentMeta>> {
  const leaveId = parseId(leaveIdRaw)
  if (!leaveId) return fail(404, NOT_FOUND)

  const checked = validateFile(file.bytes)
  if (!checked.ok) return checked
  const contentType = checked.data
  const filename = sanitizeFilename(file.name, contentType)

  const client = await pool.connect()
  let meta: AttachmentMeta
  let employeeId: number
  try {
    await client.query('BEGIN')
    // The leave row is locked so the count check and the insert can't interleave with a
    // second upload (six files through a five-file cap), and so an approval that lands
    // mid-upload is seen: changeLeaveStatus takes the same lock.
    const { rows: leaves } = await client.query(
      'SELECT id, employee_id, status FROM leave_requests WHERE id = $1 FOR UPDATE',
      [leaveId]
    )
    const leave = leaves[0]
    if (!leave || !canSee(leave.employee_id, actor)) {
      await client.query('ROLLBACK')
      return fail(404, NOT_FOUND)
    }
    if (actor.role !== 'admin' && leave.status !== 'pending') {
      await client.query('ROLLBACK')
      return fail(409, ONLY_PENDING)
    }

    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS c FROM leave_attachments WHERE leave_request_id = $1',
      [leaveId]
    )
    if (countRows[0].c >= MAX_ATTACHMENTS_PER_LEAVE) {
      await client.query('ROLLBACK')
      return fail(
        409,
        `A request can have at most ${MAX_ATTACHMENTS_PER_LEAVE} attachments / لا يمكن إرفاق أكثر من ${MAX_ATTACHMENTS_PER_LEAVE} ملفات بالطلب`
      )
    }

    const { rows } = await client.query(
      `INSERT INTO leave_attachments
         (leave_request_id, filename, content_type, size_bytes, data, uploaded_by, uploaded_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${META}`,
      [leaveId, filename, contentType, file.bytes.byteLength, Buffer.from(file.bytes), actorLabel(actor), actor.role]
    )
    meta = rows[0]
    employeeId = leave.employee_id
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await logAudit(
    'leave_attachment_uploaded',
    actorLabel(actor),
    actor.role,
    `Leave #${leaveId}: attached "${filename}" (${contentType}, ${meta.size_bytes} bytes) for emp ${employeeId}`
  )
  return ok(meta)
}

export async function listAttachments(
  leaveIdRaw: string | number,
  actor: Actor
): Promise<ServiceResult<AttachmentMeta[]>> {
  const leaveId = parseId(leaveIdRaw)
  if (!leaveId) return fail(404, NOT_FOUND)

  const { rows: leaves } = await pool.query('SELECT employee_id FROM leave_requests WHERE id = $1', [leaveId])
  if (!leaves[0] || !canSee(leaves[0].employee_id, actor)) return fail(404, NOT_FOUND)

  const { rows } = await pool.query(
    `SELECT ${META} FROM leave_attachments WHERE leave_request_id = $1 ORDER BY created_at, id`,
    [leaveId]
  )
  return ok(rows)
}

export async function getAttachmentFile(
  idRaw: string | number,
  actor: Actor
): Promise<ServiceResult<AttachmentFile>> {
  const id = parseId(idRaw)
  if (!id) return fail(404, NOT_FOUND)

  // Ownership is resolved through the leave in the same query: the attachment id alone
  // says nothing about whose it is, and it is a guessable SERIAL.
  const { rows } = await pool.query(
    `SELECT la.filename, la.content_type, la.size_bytes, la.data, lr.employee_id
       FROM leave_attachments la
       JOIN leave_requests lr ON lr.id = la.leave_request_id
      WHERE la.id = $1`,
    [id]
  )
  const row = rows[0]
  if (!row || !canSee(row.employee_id, actor)) return fail(404, NOT_FOUND)
  return ok({ filename: row.filename, content_type: row.content_type, size_bytes: row.size_bytes, data: row.data })
}

export async function deleteAttachment(
  idRaw: string | number,
  actor: Actor
): Promise<ServiceResult<{ success: true }>> {
  const id = parseId(idRaw)
  if (!id) return fail(404, NOT_FOUND)

  const client = await pool.connect()
  let detail: { filename: string; leave_request_id: number; employee_id: number }
  try {
    await client.query('BEGIN')
    // Lock the leave, as the upload does, so "only while pending" holds against a
    // concurrent approval.
    const { rows } = await client.query(
      `SELECT la.filename, la.leave_request_id, lr.employee_id, lr.status
         FROM leave_attachments la
         JOIN leave_requests lr ON lr.id = la.leave_request_id
        WHERE la.id = $1
        FOR UPDATE OF lr`,
      [id]
    )
    const row = rows[0]
    if (!row || !canSee(row.employee_id, actor)) {
      await client.query('ROLLBACK')
      return fail(404, NOT_FOUND)
    }
    if (actor.role !== 'admin' && row.status !== 'pending') {
      await client.query('ROLLBACK')
      return fail(409, ONLY_PENDING)
    }
    await client.query('DELETE FROM leave_attachments WHERE id = $1', [id])
    await client.query('COMMIT')
    detail = row
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await logAudit(
    'leave_attachment_deleted',
    actorLabel(actor),
    actor.role,
    `Leave #${detail.leave_request_id}: removed "${detail.filename}" for emp ${detail.employee_id}`
  )
  return ok({ success: true as const })
}
