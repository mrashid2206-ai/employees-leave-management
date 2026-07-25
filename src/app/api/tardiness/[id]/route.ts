import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params


  // Refund the leave that this tardiness deducted (if any), atomically with the delete.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'SELECT employee_id, COALESCE(leave_deducted, 0) AS leave_deducted FROM tardiness_log WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: true })
    }
    const { employee_id, leave_deducted } = rows[0]
    await client.query('DELETE FROM tardiness_log WHERE id = $1', [id])
    const refund = parseFloat(String(leave_deducted))
    if (refund > 0) {
      await client.query('UPDATE employees SET leave_balance = leave_balance + $1, updated_at = NOW() WHERE id = $2', [refund, employee_id])
    }
    await client.query('COMMIT')
    return NextResponse.json({ success: true, refunded: refund })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
