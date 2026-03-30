import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { name, date } = await request.json()
  const { rows } = await pool.query(
    'UPDATE holidays SET name = $1, date = $2 WHERE id = $3 RETURNING id, name, date::text as date',
    [name, date, id]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await pool.query('DELETE FROM holidays WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
