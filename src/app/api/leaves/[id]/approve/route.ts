import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const { status } = await request.json()

  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Use transaction to prevent race condition
  const client = await pool.connect()
  let rows: any[]
  let currentLeave: any
  let previousStatus: string
  try {
    await client.query('BEGIN')

    // Lock the leave request to prevent double approval
    const { rows: lockedLeave } = await client.query('SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE', [id])
    if (lockedLeave.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    currentLeave = lockedLeave[0]
    previousStatus = currentLeave.status

    // Prevent re-applying same status
    if (currentLeave.status === status) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Already in this status' }, { status: 400 })
    }

    // Valid transitions: pending→approved, pending→rejected, approved→rejected, approved→pending, rejected→pending
    const validTransitions: Record<string, string[]> = {
      'pending': ['approved', 'rejected'],
      'approved': ['rejected', 'pending'],
      'rejected': ['pending'],
      'cancelled': [], // Can't change cancelled
    }
    if (!validTransitions[previousStatus]?.includes(status)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: `Cannot change from ${previousStatus} to ${status}` }, { status: 400 })
    }

    // Lock the employee row
    const { rows: empRows } = await client.query(
      'SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE',
      [currentLeave.employee_id]
    )

    if (status === 'approved' && previousStatus !== 'approved') {
      if (empRows[0] && empRows[0].leave_balance < currentLeave.days_count) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Insufficient leave balance' }, { status: 400 })
      }
    }

    // Update leave status
    const result = await client.query(
      'UPDATE leave_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    )
    rows = result.rows

    // Deduct/restore balance
    if (status === 'approved' && previousStatus !== 'approved') {
      await client.query('UPDATE employees SET leave_balance = leave_balance - $1 WHERE id = $2', [currentLeave.days_count, currentLeave.employee_id])
    } else if (previousStatus === 'approved' && status !== 'approved') {
      await client.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [currentLeave.days_count, currentLeave.employee_id])
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await logAudit('leave_status_change', admin.username, 'admin', `Leave #${id} changed to ${status} for emp ${currentLeave.employee_id}`)

  // Notify employee via in-app notification
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_notifications (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL,
        message TEXT NOT NULL,
        message_ar TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {})

    const statusEn = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'updated'
    const statusAr = status === 'approved' ? 'تمت الموافقة' : status === 'rejected' ? 'تم الرفض' : 'تم التحديث'

    await pool.query(
      'INSERT INTO employee_notifications (employee_id, message, message_ar) VALUES ($1, $2, $3)',
      [
        currentLeave.employee_id,
        `Your leave request (${currentLeave.start_date} to ${currentLeave.end_date}) has been ${statusEn}`,
        `طلب إجازتك (${currentLeave.start_date} إلى ${currentLeave.end_date}) ${statusAr}`
      ]
    )
  } catch {}

  // Try to send email notification (non-blocking)
  try {
    const leave = rows[0]
    const { rows: empRows } = await pool.query('SELECT name FROM employees WHERE id = $1', [leave.employee_id])
    const empName = empRows[0]?.name || 'Employee'

    const statusText = status === 'approved' ? 'Approved ✅' : status === 'rejected' ? 'Rejected ❌' : 'Pending ⏳'
    const statusAr = status === 'approved' ? 'موافق عليها ✅' : status === 'rejected' ? 'مرفوضة ❌' : 'معلقة ⏳'

    // Fire and forget — don't block the response
    fetch(new URL('/api/notify', request.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject: `Leave Request ${statusText} - ${empName}`,
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1976D2;">Leave Request Update / تحديث طلب إجازة</h2>
            <p><strong>${empName}</strong></p>
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <tr><td style="padding: 8px; border: 1px solid #ddd;">Status / الحالة</td><td style="padding: 8px; border: 1px solid #ddd;"><strong>${statusAr} / ${statusText}</strong></td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">From / من</td><td style="padding: 8px; border: 1px solid #ddd;">${leave.start_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">To / إلى</td><td style="padding: 8px; border: 1px solid #ddd;">${leave.end_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">Days / أيام</td><td style="padding: 8px; border: 1px solid #ddd;">${leave.days_count}</td></tr>
            </table>
            <p style="color: #666; font-size: 12px;">Leave & Tardiness Management System</p>
          </div>
        `,
      }),
    }).catch(() => {})
  } catch {
    // Email failure shouldn't block the approval
  }

  return NextResponse.json(rows[0])
}
