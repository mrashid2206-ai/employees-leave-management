import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import {
  HAS_TEST_DB, resetDb, addEmployee, closePool, employeeToken, adminToken, authedRequest, routeParams,
} from './helpers'

// Medical certificates on leave requests: the app's first file upload, so most of this is
// about who can reach a file and what is accepted as one.
//
// The rule: the leave's own employee (and only while the request is pending, for
// changes) or an admin. Everyone else gets 404, never 403, so attachment ids can't be
// probed. The type is decided by the bytes, not by the name or the declared type.

const BASE = 'http://localhost'

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])

type Who = { employee: string } | { admin: string } | Record<string, never>

function cookieOf(who: Who): string {
  if ('employee' in who) return `emp-auth-token=${who.employee}`
  if ('admin' in who) return `auth-token=${who.admin}`
  return ''
}

/** A real multipart request, as the browser's FormData produces it. */
function uploadRequest(leaveId: number, who: Who, bytes: Uint8Array, name: string, type = 'application/pdf') {
  const form = new FormData()
  form.append('file', new File([bytes as BlobPart], name, { type }))
  const headers = new Headers()
  const cookie = cookieOf(who)
  if (cookie) headers.set('cookie', cookie)
  return new Request(`${BASE}/api/leaves/${leaveId}/attachments`, { method: 'POST', body: form, headers })
}

describe.skipIf(!HAS_TEST_DB)('leave attachments', () => {
  let me: number
  let other: number
  let annualTypeId: number
  let empCookie: string
  let otherCookie: string
  let adminCookie: string
  let pendingLeave: number

  async function leaveFor(employeeId: number, status: string, start = '2026-11-10'): Promise<number> {
    const { rows } = await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
       VALUES ($1, $2, $3, $3, 1, $4) RETURNING id`,
      [employeeId, annualTypeId, start, status]
    )
    return rows[0].id
  }

  async function upload(leaveId: number, who: Who, bytes: Uint8Array = PDF, name = 'certificate.pdf', type?: string) {
    const { POST } = await import('@/app/api/leaves/[id]/attachments/route')
    return POST(uploadRequest(leaveId, who, bytes, name, type), routeParams({ id: String(leaveId) }))
  }

  async function list(leaveId: number, who: Who) {
    const { GET } = await import('@/app/api/leaves/[id]/attachments/route')
    return GET(authedRequest(`${BASE}/api/leaves/${leaveId}/attachments`, who), routeParams({ id: String(leaveId) }))
  }

  async function download(id: number, who: Who) {
    const { GET } = await import('@/app/api/attachments/[id]/route')
    return GET(authedRequest(`${BASE}/api/attachments/${id}`, who), routeParams({ id: String(id) }))
  }

  async function remove(id: number, who: Who) {
    const { DELETE } = await import('@/app/api/attachments/[id]/route')
    return DELETE(authedRequest(`${BASE}/api/attachments/${id}`, who, { method: 'DELETE' }), routeParams({ id: String(id) }))
  }

  async function storedCount(leaveId: number): Promise<number> {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM leave_attachments WHERE leave_request_id = $1', [leaveId])
    return rows[0].c
  }

  beforeEach(async () => {
    const seeded = await resetDb()
    me = seeded.employeeId
    annualTypeId = seeded.annualTypeId
    other = await addEmployee()
    empCookie = await employeeToken(me)
    otherCookie = await employeeToken(other, { username: 'other.employee' })
    adminCookie = await adminToken()
    // The upload limiter is persistent (Postgres); a suite this size would trip it.
    await pool.query("DELETE FROM rate_limits WHERE key LIKE 'attachment-upload:%'")
    pendingLeave = await leaveFor(me, 'pending')
  })

  afterAll(async () => {
    await closePool()
  })

  it('the owner can attach to their own pending request', async () => {
    const res = await upload(pendingLeave, { employee: empCookie })
    expect(res.status).toBe(200)
    const meta = await res.json()
    expect(meta).toMatchObject({
      leave_request_id: pendingLeave,
      filename: 'certificate.pdf',
      content_type: 'application/pdf',
      size_bytes: PDF.byteLength,
      uploaded_by_role: 'employee',
    })
    expect(meta).not.toHaveProperty('data')

    const { rows } = await pool.query('SELECT data, uploaded_by FROM leave_attachments WHERE id = $1', [meta.id])
    expect(Buffer.compare(rows[0].data, Buffer.from(PDF))).toBe(0)
    expect(rows[0].uploaded_by).toBe('test.employee')

    const audit = await pool.query("SELECT details FROM audit_log WHERE action = 'leave_attachment_uploaded'")
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].details).toContain(`Leave #${pendingLeave}`)
  })

  it('the type comes from the bytes, not the declared type', async () => {
    // Declared as JPEG, named .jpg, actually a PNG: stored as a PNG, named .png.
    const res = await upload(pendingLeave, { employee: empCookie }, PNG, 'photo.jpg', 'image/jpeg')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ content_type: 'image/png', filename: 'photo.png' })
  })

  it('an HTML file named .pdf is refused with 415 and nothing is stored', async () => {
    const html = new TextEncoder().encode('<html><script>fetch("/api/employees")</script></html>')
    const res = await upload(pendingLeave, { employee: empCookie }, html, 'certificate.pdf', 'application/pdf')
    expect(res.status).toBe(415)
    expect((await res.json()).error).toMatch(/PDF.*\/.*PDF/) // bilingual
    expect(await storedCount(pendingLeave)).toBe(0)
  })

  it('a file over 5 MB is refused with 413', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(PDF)
    const res = await upload(pendingLeave, { employee: empCookie }, big)
    expect(res.status).toBe(413)
    expect(await storedCount(pendingLeave)).toBe(0)
  })

  it('a body far over the cap is cut off while streaming, still 413', async () => {
    const huge = new Uint8Array(8 * 1024 * 1024)
    huge.set(PDF)
    const res = await upload(pendingLeave, { employee: empCookie }, huge)
    expect(res.status).toBe(413)
  })

  it('a declared Content-Length over the cap is refused before reading', async () => {
    const { POST } = await import('@/app/api/leaves/[id]/attachments/route')
    const req = new Request(`${BASE}/api/leaves/${pendingLeave}/attachments`, {
      method: 'POST',
      body: 'x',
      headers: {
        cookie: `emp-auth-token=${empCookie}`,
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(50 * 1024 * 1024),
      },
    })
    expect((await POST(req, routeParams({ id: String(pendingLeave) }))).status).toBe(413)
  })

  it('a request that is not multipart is refused', async () => {
    const { POST } = await import('@/app/api/leaves/[id]/attachments/route')
    const req = authedRequest(`${BASE}/api/leaves/${pendingLeave}/attachments`, { employee: empCookie }, {
      method: 'POST',
      body: JSON.stringify({ file: 'JVBERi0=' }),
    })
    expect((await POST(req, routeParams({ id: String(pendingLeave) }))).status).toBe(400)
  })

  it('at most 5 attachments per request', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await upload(pendingLeave, { employee: empCookie }, PDF, `c${i}.pdf`)).status).toBe(200)
    }
    const sixth = await upload(pendingLeave, { employee: empCookie }, PDF, 'c5.pdf')
    expect(sixth.status).toBe(409)
    // The cap holds for admins too.
    expect((await upload(pendingLeave, { admin: adminCookie })).status).toBe(409)
    expect(await storedCount(pendingLeave)).toBe(5)
  })

  it('the cap holds under concurrent uploads', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => upload(pendingLeave, { employee: empCookie }, PDF, `p${i}.pdf`))
    )
    expect(results.filter(r => r.status === 200)).toHaveLength(5)
    expect(await storedCount(pendingLeave)).toBe(5)
  })

  it('once decided, the employee can no longer add or remove; an admin still can', async () => {
    const first = await (await upload(pendingLeave, { employee: empCookie })).json()
    await pool.query("UPDATE leave_requests SET status = 'approved' WHERE id = $1", [pendingLeave])

    expect((await upload(pendingLeave, { employee: empCookie })).status).toBe(409)
    expect((await remove(first.id, { employee: empCookie })).status).toBe(409)
    // Still readable by the owner.
    expect((await list(pendingLeave, { employee: empCookie })).status).toBe(200)
    expect((await download(first.id, { employee: empCookie })).status).toBe(200)

    expect((await upload(pendingLeave, { admin: adminCookie })).status).toBe(200)
    expect((await remove(first.id, { admin: adminCookie })).status).toBe(200)
    expect(await storedCount(pendingLeave)).toBe(1)

    const audit = await pool.query("SELECT user_role FROM audit_log WHERE action = 'leave_attachment_deleted'")
    expect(audit.rows).toEqual([{ user_role: 'admin' }])
  })

  it('another employee cannot list, download, delete or add — and gets 404, not 403', async () => {
    const att = await (await upload(pendingLeave, { employee: empCookie })).json()
    const outsider = { employee: otherCookie }

    expect((await list(pendingLeave, outsider)).status).toBe(404)
    expect((await download(att.id, outsider)).status).toBe(404)
    expect((await remove(att.id, outsider)).status).toBe(404)
    expect((await upload(pendingLeave, outsider)).status).toBe(404)
    expect(await storedCount(pendingLeave)).toBe(1)

    // Indistinguishable from an id that does not exist.
    expect((await download(999999, outsider)).status).toBe(404)
    expect((await list(999999, outsider)).status).toBe(404)
    expect((await download(NaN, outsider)).status).toBe(404)

    // And no cookie at all is a 401 everywhere.
    expect((await list(pendingLeave, {})).status).toBe(401)
    expect((await download(att.id, {})).status).toBe(401)
    expect((await remove(att.id, {})).status).toBe(401)
    expect((await upload(pendingLeave, {})).status).toBe(401)
  })

  it('an admin can list, download and delete anyone’s attachments', async () => {
    const att = await (await upload(pendingLeave, { employee: empCookie })).json()

    const listed = await list(pendingLeave, { admin: adminCookie })
    expect(listed.status).toBe(200)
    const rows = await listed.json()
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('data')

    expect((await download(att.id, { admin: adminCookie })).status).toBe(200)
    expect((await remove(att.id, { admin: adminCookie })).status).toBe(200)
    expect(await storedCount(pendingLeave)).toBe(0)
  })

  it('the download carries safe headers, including for an Arabic file name', async () => {
    const att = await (await upload(pendingLeave, { employee: empCookie }, PDF, 'شهادة طبية.pdf')).json()
    expect(att.filename).toBe('شهادة طبية.pdf')

    const res = await download(att.id, { employee: empCookie })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-length')).toBe(String(PDF.byteLength))

    const cd = res.headers.get('content-disposition') || ''
    expect(cd.startsWith('attachment;')).toBe(true)
    expect(cd).not.toContain('inline')
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('شهادة طبية')}.pdf`)
    // The plain filename= fallback is ASCII-only, so the header itself is ASCII.
    expect(/^[\x20-\x7e]*$/.test(cd)).toBe(true)

    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), Buffer.from(PDF))).toBe(0)
  })

  it('attachments go when their leave is deleted', async () => {
    await upload(pendingLeave, { employee: empCookie })
    await upload(pendingLeave, { employee: empCookie })
    expect(await storedCount(pendingLeave)).toBe(2)

    const { DELETE } = await import('@/app/api/leaves/[id]/route')
    const res = await DELETE(
      authedRequest(`${BASE}/api/leaves/${pendingLeave}`, { employee: empCookie }, { method: 'DELETE' }),
      routeParams({ id: String(pendingLeave) })
    )
    expect(res.status).toBe(200)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM leave_attachments')
    expect(rows[0].c).toBe(0)
  })

  it('attachment_count is on admin and owner views, and absent from the colleague view', async () => {
    await upload(pendingLeave, { employee: empCookie })
    await upload(pendingLeave, { employee: empCookie })
    // A colleague's approved leave with a certificate: visible to me as "who's away", but
    // whether it came with a certificate is not mine to know.
    const theirs = await leaveFor(other, 'approved', '2026-11-20')
    expect((await upload(theirs, { admin: adminCookie })).status).toBe(200)

    const { GET: listLeaves } = await import('@/app/api/leaves/route')
    const adminRows = await (await listLeaves(authedRequest(`${BASE}/api/leaves`, { admin: adminCookie }))).json()
    expect(adminRows.find((r: { id: number }) => r.id === pendingLeave).attachment_count).toBe(2)
    expect(adminRows.find((r: { id: number }) => r.id === theirs).attachment_count).toBe(1)

    const { GET: myRequests } = await import('@/app/api/leaves/my-requests/route')
    const mine = await (await myRequests(authedRequest(`${BASE}/api/leaves/my-requests?employee_id=${me}`, { employee: empCookie }))).json()
    expect(mine).toHaveLength(1)
    expect(mine[0].attachment_count).toBe(2)

    const colleagueView = await (await listLeaves(authedRequest(`${BASE}/api/leaves`, { employee: empCookie }))).json()
    expect(colleagueView).toHaveLength(1)
    expect(colleagueView[0]).not.toHaveProperty('attachment_count')
    expect(colleagueView[0]).not.toHaveProperty('employee_id')
  })

  it('uploads are rate limited per user', async () => {
    // Uploads to a leave the caller cannot see still count: the limit is spent before
    // anything else is looked at.
    const theirs = await leaveFor(other, 'pending', '2026-11-20')
    for (let i = 0; i < 20; i++) {
      expect((await upload(theirs, { employee: empCookie })).status).toBe(404)
    }
    expect((await upload(pendingLeave, { employee: empCookie })).status).toBe(429)
    // Someone else is unaffected.
    expect((await upload(theirs, { employee: otherCookie })).status).toBe(200)
  })
})
