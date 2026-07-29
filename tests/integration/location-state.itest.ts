import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { omanToday } from '@/lib/oman-date'
import { HAS_TEST_DB, resetDb, closePool, employeeToken, authedRequest } from './helpers'

// Only GPS may place someone off-site. A check-in with no coordinates from an address that
// is not the office is 'unverified' — location unknown — because mobile data hands out a
// different IP every time, so an employee at their own desk on 4G is indistinguishable
// from one at home. In production that mistake accounted for 89 of 150 "off-site" rows.
describe.skipIf(!HAS_TEST_DB)('location state', () => {
  const BASE = 'http://localhost'
  const OFFICE = { lat: 23.588, lng: 58.3829 }
  const OFFICE_IP = '37.41.254.202'
  let empId: number
  let empCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    empCookie = await employeeToken(empId)
    await pool.query(
      'UPDATE settings SET office_lat = $1, office_lng = $2, office_radius = 100, office_ip = $3',
      [OFFICE.lat, OFFICE.lng, OFFICE_IP]
    )
  })

  afterAll(async () => {
    await closePool()
  })

  const checkIn = (opts: { coords?: { lat: number; lng: number }; ip?: string } = {}) =>
    import('@/app/api/attendance/check-in/route').then(({ POST }) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (opts.ip) headers['x-forwarded-for'] = opts.ip
      return POST(
        authedRequest(`${BASE}/api/attendance/check-in`, { employee: empCookie }, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            employee_id: empId,
            action: 'check-in',
            latitude: opts.coords?.lat ?? null,
            longitude: opts.coords?.lng ?? null,
          }),
        })
      )
    })

  const stateOf = async () => {
    const { rows } = await pool.query(
      'SELECT check_in_location, is_offsite FROM attendance WHERE employee_id = $1 AND date = $2',
      [empId, omanToday()]
    )
    return rows[0]
  }

  it('GPS inside the radius is on-site', async () => {
    await checkIn({ coords: OFFICE, ip: '9.9.9.9' })
    const row = await stateOf()
    expect(row.check_in_location).toBe('onsite')
    expect(row.is_offsite).toBe(false)
  })

  it('GPS outside the radius is confirmed off-site', async () => {
    // Salalah, ~1000 km away.
    await checkIn({ coords: { lat: 17.0197, lng: 54.0897 }, ip: OFFICE_IP })
    const row = await stateOf()
    expect(row.check_in_location).toBe('offsite')
    expect(row.is_offsite).toBe(true)
  })

  it('the office IP confirms on-site when no coordinates arrive', async () => {
    await checkIn({ ip: OFFICE_IP })
    const row = await stateOf()
    expect(row.check_in_location).toBe('onsite')
    expect(row.is_offsite).toBe(false)
  })

  it('no coordinates and a different IP is UNVERIFIED, not off-site', async () => {
    // The regression this whole change is about: mobile data at your own desk.
    await checkIn({ ip: '37.40.135.21' })
    const row = await stateOf()
    expect(row.check_in_location).toBe('unverified')
    expect(row.is_offsite).toBe(false)
  })

  it('never notifies the employee for an unverified location', async () => {
    await checkIn({ ip: '37.40.135.21' })
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM employee_notifications WHERE employee_id = $1',
      [empId]
    )
    // Accusing someone because their phone gave no fix is exactly what to avoid.
    expect(rows[0].n).toBe(0)
  })

  it('does notify when GPS confirms they were elsewhere', async () => {
    await checkIn({ coords: { lat: 17.0197, lng: 54.0897 } })
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM employee_notifications WHERE employee_id = $1',
      [empId]
    )
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('is on-site when no geofence is configured at all', async () => {
    await pool.query('UPDATE settings SET office_lat = NULL, office_lng = NULL, office_ip = NULL')
    await checkIn({ ip: '9.9.9.9' })
    const row = await stateOf()
    expect(row.check_in_location).toBe('onsite')
    expect(row.is_offsite).toBe(false)
  })

  it('GPS beats a matching IP — a spoofed address cannot claim presence', async () => {
    await checkIn({ coords: { lat: 17.0197, lng: 54.0897 }, ip: OFFICE_IP })
    expect((await stateOf()).check_in_location).toBe('offsite')
  })
})
