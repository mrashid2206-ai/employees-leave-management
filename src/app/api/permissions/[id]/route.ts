import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, verifyAdmin, unauthorized } from '@/lib/api-auth'

// Update permission (mark return time, or approve)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params
  const body = await request.json()

  if (body.return_time) {
    // Employee marking their return
    await pool.query('UPDATE permissions SET return_time = $1 WHERE id = $2', [body.return_time, id])
  }
  if (body.status) {
    // Admin approving/rejecting
    const admin = await verifyAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    await pool.query('UPDATE permissions SET status = $1, approved_by = $2 WHERE id = $3', [body.status, admin.username, id])
  }

  const { rows } = await pool.query('SELECT * FROM permissions WHERE id = $1', [id])
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  await pool.query('DELETE FROM permissions WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
