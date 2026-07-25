import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()


  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100')
  return NextResponse.json(rows)
}
