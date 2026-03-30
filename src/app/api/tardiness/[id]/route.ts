import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await pool.query('DELETE FROM tardiness_log WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
