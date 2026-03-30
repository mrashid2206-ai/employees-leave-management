import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  const { rows } = await pool.query('SELECT * FROM departments ORDER BY id')
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const { name } = await request.json()
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const { rows } = await pool.query(
    'INSERT INTO departments (name) VALUES ($1) RETURNING *',
    [name]
  )
  return NextResponse.json(rows[0])
}
