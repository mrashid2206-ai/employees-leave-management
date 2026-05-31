import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { ensureUniqueConstraints } from '@/lib/ensure-schema'
import { LEAVE_TYPE_ANNUAL } from '@/lib/constants'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const results: string[] = []
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // 1. Remap leave_requests off duplicate type ids (keep lowest id per name), then delete dups.
    const { rows: allTypes } = await client.query('SELECT id, name_en FROM leave_types ORDER BY id')
    const typeNameToMinId: Record<string, number> = {}
    allTypes.forEach(t => {
      if (!typeNameToMinId[t.name_en]) typeNameToMinId[t.name_en] = t.id
    })
    for (const lt of allTypes) {
      const minId = typeNameToMinId[lt.name_en]
      if (lt.id !== minId) {
        const { rowCount } = await client.query('UPDATE leave_requests SET leave_type_id = $1 WHERE leave_type_id = $2', [minId, lt.id])
        if (rowCount && rowCount > 0) results.push(`Remapped ${rowCount} leave requests from type #${lt.id} to #${minId}`)
      }
    }
    const { rows: ltDups } = await client.query(`
      DELETE FROM leave_types WHERE id NOT IN (
        SELECT MIN(id) FROM leave_types GROUP BY name_en
      ) RETURNING id, name_en
    `)
    results.push(`Deleted ${ltDups.length} duplicate leave types`)

    // 2. Remove duplicate holidays (keep lowest id for each date)
    const { rows: holDups } = await client.query(`
      DELETE FROM holidays WHERE id NOT IN (
        SELECT MIN(id) FROM holidays GROUP BY date
      ) RETURNING id, name
    `)
    results.push(`Deleted ${holDups.length} duplicate holidays`)

    // 3. Remove duplicate settings (keep lowest id)
    const { rows: settingsRows } = await client.query('SELECT id FROM settings ORDER BY id')
    if (settingsRows.length > 1) {
      const keepId = settingsRows[0].id
      const { rowCount } = await client.query('DELETE FROM settings WHERE id != $1', [keepId])
      results.push(`Deleted ${rowCount} duplicate settings rows (kept id=${keepId})`)
    } else {
      results.push('Settings: no duplicates')
    }

    // 4. Repoint any leave requests referencing a now-missing type to Annual (by name, not position).
    const { rows: currentTypes } = await client.query('SELECT id, name_en FROM leave_types ORDER BY id')
    const annual = currentTypes.find(t => t.name_en === LEAVE_TYPE_ANNUAL)
    const defaultTypeId = annual?.id || currentTypes[0]?.id
    if (defaultTypeId) {
      const { rowCount } = await client.query(`
        UPDATE leave_requests SET leave_type_id = $1
        WHERE leave_type_id NOT IN (SELECT id FROM leave_types)
      `, [defaultTypeId])
      results.push(`Fixed ${rowCount || 0} leave requests with invalid type IDs`)
    }

    await client.query('COMMIT')

    // 5. Lock in uniqueness now that duplicates are gone (best-effort, outside the txn).
    await ensureUniqueConstraints().catch(() => {})

    const { rows: finalTypes } = await pool.query('SELECT COUNT(*) as cnt FROM leave_types')
    const { rows: finalHols } = await pool.query('SELECT COUNT(*) as cnt FROM holidays')
    const { rows: finalSettings } = await pool.query('SELECT COUNT(*) as cnt FROM settings')
    results.push(`Final counts: ${finalTypes[0].cnt} leave types, ${finalHols[0].cnt} holidays, ${finalSettings[0].cnt} settings`)

    return NextResponse.json({ success: true, fixes: results })
  } catch {
    await client.query('ROLLBACK')
    return NextResponse.json({ success: false, error: 'Cleanup failed and was rolled back', completedSteps: results }, { status: 500 })
  } finally {
    client.release()
  }
}
