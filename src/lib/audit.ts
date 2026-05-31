import pool from '@/lib/db'

let auditTableReady: Promise<void> | null = null

// Create the audit_log table on first use (once per process). Previously the
// table was only created lazily inside GET /api/audit, so every audit write made
// before an admin opened the audit page silently failed on a fresh database.
export function ensureAuditTable(): Promise<void> {
  if (!auditTableReady) {
    auditTableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id SERIAL PRIMARY KEY,
          action VARCHAR(100) NOT NULL,
          user_id VARCHAR(100),
          user_role VARCHAR(20),
          details TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      .then(() => {})
      .catch((e) => {
        auditTableReady = null
        throw e
      })
  }
  return auditTableReady
}

export async function logAudit(action: string, userId: string, role: string, details: string) {
  try {
    await ensureAuditTable()
    await pool.query(
      'INSERT INTO audit_log (action, user_id, user_role, details, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [action, userId, role, details]
    )
  } catch {
    // Don't let audit failures break the app
    console.error('Audit log failed:', action, details)
  }
}
