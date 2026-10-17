import { describe, it, expect, vi, afterEach } from 'vitest'
import { logger } from '@/lib/log'

function lastErrorLine(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(spy.mock.calls.at(-1)![0] as string)
}

describe('logger.error', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes the stack for an Error, so the log says where it happened', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('connection terminated')
    logger.error('query failed', err, { route: '/api/x' })
    const entry = lastErrorLine(spy)
    expect(entry).toMatchObject({ level: 'error', msg: 'query failed', route: '/api/x', error: 'connection terminated' })
    expect(entry.stack).toBe(err.stack)
    expect(entry.stack).toContain('log.test.ts')
  })

  it('stringifies non-Error values and adds no stack', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('odd failure', 'just a string')
    const entry = lastErrorLine(spy)
    expect(entry.error).toBe('just a string')
    expect(entry).not.toHaveProperty('stack')
  })

  it('works with no error at all', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('something happened')
    expect(lastErrorLine(spy).msg).toBe('something happened')
  })
})
