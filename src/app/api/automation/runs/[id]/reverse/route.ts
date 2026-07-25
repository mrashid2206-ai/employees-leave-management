import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { reverseRun } from '@/lib/automation-journal'
import { logAudit } from '@/lib/audit'

// Undo an automation run. Admin-only, and itself audited — undoing a payroll-adjacent
// job is exactly the kind of action you want a trail for.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const { id } = await params
  const runId = Number(id)
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }

  const outcome = await reverseRun(runId, { username: admin.username, role: 'admin' })
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.message }, { status: outcome.status })
  }

  await logAudit(
    'automation_reversed',
    admin.username || 'admin',
    'admin',
    `Undid automation run #${runId}: ${JSON.stringify(outcome.reversed)}`
  )

  return NextResponse.json({ success: true, ...outcome })
}
