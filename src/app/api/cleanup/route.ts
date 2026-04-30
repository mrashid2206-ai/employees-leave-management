import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const results: string[] = []

  try {
    // 1. Remove duplicate leave types (keep lowest ID for each name_en)
    const { rows: ltDups } = await pool.query(`
      DELETE FROM leave_types WHERE id NOT IN (
        SELECT MIN(id) FROM leave_types GROUP BY name_en
      ) RETURNING id, name_en
    `)
    results.push(`Deleted ${ltDups.length} duplicate leave types: ${ltDups.map(r => `#${r.id} ${r.name_en}`).join(', ')}`)

    // 2. Remove duplicate holidays (keep lowest ID for each date)
    const { rows: holDups } = await pool.query(`
      DELETE FROM holidays WHERE id NOT IN (
        SELECT MIN(id) FROM holidays GROUP BY date
      ) RETURNING id, name
    `)
    results.push(`Deleted ${holDups.length} duplicate holidays: ${holDups.map(r => `#${r.id} ${r.name}`).join(', ')}`)

    // 3. Remove duplicate settings (keep id=1 or lowest)
    const { rows: settingsRows } = await pool.query('SELECT id FROM settings ORDER BY id')
    if (settingsRows.length > 1) {
      const keepId = settingsRows[0].id
      const { rowCount } = await pool.query('DELETE FROM settings WHERE id != $1', [keepId])
      results.push(`Deleted ${rowCount} duplicate settings rows (kept id=${keepId})`)
    } else {
      results.push('Settings: no duplicates')
    }

    // 4. Update any leave requests referencing deleted leave type IDs
    // Map old IDs to new IDs
    const { rows: currentTypes } = await pool.query('SELECT id, name_en FROM leave_types ORDER BY id')
    const typeMap: Record<string, number> = {}
    currentTypes.forEach(t => { typeMap[t.name_en] = t.id })

    // Fix leave requests that reference non-existent leave types
    const { rows: badLeaves } = await pool.query(`
      SELECT lr.id, lr.leave_type_id FROM leave_requests lr
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE lt.id IS NULL
    `)
    for (const bl of badLeaves) {
      // Default to Annual (first type)
      const defaultId = currentTypes[0]?.id || 1
      await pool.query('UPDATE leave_requests SET leave_type_id = $1 WHERE id = $2', [defaultId, bl.id])
    }
    results.push(`Fixed ${badLeaves.length} leave requests with invalid type IDs`)

    // 5. Summary
    const { rows: finalTypes } = await pool.query('SELECT COUNT(*) as cnt FROM leave_types')
    const { rows: finalHols } = await pool.query('SELECT COUNT(*) as cnt FROM holidays')
    const { rows: finalSettings } = await pool.query('SELECT COUNT(*) as cnt FROM settings')
    results.push(`Final counts: ${finalTypes[0].cnt} leave types, ${finalHols[0].cnt} holidays, ${finalSettings[0].cnt} settings`)

    return NextResponse.json({ success: true, fixes: results })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, completedSteps: results }, { status: 500 })
  }
}
