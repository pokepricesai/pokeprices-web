// src/lib/editorial/__tests__/projects.test.ts
//
// EIC Block 2 — unit tests for the shared editorial helpers.

import { describe, it, expect, vi } from 'vitest'

// projects.ts imports 'server-only'.
vi.mock('server-only', () => ({}))

import {
  pickWritableProjectFields,
  validateProjectWrite,
  currentWeekWindowUtc,
  isThisWeek,
  EDITORIAL_STATUSES,
  EDITORIAL_ARTICLE_TYPES,
} from '../projects'

describe('pickWritableProjectFields', () => {
  it('keeps writable columns and drops server-controlled ones', () => {
    const out = pickWritableProjectFields({
      title: 'x', status: 'idea', priority: 3,
      id: 42, created_at: 'bad', updated_at: 'bad',
      random: 'nope',
    } as any)
    expect(out).toEqual({ title: 'x', status: 'idea', priority: 3 })
  })
})

describe('validateProjectWrite', () => {
  it('accepts a minimal payload', () => {
    expect(validateProjectWrite({ title: 'A good idea' })).toBeNull()
  })
  it('rejects unknown status', () => {
    expect(validateProjectWrite({ status: 'weird' } as any)).toMatch(/status/)
  })
  it('rejects unknown article_type', () => {
    expect(validateProjectWrite({ article_type: 'weird' } as any)).toMatch(/article_type/)
  })
  it('accepts every declared status + type', () => {
    for (const s of EDITORIAL_STATUSES) expect(validateProjectWrite({ status: s } as any)).toBeNull()
    for (const t of EDITORIAL_ARTICLE_TYPES) expect(validateProjectWrite({ article_type: t } as any)).toBeNull()
  })
  it('rejects out-of-range priority', () => {
    expect(validateProjectWrite({ priority: 0 } as any)).toMatch(/priority/)
    expect(validateProjectWrite({ priority: 6 } as any)).toMatch(/priority/)
    expect(validateProjectWrite({ priority: 2.5 } as any)).toMatch(/priority/)
  })
  it('rejects bad target_publish_at', () => {
    expect(validateProjectWrite({ target_publish_at: '2026/09/06' } as any)).toMatch(/target_publish_at/)
    expect(validateProjectWrite({ target_publish_at: '1999-01-01' } as any)).toMatch(/year/)
  })
  it('accepts null target_publish_at', () => {
    expect(validateProjectWrite({ target_publish_at: null } as any)).toBeNull()
  })
  it('rejects malformed insights_id', () => {
    expect(validateProjectWrite({ insights_id: 'not-a-uuid' } as any)).toMatch(/insights_id/)
  })
  it('accepts null insights_id', () => {
    expect(validateProjectWrite({ insights_id: null } as any)).toBeNull()
  })
  it('rejects empty title string', () => {
    expect(validateProjectWrite({ title: '   ' } as any)).toMatch(/title/)
  })
})

describe('currentWeekWindowUtc', () => {
  it('produces a Monday–Sunday window covering 7 days', () => {
    // Pick a known Wednesday in UTC (2026-09-02 was a Wednesday).
    const w = currentWeekWindowUtc(new Date('2026-09-02T12:00:00Z'))
    expect(w.startIso).toBe('2026-08-31') // Monday
    expect(w.endIso).toBe('2026-09-06')   // Sunday
  })
  it('treats Sunday as the last day of the current week, not first of the next', () => {
    const w = currentWeekWindowUtc(new Date('2026-09-06T23:59:59Z'))
    expect(w.startIso).toBe('2026-08-31')
    expect(w.endIso).toBe('2026-09-06')
  })
  it('rolls over correctly on a Monday', () => {
    const w = currentWeekWindowUtc(new Date('2026-09-07T00:00:01Z'))
    expect(w.startIso).toBe('2026-09-07')
    expect(w.endIso).toBe('2026-09-13')
  })
})

describe('isThisWeek', () => {
  const ref = new Date('2026-09-02T12:00:00Z') // Wed
  it('returns true for dates in the current week', () => {
    expect(isThisWeek('2026-08-31', ref)).toBe(true) // Mon
    expect(isThisWeek('2026-09-06', ref)).toBe(true) // Sun
  })
  it('returns false for dates outside the current week', () => {
    expect(isThisWeek('2026-08-30', ref)).toBe(false)
    expect(isThisWeek('2026-09-07', ref)).toBe(false)
  })
  it('returns false for null / malformed input', () => {
    expect(isThisWeek(null, ref)).toBe(false)
    expect(isThisWeek('nope', ref)).toBe(false)
  })
})
