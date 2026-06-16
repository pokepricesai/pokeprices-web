import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeDB } from './_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import { isOptedIn, recordConsent } from '../preferences'
import { EMAIL_CATEGORIES } from '../categories'

beforeEach(() => fakeDB.reset())

describe('isOptedIn', () => {
  it('most-recent consent row wins', async () => {
    fakeDB.seed('email_consents', [
      { contact_id: 'c1', category: 'marketing_newsletter', state: 'granted', source: 'x', consent_version: 'v1', created_at: '2026-06-01T00:00:00Z' },
      { contact_id: 'c1', category: 'marketing_newsletter', state: 'revoked', source: 'x', consent_version: 'v1', created_at: '2026-06-10T00:00:00Z' },
    ])
    const r = await isOptedIn({
      contactId: 'c1',
      category:  EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
    })
    expect(r.optedIn).toBe(false)
    expect(r.source).toBe('explicit_consent')
  })

  it('transactional defaults to opted in when no consent row exists', async () => {
    const r = await isOptedIn({
      contactId: 'c1',
      category:  EMAIL_CATEGORIES.TRANSACTIONAL,
    })
    expect(r.optedIn).toBe(true)
    expect(r.source).toBe('transactional_default')
  })

  it('marketing defaults to opted OUT', async () => {
    const r = await isOptedIn({
      contactId: 'c1',
      category:  EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
    })
    expect(r.optedIn).toBe(false)
    expect(r.source).toBe('marketing_default')
  })

  it('watchlist_alert bridges to user_email_preferences when userId is known', async () => {
    fakeDB.seed('user_email_preferences', [
      { user_id: 'u1', alert_emails_enabled: false, weekly_digest_enabled: true },
    ])
    const off = await isOptedIn({
      contactId: 'c1', userId: 'u1',
      category:  EMAIL_CATEGORIES.WATCHLIST_ALERT,
    })
    expect(off.optedIn).toBe(false)
    expect(off.source).toBe('bridge_user_email_preferences')

    const on = await isOptedIn({
      contactId: 'c1', userId: 'u1',
      category:  EMAIL_CATEGORIES.WEEKLY_REPORT,
    })
    expect(on.optedIn).toBe(true)
  })

  it('watchlist_alert defaults to OPTED OUT when no userId is known', async () => {
    const r = await isOptedIn({
      contactId: 'c1', userId: null,
      category:  EMAIL_CATEGORIES.WATCHLIST_ALERT,
    })
    expect(r.optedIn).toBe(false)
  })
})

describe('recordConsent', () => {
  it('appends a row without overwriting prior history', async () => {
    fakeDB.seed('email_consents', [{
      contact_id: 'c1', category: 'marketing_newsletter', state: 'granted',
      source: 'old', consent_version: 'v1', created_at: '2026-06-01T00:00:00Z',
    }])
    const r = await recordConsent({
      contactId: 'c1',
      category:  EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      state:     'revoked',
      source:    'unsubscribe_link',
    })
    expect(r.ok).toBe(true)
    const rows = fakeDB.rows('email_consents')
    expect(rows).toHaveLength(2)
    expect(rows.filter(r => r.state === 'granted')).toHaveLength(1)
    expect(rows.filter(r => r.state === 'revoked')).toHaveLength(1)
  })
})
