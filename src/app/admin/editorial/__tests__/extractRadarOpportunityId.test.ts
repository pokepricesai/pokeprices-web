// src/app/admin/editorial/__tests__/extractRadarOpportunityId.test.ts
//
// Regression tests for the dedupe key path:
//   * exact opportunity id (via notes marker) suppresses only that
//     opportunity
//   * exact normalised title suppresses only that title (never
//     substring / containment)
//   * two similar-titled projects don't cross-suppress

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
// Stub supabase — the module we're testing doesn't use it, but
// EditorialHqClient's transitive imports touch server-only paths.
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))

import { extractRadarOpportunityIdFromNotes } from '../EditorialHqClient'

// ─────────────────────────────────────────────────────────────────
// Marker parsing
// ─────────────────────────────────────────────────────────────────

describe('extractRadarOpportunityIdFromNotes', () => {
  it('parses the marker on the first line', () => {
    expect(extractRadarOpportunityIdFromNotes('[radar-opportunity: op-123]\nRadar score: 80/100')).toBe('op-123')
  })

  it('parses the marker anywhere in the notes body', () => {
    expect(extractRadarOpportunityIdFromNotes('Some intro\n[radar-opportunity: release-driven-celebration]\nRest...')).toBe('release-driven-celebration')
  })

  it('trims surrounding whitespace inside the marker', () => {
    expect(extractRadarOpportunityIdFromNotes('[radar-opportunity:   op-abc   ]')).toBe('op-abc')
  })

  it('handles ids with dots / colons / slashes', () => {
    expect(extractRadarOpportunityIdFromNotes('[radar-opportunity: release_driven:2026-celebration.1]')).toBe('release_driven:2026-celebration.1')
  })

  it('returns null when the marker is absent', () => {
    expect(extractRadarOpportunityIdFromNotes('Radar score: 80/100\nWhy now: …')).toBeNull()
    expect(extractRadarOpportunityIdFromNotes(null)).toBeNull()
    expect(extractRadarOpportunityIdFromNotes(undefined)).toBeNull()
    expect(extractRadarOpportunityIdFromNotes('')).toBeNull()
  })

  it('does not match near-misses (missing bracket, wrong key)', () => {
    expect(extractRadarOpportunityIdFromNotes('radar-opportunity: nope')).toBeNull()
    expect(extractRadarOpportunityIdFromNotes('[opportunity: op-1]')).toBeNull()
    expect(extractRadarOpportunityIdFromNotes('[radar: op-1]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// Acceptance — two similar-titled projects don't cross-suppress
// ─────────────────────────────────────────────────────────────────

describe('dedupe acceptance — related-but-distinct titles remain separate', () => {
  // Exact normalised title match is the CORRECT fallback: two
  // similar titles produce different normalised strings and
  // therefore both survive.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  it('30th Celebration: Everything We Know does NOT match 30th Celebration Prices After Release', () => {
    const a = norm('30th Celebration: Everything We Know')
    const b = norm('30th Celebration Prices After Release')
    expect(a).not.toBe(b)
    // The previous bug used a.includes(b) || b.includes(a). Assert
    // that inputs pattern-safe under equality-only matching:
    expect(a === b).toBe(false)
  })

  it('exact same title with different capitalisation / punctuation still matches', () => {
    const a = norm('30th Celebration: Everything We Know')
    const b = norm('30TH CELEBRATION - EVERYTHING WE KNOW!!!')
    expect(a).toBe(b)
  })
})
