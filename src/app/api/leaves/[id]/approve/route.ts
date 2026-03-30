import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { status } = await request.json()

  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { rows } = await pool.query(
    'UPDATE leave_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, id]
  )

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
