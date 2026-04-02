import pool from '@/lib/db'

export async function logAudit(action: string, userId: string, role: string, details: string) {
  try {
    await pool.query(
      'INSERT INTO audit_log (action, user_id, user_role, details, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [action, userId, role, details]
    )
  } catch {
    // Don't let audit failures break the app
    console.error('Audit log failed:', action, details)
  }
}
