// Block 3A correction — /api/unsubscribe canonical-model behaviour.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
// Layer the auth.admin.getUserById surface onto the fake.
;(fakeDB as unknown as { auth: unknown }).auth = {
  admin: {
    getUserById: vi.fn(async (id: string) => {
      // Drive responses from a per-test fixture.
      const fixture = ((globalThis as unknown) as { __authUsers?: Record<string, string | null> }).__authUsers ?? {}
      const email = fixture[id] ?? null
      return { data: email ? { user: { id, email } } : null, error: null }
    }),
  },
}

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import { GET, POST } from '../route'

beforeEach(() => {
  fakeDB.reset()
  ;(globalThis as unknown as { __authUsers?: Record<string, string | null> }).__authUsers = {}
})

function req(method: 'GET' | 'POST', token: string | null): Request {
  const url = 'http://localhost/api/unsubscribe' + (token != null ? `?token=${encodeURIComponent(token)}` : '')
  return new Request(url, { method })
}

async function bodyText(r: Response): Promise<string> {
  return await r.text()
}

describe('/api/unsubscribe — canonical model wiring', () => {
  it('valid legacy token disables BOTH legacy toggles, creates revoke consents + a per-category marketing suppression', async () => {
    fakeDB.seed('user_email_preferences', [{
      user_id: 'u1', unsubscribe_token: 'tok-valid',
      alert_emails_enabled: true, weekly_digest_enabled: true,
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1',
      email_verified: true,
    }])

    const r = await GET(req('GET', 'tok-valid'))
    expect(r.status).toBe(200)
    // Generic message — no token validity reveal.
    const html = await bodyText(r)
    expect(html).toMatch(/If your address was subscribed/i)

    const prefs = fakeDB.rows('user_email_preferences')[0]
    expect(prefs.alert_emails_enabled).toBe(false)
    expect(prefs.weekly_digest_enabled).toBe(false)

    const consents = fakeDB.rows('email_consents')
    expect(consents.map(c => c.category).sort()).toEqual([
      'marketing_newsletter', 'watchlist_alert', 'weekly_report',
    ])
    expect(consents.every(c => c.state === 'revoked')).toBe(true)
    expect(consents.every(c => c.source === 'unsubscribe_link')).toBe(true)

    const supp = fakeDB.rows('email_suppressions')
    expect(supp).toHaveLength(1)
    expect(supp[0].reason).toBe('manual_unsubscribe')
    expect(supp[0].category).toBe('marketing_newsletter')
  })

  it('upserts an email_contact for the user when one does not exist (via auth.users.email)', async () => {
    fakeDB.seed('user_email_preferences', [{
      user_id: 'u-new', unsubscribe_token: 'tok-fresh',
      alert_emails_enabled: true, weekly_digest_enabled: true,
    }])
    ;(globalThis as unknown as { __authUsers?: Record<string, string | null> }).__authUsers = {
      'u-new': 'fresh@example.com',
    }
    await GET(req('GET', 'tok-fresh'))
    const contacts = fakeDB.rows('email_contacts')
    expect(contacts).toHaveLength(1)
    expect(contacts[0].email_normalized).toBe('fresh@example.com')
    expect(contacts[0].user_id).toBe('u-new')
  })

  it('is idempotent — repeated unsubscribe writes do not duplicate the suppression', async () => {
    fakeDB.seed('user_email_preferences', [{
      user_id: 'u1', unsubscribe_token: 'tok-idem',
      alert_emails_enabled: true, weekly_digest_enabled: true,
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    await GET(req('GET', 'tok-idem'))
    await GET(req('GET', 'tok-idem'))
    const supp = fakeDB.rows('email_suppressions')
    expect(supp).toHaveLength(1)
  })

  it('invalid token returns the SAME generic page and writes nothing', async () => {
    const r = await GET(req('GET', 'unknown-token'))
    expect(r.status).toBe(200)
    expect((await bodyText(r))).toMatch(/If your address was subscribed/i)
    expect(fakeDB.rows('email_consents')).toHaveLength(0)
    expect(fakeDB.rows('email_suppressions')).toHaveLength(0)
  })

  it('no token returns the SAME generic page and writes nothing', async () => {
    const r = await GET(req('GET', null))
    expect(r.status).toBe(200)
    expect((await bodyText(r))).toMatch(/If your address was subscribed/i)
    expect(fakeDB.rows('email_consents')).toHaveLength(0)
    expect(fakeDB.rows('email_suppressions')).toHaveLength(0)
  })

  it('POST (List-Unsubscribe one-click) behaves identically to GET', async () => {
    fakeDB.seed('user_email_preferences', [{
      user_id: 'u1', unsubscribe_token: 'tok-post',
      alert_emails_enabled: true, weekly_digest_enabled: true,
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    const r = await POST(req('POST', 'tok-post'))
    expect(r.status).toBe(200)
    expect(fakeDB.rows('email_suppressions')).toHaveLength(1)
  })

  it('response page contains noindex meta + no token / email leakage', async () => {
    fakeDB.seed('user_email_preferences', [{
      user_id: 'u1', unsubscribe_token: 'tok-leak',
      alert_emails_enabled: true, weekly_digest_enabled: true,
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    const r = await GET(req('GET', 'tok-leak'))
    const html = await bodyText(r)
    expect(html).toMatch(/<meta name="robots" content="noindex"/)
    expect(html).not.toMatch(/tok-leak/)
    expect(html).not.toMatch(/foo@example.com/)
    expect(html).not.toMatch(/u1/)
  })
})
