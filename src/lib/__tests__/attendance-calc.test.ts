import { describe, it, expect } from 'vitest'
import { computeWorkHours, computeOvertime, getDistanceMeters, evaluateLocation } from '@/lib/attendance-calc'

describe('computeWorkHours', () => {
  it('computes a normal day', () => {
    expect(computeWorkHours('08:00', '16:00')).toBe(8)
  })
  it('handles a half-hour', () => {
    expect(computeWorkHours('08:00', '08:30')).toBe(0.5)
  })
  it('wraps a genuine overnight shift (+24h)', () => {
    expect(computeWorkHours('22:00', '02:00')).toBe(4)
  })
  it('rejects a zero-length shift', () => {
    expect(computeWorkHours('08:00', '08:00')).toBeNull()
  })
  it('rejects an implausibly long shift (> MAX_SHIFT_HOURS) instead of inflating', () => {
    // 08:00 -> 06:00 wraps to 22h, beyond the 16h cap.
    expect(computeWorkHours('08:00', '06:00')).toBeNull()
  })
})

describe('computeOvertime', () => {
  it('counts hours above normal on a normal day', () => {
    expect(computeOvertime(10, 8, false)).toBe(2)
  })
  it('never goes negative', () => {
    expect(computeOvertime(6, 8, false)).toBe(0)
  })
  it('treats all hours as overtime on a holiday', () => {
    expect(computeOvertime(5, 8, true)).toBe(5)
  })
})

describe('getDistanceMeters', () => {
  it('is zero for the same point', () => {
    expect(getDistanceMeters(23.58, 58.38, 23.58, 58.38)).toBe(0)
  })
  it('grows with separation', () => {
    const near = getDistanceMeters(23.58, 58.38, 23.5801, 58.3801)
    const far = getDistanceMeters(23.58, 58.38, 23.59, 58.39)
    expect(near).toBeLessThan(far)
    expect(near).toBeGreaterThan(0)
  })
})

describe('evaluateLocation', () => {
  const office = { office_lat: 23.58, office_lng: 58.38, office_radius: 200, office_ip: '1.2.3.4' }

  it('is on-site when nothing is configured', () => {
    expect(evaluateLocation({ office_lat: null, office_lng: null, office_radius: null, office_ip: null }, null, null, 'unknown'))
      .toEqual({ configured: false, state: 'onsite' })
  })

  it('is on-site for GPS within the radius', () => {
    expect(evaluateLocation(office, 23.5801, 58.3801, 'unknown').state).toBe('onsite')
  })

  it('is off-site for GPS outside the radius', () => {
    expect(evaluateLocation(office, 23.70, 58.50, 'unknown').state).toBe('offsite')
  })

  it('GPS is authoritative — a spoofed matching IP cannot override a failing GPS check', () => {
    // Coordinates far from the office but the (spoofable) IP matches: still off-site.
    expect(evaluateLocation(office, 23.70, 58.50, '1.2.3.4').state).toBe('offsite')
  })

  // The asymmetry that matters. Matching the office IP proves presence on their network;
  // NOT matching it proves nothing, because mobile data issues a different address every
  // time — an employee at their desk on 4G looked identical to one at home, which made 89
  // of 150 production "off-site" rows unsubstantiated.
  describe('without coordinates', () => {
    it('the office IP confirms on-site', () => {
      expect(evaluateLocation(office, null, null, '1.2.3.4').state).toBe('onsite')
    })

    it('a different IP is UNVERIFIED, never off-site', () => {
      expect(evaluateLocation(office, null, null, '9.9.9.9').state).toBe('unverified')
    })

    it('an unknown IP is unverified', () => {
      expect(evaluateLocation(office, null, null, 'unknown').state).toBe('unverified')
    })

    it('only GPS can put someone off-site', () => {
      // No combination of missing coordinates and a strange IP yields 'offsite'.
      for (const ip of ['9.9.9.9', 'unknown', '']) {
        expect(evaluateLocation(office, null, null, ip).state).not.toBe('offsite')
      }
    })
  })

  it('IP-only config: matches on-site, anything else unverified', () => {
    const ipOnly = { office_lat: null, office_lng: null, office_radius: null, office_ip: '1.2.3.4' }
    expect(evaluateLocation(ipOnly, null, null, '1.2.3.4').state).toBe('onsite')
    expect(evaluateLocation(ipOnly, null, null, '9.9.9.9').state).toBe('unverified')
    expect(evaluateLocation(ipOnly, null, null, 'unknown').state).toBe('unverified')
  })
})
