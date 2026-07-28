import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { reverseAutoAbsenceLeave, applyAutoAbsenceLeave } from '@/lib/auto-absence'
import { parseBody } from '@/server/validation'
import { attendanceUpdateSchema } from '@/server/schemas'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const valid = parseBody(attendanceUpdateSchema, await request.json())
  if (!valid.ok) return valid.response
  const body = valid.data as Record<string, unknown>
  const allowedFields = ['check_in', 'check_out', 'work_hours', 'overtime_hours', 'status', 'notes', 'is_holiday_work', 'excused_tardiness']
  const fields = Object.keys(body).filter(k => allowedFields.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Flipping a day into or out of 'absent' must move the balance both ways. Only the
    // refund existed before, so marking someone absent by hand cost them nothing.
    let refundedDays = 0
    let chargedDays = 0
    if (typeof body.status === 'string') {
      const { rows: cur } = await client.query('SELECT employee_id, date::text as date, status FROM attendance WHERE id = $1', [id])
      if (cur[0]) {
        const wasAbsent = cur[0].status === 'absent'
        if (wasAbsent && body.status !== 'absent') {
          refundedDays = await reverseAutoAbsenceLeave(client, cur[0].employee_id, cur[0].date)
        } else if (!wasAbsent && body.status === 'absent') {
          const applied = await applyAutoAbsenceLeave(client, cur[0].employee_id, cur[0].date)
          chargedDays = applied?.days ?? 0
        }
      }
    }

    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
    const values = [id, ...fields.map(f => body[f])]
    const { rows } = await client.query(`UPDATE attendance SET ${sets} WHERE id = $1 RETURNING *`, values)

    await client.query('COMMIT')
    if (refundedDays > 0) {
      await logAudit('absence_corrected', admin.username, 'admin', `Attendance #${id} set to ${body.status}; refunded ${refundedDays} auto-deducted leave day(s)`)
    }
    if (chargedDays > 0) {
      await logAudit('absence_charged', admin.username, 'admin', `Attendance #${id} set to absent; deducted ${chargedDays} leave day(s)`)
    }
    return NextResponse.json({ ...rows[0], refundedDays, chargedDays })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: cur } = await client.query('SELECT employee_id, date::text as date, status FROM attendance WHERE id = $1', [id])
    if (cur.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: true })
    }

    await client.query('DELETE FROM attendance WHERE id = $1', [id])

    // Deleting an absence undoes it — refund the auto-deducted leave day too.
    let refundedDays = 0
    if (cur[0].status === 'absent') {
      refundedDays = await reverseAutoAbsenceLeave(client, cur[0].employee_id, cur[0].date)
    }

    await client.query('COMMIT')
    if (refundedDays > 0) {
      await logAudit('absence_deleted', admin.username, 'admin', `Deleted absence #${id}; refunded ${refundedDays} auto-deducted leave day(s)`)
    }
    return NextResponse.json({ success: true, refundedDays })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
