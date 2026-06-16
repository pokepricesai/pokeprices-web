import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeDB } from './_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import {
  applySuppression,
  isSendBlocked,
  getActiveSuppressions,
  suppressionBlocks,
  isTerminalSuppression,
  TERMINAL_SUPPRESSION_REASONS,
} from '../suppressions'
import { EMAIL_CATEGORIES } from '../categories'

beforeEach(() => fakeDB.reset())

// ─────────────────────────────────────────────────────────────────────
// Pure precedence rule
// ─────────────────────────────────────────────────────────────────────

describe('suppressionBlocks — pure precedence', () => {
  it('TERMINAL_SUPPRESSION_REASONS contains exactly the five canonical reasons', () => {
    expect([...TERMINAL_SUPPRESSION_REASONS].sort()).toEqual([
      'admin_suppression',
      'complaint',
      'hard_bounce',
      'invalid_address',
      'provider_rejection',
    ])
  })

  it('every terminal reason blocks EVERY category (incl. transactional) when global', () => {
    for (const reason of TERMINAL_SUPPRESSION_REASONS) {
      for (const cat of Object.values(EMAIL_CATEGORIES)) {
        expect(suppressionBlocks({ reason, category: null }, cat)).toBe(true)
      }
    }
  })

  it('manual_unsubscribe globally blocks marketing_newsletter only', () => {
    for (const cat of Object.values(EMAIL_CATEGORIES)) {
      expect(
        suppressionBlocks({ reason: 'manual_unsubscribe', category: null }, cat),
      ).toBe(cat === EMAIL_CATEGORIES.MARKETING_NEWSLETTER)
    }
  })

  it('soft_bounce_threshold globally blocks all non-transactional', () => {
    for (const cat of Object.values(EMAIL_CATEGORIES)) {
      expect(
        suppressionBlocks({ reason: 'soft_bounce_threshold', category: null }, cat),
      ).toBe(cat !== EMAIL_CATEGORIES.TRANSACTIONAL)
    }
  })

  it('a per-category suppression blocks only its own category', () => {
    for (const reason of TERMINAL_SUPPRESSION_REASONS) {
      const target = EMAIL_CATEGORIES.WATCHLIST_ALERT
      for (const cat of Object.values(EMAIL_CATEGORIES)) {
        expect(
          suppressionBlocks({ reason, category: target }, cat),
        ).toBe(cat === target)
      }
    }
  })
})

describe('isTerminalSuppression', () => {
  it('flags only the five canonical reasons', () => {
    for (const r of TERMINAL_SUPPRESSION_REASONS) expect(isTerminalSuppression(r)).toBe(true)
    expect(isTerminalSuppression('manual_unsubscribe')).toBe(false)
    expect(isTerminalSuppression('soft_bounce_threshold')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// DB-backed checks
// ─────────────────────────────────────────────────────────────────────

describe('isSendBlocked', () => {
  it('global hard_bounce blocks TRANSACTIONAL too (new rule)', async () => {
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'hard_bounce', category: null,
      source: 'webhook_bounce', lifted_at: null,
    }])
    const r = await isSendBlocked({
      contactId: 'c1', category: EMAIL_CATEGORIES.TRANSACTIONAL,
    })
    expect(r.blocked).toBe(true)
  })

  it('global complaint blocks TRANSACTIONAL too', async () => {
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'complaint', category: null,
      source: 'webhook_complaint', lifted_at: null,
    }])
    const r = await isSendBlocked({
      contactId: 'c1', category: EMAIL_CATEGORIES.TRANSACTIONAL,
    })
    expect(r.blocked).toBe(true)
  })

  it('global invalid_address blocks TRANSACTIONAL too', async () => {
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'invalid_address', category: null,
      source: 'send_service', lifted_at: null,
    }])
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.TRANSACTIONAL,
      })).blocked,
    ).toBe(true)
  })

  it('global admin_suppression blocks TRANSACTIONAL too', async () => {
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'admin_suppression', category: null,
      source: 'admin_action', lifted_at: null,
    }])
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.TRANSACTIONAL,
      })).blocked,
    ).toBe(true)
  })

  it('manual_unsubscribe global does NOT block transactional or service_product', async () => {
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'manual_unsubscribe', category: null,
      source: 'unsubscribe_link', lifted_at: null,
    }])
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.TRANSACTIONAL,
      })).blocked,
    ).toBe(false)
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.SERVICE_PRODUCT,
      })).blocked,
    ).toBe(false)
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      })).blocked,
    ).toBe(true)
  })

  it('per-category suppression blocks only that category', async () => {
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'manual_unsubscribe',
      category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      source: 'unsubscribe_link', lifted_at: null,
    }])
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      })).blocked,
    ).toBe(true)
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.WATCHLIST_ALERT,
      })).blocked,
    ).toBe(false)
  })

  it('lifted suppression does not block', async () => {
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'hard_bounce', category: null,
      source: 'webhook_bounce', lifted_at: '2026-06-15T00:00:00Z',
    }])
    expect(
      (await isSendBlocked({
        contactId: 'c1', category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      })).blocked,
    ).toBe(false)
  })
})

describe('applySuppression', () => {
  it('inserts a new suppression', async () => {
    const r = await applySuppression({
      contactId: 'c1', reason: 'hard_bounce', source: 'webhook_bounce',
    })
    expect(r.ok).toBe(true)
    expect(fakeDB.rows('email_suppressions')).toHaveLength(1)
  })

  it('is idempotent on the (contact, reason, category) triple', async () => {
    await applySuppression({ contactId: 'c1', reason: 'hard_bounce', source: 'webhook_bounce' })
    await applySuppression({ contactId: 'c1', reason: 'hard_bounce', source: 'webhook_bounce' })
    expect(fakeDB.rows('email_suppressions')).toHaveLength(1)
  })

  it('records per-category suppression separately from global', async () => {
    await applySuppression({
      contactId: 'c1', reason: 'manual_unsubscribe', source: 'unsubscribe_link',
      category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
    })
    await applySuppression({
      contactId: 'c1', reason: 'manual_unsubscribe', source: 'unsubscribe_link',
      category: null,
    })
    expect(fakeDB.rows('email_suppressions')).toHaveLength(2)
  })
})

describe('getActiveSuppressions', () => {
  it('returns only unlifted rows for the contact', async () => {
    fakeDB.seed('email_suppressions', [
      { id: 's1', contact_id: 'c1', reason: 'hard_bounce', category: null, source: 'wb', lifted_at: null },
      { id: 's2', contact_id: 'c1', reason: 'complaint',   category: null, source: 'wc', lifted_at: '2026-06-15T00:00:00Z' },
      { id: 's3', contact_id: 'c2', reason: 'complaint',   category: null, source: 'wc', lifted_at: null },
    ])
    const r = await getActiveSuppressions('c1')
    expect(r.map(x => x.id)).toEqual(['s1'])
  })
})
