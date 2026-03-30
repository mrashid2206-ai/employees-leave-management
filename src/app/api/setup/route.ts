import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import bcrypt from 'bcryptjs'

// One-time setup endpoint: hashes all placeholder passwords
// Visit /api/setup once after deployment, then delete this file
export async function GET() {
  try {
    const hash = await bcrypt.hash('123456', 10)
    const { rowCount } = await pool.query(
      "UPDATE employees SET password_hash = $1 WHERE password_hash LIKE '$2a$10$placeholder%' OR password_hash = '123456'",
      [hash]
    )

    // Also generate usernames for employees that don't have one
    await pool.query(`
      UPDATE employees SET username = LOWER(REPLACE(REPLACE(name, ' ', '.'), '''', ''))
      WHERE username IS NULL
    `)

    return NextResponse.json({
      success: true,
      passwordsUpdated: rowCount,
      defaultPassword: '123456',
      message: 'Setup complete. Delete /api/setup route after use.'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
