import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { ensureAttendanceLocationColumns } from '@/lib/ensure-schema'
import { isOffDay, computeWorkHours, computeOvertime } from '@/lib/attendance-calc'
import { reverseAutoAbsenceLeave } from '@/lib/auto-absence'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM format
  // Employees may only read their own attendance; admins may filter by any employee.
  const employeeId = user.role === 'employee' ? String(user.id) : searchParams.get('employee_id')

  await ensureAttendanceLocationColumns().catch(() => {})

  let query = `
    SELECT a.id, a.employee_id, a.date::text as date, a.check_in::text as check_in,
      a.check_out::text as check_out, a.work_hours, a.overtime_hours, a.status, a.notes, a.is_holiday_work, a.excused_tardiness, a.is_offsite, a.check_in_ip,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee
    FROM attendance a
    LEFT JOIN employees e ON a.employee_id = e.id
  `
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (month) {
    const [y, m] = month.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    params.push(`${month}-01`)
    params.push(`${month}-${lastDay}`)
    conditions.push(`a.date >= $${params.length - 1} AND a.date <= $${params.length}`)
  }
  if (employeeId) {
    params.push(employeeId)
    conditions.push(`a.employee_id = $${params.length}`)
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
  query += ' ORDER BY a.date DESC, a.employee_id'

  const { rows } = await pool.query(query, params)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const body = await request.json()
  const records = Array.isArray(body) ? body : [body]

  const { rows: settingsRows } = await pool.query('SELECT work_hours_per_day FROM settings ORDER BY id LIMIT 1')
  const normalHours = settingsRows[0]?.work_hours_per_day || 8

  const allowedStatuses = new Set(['present', 'absent', 'leave', 'holiday'])
  const results = []
  for (const r of records) {
    if (!r.employee_id || !r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      return NextResponse.json({ error: 'Invalid attendance record (employee_id and YYYY-MM-DD date required)' }, { status: 400 })
    }
    const status = allowedStatuses.has(r.status) ? r.status : 'present'

    // Same overnight/holiday-aware work-hours math as the self-service check-out path.
    const holidayWork = await isOffDay(r.date)
    let workHours = 0
    if (r.check_in && r.check_out) {
      workHours = computeWorkHours(r.check_in, r.check_out) ?? 0
    }
    const overtime = computeOvertime(workHours, normalHours, holidayWork)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // If this record currently exists as 'absent' and is being changed to a non-absent
      // status, refund the auto-deducted absence leave so the day isn't lost.
      const { rows: prev } = await client.query('SELECT status FROM attendance WHERE employee_id = $1 AND date = $2', [r.employee_id, r.date])
      const wasAbsent = prev[0]?.status === 'absent'

      const { rows } = await client.query(`
        INSERT INTO attendance (employee_id, date, check_in, check_out, work_hours, overtime_hours, status, notes, is_holiday_work)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (employee_id, date) DO UPDATE SET
          check_in = COALESCE($3, attendance.check_in),
          check_out = COALESCE($4, attendance.check_out),
          work_hours = $5,
          overtime_hours = $6,
          status = $7,
          notes = $8,
          is_holiday_work = $9
        RETURNING *
      `, [r.employee_id, r.date, r.check_in || null, r.check_out || null, workHours, overtime, status, r.notes || null, holidayWork])

      if (wasAbsent && status !== 'absent') {
        await reverseAutoAbsenceLeave(client, r.employee_id, r.date)
      }

      await client.query('COMMIT')
      results.push(rows[0])
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  return NextResponse.json(results)
}
