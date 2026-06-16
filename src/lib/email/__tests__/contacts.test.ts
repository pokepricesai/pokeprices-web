import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeDB } from './_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import { upsertContact, findContactByEmail, findContactByResendEmailId } from '../contacts'

beforeEach(() => fakeDB.reset())

describe('upsertContact', () => {
  it('inserts a new contact when none exists', async () => {
    const c = await upsertContact({
      email: 'Foo@Example.com', source: 'newsletter_form',
    })
    expect(c?.email_normalized).toBe('foo@example.com')
    expect(fakeDB.rows('email_contacts')).toHaveLength(1)
  })

  it('returns null for an unparseable email', async () => {
    const c = await upsertContact({ email: 'not-an-email', source: 'newsletter_form' })
    expect(c).toBeNull()
  })

  it('returns the existing row without duplicating it', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    const c = await upsertContact({ email: 'foo@example.com', source: 'send_service' })
    expect(c?.id).toBe('c1')
    expect(fakeDB.rows('email_contacts')).toHaveLength(1)
  })

  it('backfills user_id when previously null', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    const c = await upsertContact({
      email: 'foo@example.com', userId: 'u1', source: 'auth_signup',
    })
    expect(c?.user_id).toBe('u1')
  })

  it('does NOT overwrite an existing user_id link', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u-old', email_verified: false,
    }])
    const c = await upsertContact({
      email: 'foo@example.com', userId: 'u-new', source: 'auth_signup',
    })
    expect(c?.user_id).toBe('u-old')
  })
})

describe('findContactByEmail', () => {
  it('matches case-insensitively via normalization', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    const c = await findContactByEmail('FOO@EXAMPLE.COM')
    expect(c?.id).toBe('c1')
  })

  it('returns null for an unknown email', async () => {
    const c = await findContactByEmail('missing@example.com')
    expect(c).toBeNull()
  })
})

describe('findContactByResendEmailId', () => {
  it('resolves through the delivery log', async () => {
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-1', contact_id: 'c1', created_at: '2026-06-15T00:00:00Z',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    const c = await findContactByResendEmailId('r-1')
    expect(c?.id).toBe('c1')
  })

  it('returns null when the Resend id is unknown', async () => {
    const c = await findContactByResendEmailId('missing')
    expect(c).toBeNull()
  })
})
