// Block 3B — enrolment + processor tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from './_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
// Layer auth.admin.getUserById onto the fake. created_at is now part
// of the fixture because the Block 3B correction pass added an
// eligibility cutoff check against auth.users.created_at.
type AuthFixture = Record<string, { email: string; confirmed: boolean; createdAt?: string }>
;(fakeDB as unknown as { auth: unknown }).auth = {
  admin: {
    getUserById: vi.fn(async (id: string) => {
      const fixture = ((globalThis as unknown) as { __authUsers?: AuthFixture }).__authUsers ?? {}
      const v = fixture[id]
      if (!v) return { data: null, error: null }
      return {
        data: {
          user: {
            id,
            email:              v.email,
            email_confirmed_at: v.confirmed ? '2026-06-16T00:00:00Z' : null,
            created_at:         v.createdAt ?? '2026-06-16T00:00:00Z',
          },
        },
        error: null,
      }
    }),
  },
}

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

// Stub the renderer so the processor tests do not exercise React Email.
vi.mock('@/emails/render', () => ({
  renderTemplate: async (input: { key: string; activationBranch?: string }) => ({
    subject:  'stubbed subject',
    html:     '<p>stub</p>',
    text:     'stub',
    category: 'onboarding',
  }),
}))

// Stub sendEmail so each test controls the outcome.
const sendMock = vi.fn()
vi.mock('../send', () => ({
  sendEmail: (args: unknown) => sendMock(args),
}))

import {
  tryEnrolOnboarding, processOnboardingBatch,
  setOnboardingConsent, readOnboardingConsent, cancelOnboardingForUser,
  isOnboardingEnabled,
} from '../onboarding'

const KEYS = ['EMAIL_ONBOARDING_ENABLED', 'ONBOARDING_ELIGIBLE_AFTER', 'ONBOARDING_CLAIM_STALE_SECONDS'] as const
let snap: Record<string, string | undefined>

const CUTOFF = '2026-06-16T00:00:00Z'

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  sendMock.mockReset()
  sendMock.mockResolvedValue({ outcome: 'sent', emailId: 'r-id-1' })
  ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {}
})

afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

// Helper that flips BOTH gates — the feature flag AND the cutoff.
// Existing tests that rely on enrolment going through use this.
function setEnabled() {
  process.env.EMAIL_ONBOARDING_ENABLED = 'true'
  process.env.ONBOARDING_ELIGIBLE_AFTER = CUTOFF
}

// ─────────────────────────────────────────────────────────────────────
// Enrolment
// ─────────────────────────────────────────────────────────────────────

describe('tryEnrolOnboarding', () => {
  it('short-circuits when the feature flag is disabled', async () => {
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('feature_disabled')
    expect(fakeDB.rows('email_onboarding_state')).toHaveLength(0)
  })

  it('refuses an unverified user', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u1': { email: 'foo@example.com', confirmed: false },
    }
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('email_unverified')
    expect(fakeDB.rows('email_onboarding_state')).toHaveLength(0)
  })

  it('refuses a user with no email', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u1': { email: '', confirmed: true },
    }
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('no_email')
  })

  it('refuses a user with a global terminal suppression', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u1': { email: 'foo@example.com', confirmed: true },
    }
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1',
      email_verified: true,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'hard_bounce', category: null,
      source: 'webhook_bounce', lifted_at: null,
    }])
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('globally_suppressed')
    expect(fakeDB.rows('email_onboarding_state')).toHaveLength(0)
  })

  it('enrols a verified user and grants the onboarding consent', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u1': { email: 'foo@example.com', confirmed: true },
    }
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('enrolled')

    const states = fakeDB.rows('email_onboarding_state')
    expect(states).toHaveLength(1)
    expect(states[0].user_id).toBe('u1')
    expect(states[0].status).toBe('active')

    // Onboarding consent granted.
    const consents = fakeDB.rows('email_consents').filter(c => c.category === 'onboarding')
    expect(consents).toHaveLength(1)
    expect(consents[0].state).toBe('granted')
  })

  it('returns already_enrolled on a second call (PK collision)', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u1': { email: 'foo@example.com', confirmed: true },
    }
    await tryEnrolOnboarding('u1')

    fakeDB.forceInsertError('email_onboarding_state', { code: '23505', message: 'duplicate' })
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('already_enrolled')
    expect(fakeDB.rows('email_onboarding_state')).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Processor
// ─────────────────────────────────────────────────────────────────────

describe('processOnboardingBatch', () => {
  it('returns disabled: true when feature flag is off, does not send', async () => {
    const r = await processOnboardingBatch()
    expect(r.disabled).toBe(true)
    expect(r.processed).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends the welcome step when welcome_due_at is past + welcome_sent_at is null', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at:    '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at:  '2099-01-01T00:00:00Z',
      welcome_sent_at:   null,
      activation_sent_at:null,
      discovery_sent_at: null,
    }])

    const r = await processOnboardingBatch()
    expect(r.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const args = sendMock.mock.calls[0][0] as { templateKey: string; idempotencyKey: string; category: string }
    expect(args.templateKey).toBe('onboarding_welcome')
    expect(args.idempotencyKey).toBe('onboarding:u1:welcome')
    expect(args.category).toBe('onboarding')

    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.welcome_sent_at).toBeTruthy()
  })

  it('does not advance an undue step', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2099-01-01T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    const r = await processOnboardingBatch()
    expect(r.processed).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('completes the sequence when the discovery step succeeds', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-01T00:00:00Z', welcome_sent_at: '2026-06-02T00:00:00Z',
      activation_due_at: '2026-06-03T00:00:00Z', activation_sent_at: '2026-06-04T00:00:00Z',
      discovery_due_at: '2026-06-15T00:00:00Z', discovery_sent_at: null,
    }])
    await processOnboardingBatch()
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.status).toBe('completed')
    expect(state.discovery_sent_at).toBeTruthy()
    expect(state.completed_at).toBeTruthy()
  })

  it('treats a duplicate outcome as sent (idempotent re-send protection)', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'duplicate', deliveryLogId: 'log-1' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    const r = await processOnboardingBatch()
    expect(r.sent).toBe(1)
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.welcome_sent_at).toBeTruthy()
  })

  it('cancels the sequence on a complaint suppression outcome', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'suppressed', reason: 'complaint' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    const r = await processOnboardingBatch()
    expect(r.cancelled).toBe(1)
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.status).toBe('cancelled')
    expect(state.cancellation_reason).toBe('complaint')
  })

  it('cancels the sequence on a hard_bounce suppression outcome', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'suppressed', reason: 'hard_bounce' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    await processOnboardingBatch()
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.cancellation_reason).toBe('hard_bounce')
  })

  it('cancels on preference_disabled', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'preference_disabled', reason: 'marketing_default' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    await processOnboardingBatch()
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.cancellation_reason).toBe('preference_disabled')
  })

  it('retries on provider_error with bounded retries + exponential backoff', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'provider_error', reason: 'oops' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    const start = '2026-06-15T00:00:00Z'
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: start,
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    const r = await processOnboardingBatch()
    expect(r.retried).toBe(1)
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.retry_count).toBe(1)
    expect(state.welcome_due_at).not.toBe(start) // pushed back
    expect(state.welcome_sent_at).toBeNull()
  })

  it('cancels the sequence after MAX_RETRIES provider errors', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'provider_error', reason: 'oops' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 5,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    const r = await processOnboardingBatch()
    expect(r.cancelled).toBe(1)
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.cancellation_reason).toBe('retry_exhausted')
  })

  it('uses the deterministic idempotency keys onboarding:<uid>:<step>', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-01T00:00:00Z', welcome_sent_at: '2026-06-02T00:00:00Z',
      activation_due_at: '2026-06-15T00:00:00Z', activation_sent_at: null,
      discovery_due_at: '2099-01-01T00:00:00Z', discovery_sent_at: null,
    }])
    await processOnboardingBatch()
    const args = sendMock.mock.calls[0][0] as { idempotencyKey: string }
    expect(args.idempotencyKey).toBe('onboarding:u1:activation')
  })

  it('response contains no email address or user id', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    const r = await processOnboardingBatch()
    const blob = JSON.stringify(r)
    expect(blob).not.toMatch(/foo@example.com/)
    expect(blob).not.toMatch(/u1/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Preference toggle
// ─────────────────────────────────────────────────────────────────────

describe('setOnboardingConsent (settings toggle)', () => {
  it('writes a revoke consent + cancels an active sequence on opt-out', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    const r = await setOnboardingConsent({ userId: 'u1', optedIn: false })
    expect(r.ok).toBe(true)

    const consent = fakeDB.rows('email_consents').find(c => c.category === 'onboarding')
    expect(consent?.state).toBe('revoked')

    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.status).toBe('cancelled')
    expect(state.cancellation_reason).toBe('manual_opt_out')
  })

  it('does NOT restart a completed sequence on re-opt-in', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'completed', retry_count: 0,
      welcome_due_at: '2026-06-01T00:00:00Z', welcome_sent_at: '2026-06-02T00:00:00Z',
      activation_due_at: '2026-06-03T00:00:00Z', activation_sent_at: '2026-06-04T00:00:00Z',
      discovery_due_at: '2026-06-10T00:00:00Z', discovery_sent_at: '2026-06-10T00:00:00Z',
      completed_at: '2026-06-10T00:00:00Z',
    }])
    await setOnboardingConsent({ userId: 'u1', optedIn: false })
    await setOnboardingConsent({ userId: 'u1', optedIn: true })
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.status).toBe('completed')
  })

  it('readOnboardingConsent returns null when no consent row exists yet', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    const r = await readOnboardingConsent('u1')
    expect(r.contactId).toBe('c1')
    expect(r.optedIn).toBeNull()
  })
})

describe('isOnboardingEnabled', () => {
  it('reads the literal "true"', () => {
    expect(isOnboardingEnabled()).toBe(false)
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    expect(isOnboardingEnabled()).toBe(true)
    process.env.EMAIL_ONBOARDING_ENABLED = 'TRUE'
    expect(isOnboardingEnabled()).toBe(true)
    process.env.EMAIL_ONBOARDING_ENABLED = '1'
    expect(isOnboardingEnabled()).toBe(false)
  })
})

describe('cancelOnboardingForUser', () => {
  it('writes status=cancelled + the given reason', async () => {
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
    }])
    await cancelOnboardingForUser('u1', 'account_deleted')
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.status).toBe('cancelled')
    expect(state.cancellation_reason).toBe('account_deleted')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 3B correction — existing-user enrolment safeguard
// ─────────────────────────────────────────────────────────────────────

describe('tryEnrolOnboarding — eligibility cutoff', () => {
  it('cutoff_missing when ONBOARDING_ELIGIBLE_AFTER is unset', async () => {
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    // ONBOARDING_ELIGIBLE_AFTER intentionally unset.
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u1': { email: 'foo@example.com', confirmed: true, createdAt: '2026-06-16T01:00:00Z' },
    }
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('cutoff_missing')
    expect(fakeDB.rows('email_onboarding_state')).toHaveLength(0)
  })

  it('cutoff_invalid when ONBOARDING_ELIGIBLE_AFTER is unparseable', async () => {
    process.env.EMAIL_ONBOARDING_ENABLED  = 'true'
    process.env.ONBOARDING_ELIGIBLE_AFTER = 'not a date'
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u1': { email: 'foo@example.com', confirmed: true, createdAt: '2026-06-16T01:00:00Z' },
    }
    const r = await tryEnrolOnboarding('u1')
    expect(r.outcome).toBe('cutoff_invalid')
  })

  it('user created BEFORE the cutoff is not enrolled', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u-old': { email: 'foo@example.com', confirmed: true, createdAt: '2025-01-01T00:00:00Z' },
    }
    const r = await tryEnrolOnboarding('u-old')
    expect(r.outcome).toBe('user_predates_cutoff')
    expect(fakeDB.rows('email_onboarding_state')).toHaveLength(0)
  })

  it('user created EXACTLY at the cutoff is eligible', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u-edge': { email: 'foo@example.com', confirmed: true, createdAt: CUTOFF },
    }
    const r = await tryEnrolOnboarding('u-edge')
    expect(r.outcome).toBe('enrolled')
  })

  it('user created AFTER the cutoff is eligible', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u-new': { email: 'foo@example.com', confirmed: true, createdAt: '2026-06-17T00:00:00Z' },
    }
    const r = await tryEnrolOnboarding('u-new')
    expect(r.outcome).toBe('enrolled')
  })

  it('a returning OAuth user (created before cutoff) is not enrolled on later login', async () => {
    setEnabled()
    // Simulates a returning user clicking /auth/callback — the helper
    // reads created_at, which predates the cutoff.
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u-returning-oauth': { email: 'foo@example.com', confirmed: true, createdAt: '2024-01-01T00:00:00Z' },
    }
    const r = await tryEnrolOnboarding('u-returning-oauth')
    expect(r.outcome).toBe('user_predates_cutoff')
  })

  it('a returning magic-link user (created before cutoff) is not enrolled', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u-magic': { email: 'foo@example.com', confirmed: true, createdAt: '2024-01-01T00:00:00Z' },
    }
    const r = await tryEnrolOnboarding('u-magic')
    expect(r.outcome).toBe('user_predates_cutoff')
  })

  it('a new OAuth user (created after cutoff) can enrol', async () => {
    setEnabled()
    ;(globalThis as unknown as { __authUsers?: AuthFixture }).__authUsers = {
      'u-new-oauth': { email: 'foo@example.com', confirmed: true, createdAt: '2099-01-01T00:00:00Z' },
    }
    const r = await tryEnrolOnboarding('u-new-oauth')
    expect(r.outcome).toBe('enrolled')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Block 3B correction — atomic claim
// ─────────────────────────────────────────────────────────────────────

describe('processor atomic claim', () => {
  it('two concurrent processors cannot both claim the same step', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
      processing_step: null, processing_token: null, processing_started_at: null,
    }])
    // sendMock returns a sent outcome immediately — that's fine; we
    // just want to confirm a second processor invocation does not
    // attempt a second send for the same step on the same row.
    const a = await processOnboardingBatch()
    expect(a.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    // The row's welcome_sent_at is now set, so a second run sees no
    // due step on the same row.
    const b = await processOnboardingBatch()
    expect(b.processed).toBe(0)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('a row with a fresh claim by another worker is not stolen', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    const recentClaim = new Date(Date.now() - 5 * 1000).toISOString() // 5s ago
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
      processing_step: 'welcome',
      processing_token: '11111111-1111-1111-1111-111111111111',
      processing_started_at: recentClaim,
    }])
    const r = await processOnboardingBatch()
    expect(r.skipped).toBe(1)
    expect(r.sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
    // Claim is unchanged.
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.processing_token).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('a stale claim is recoverable by a later processor', async () => {
    setEnabled()
    process.env.ONBOARDING_CLAIM_STALE_SECONDS = '60'
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    const staleStart = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
      processing_step: 'welcome',
      processing_token: '22222222-2222-2222-2222-222222222222',
      processing_started_at: staleStart,
    }])
    const r = await processOnboardingBatch()
    expect(r.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const state = fakeDB.rows('email_onboarding_state')[0]
    // Successful send clears the claim.
    expect(state.processing_token).toBeNull()
    expect(state.processing_started_at).toBeNull()
    expect(state.welcome_sent_at).toBeTruthy()
  })

  it('successful send clears the claim and marks the sent timestamp', async () => {
    setEnabled()
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
      processing_step: null, processing_token: null, processing_started_at: null,
    }])
    await processOnboardingBatch()
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.processing_step).toBeNull()
    expect(state.processing_token).toBeNull()
    expect(state.processing_started_at).toBeNull()
    expect(state.welcome_sent_at).toBeTruthy()
  })

  it('duplicate outcome clears the claim and advances state', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'duplicate', deliveryLogId: 'log-1' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
      processing_step: null, processing_token: null, processing_started_at: null,
    }])
    await processOnboardingBatch()
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.welcome_sent_at).toBeTruthy()
    expect(state.processing_token).toBeNull()
  })

  it('provider failure schedules a retry AND clears the claim', async () => {
    setEnabled()
    sendMock.mockResolvedValueOnce({ outcome: 'provider_error', reason: 'oops' })
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
      processing_step: null, processing_token: null, processing_started_at: null,
    }])
    const r = await processOnboardingBatch()
    expect(r.retried).toBe(1)
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.retry_count).toBe(1)
    // Claim has been cleared so the next processor can re-claim.
    expect(state.processing_token).toBeNull()
    expect(state.processing_started_at).toBeNull()
    // Sent-at remains unset.
    expect(state.welcome_sent_at).toBeNull()
  })

  it('processor crash recovery: stale claim + successful send leaves a clean row', async () => {
    setEnabled()
    process.env.ONBOARDING_CLAIM_STALE_SECONDS = '60'
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: 'u1', email_verified: true,
    }])
    const crashStart = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    fakeDB.seed('email_onboarding_state', [{
      user_id: 'u1', contact_id: 'c1', status: 'active', retry_count: 0,
      welcome_due_at: '2026-06-15T00:00:00Z',
      activation_due_at: '2099-01-01T00:00:00Z',
      discovery_due_at: '2099-01-01T00:00:00Z',
      welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
      processing_step: 'welcome',
      processing_token: '33333333-3333-3333-3333-333333333333',
      processing_started_at: crashStart,
    }])
    const r = await processOnboardingBatch()
    expect(r.sent).toBe(1)
    const state = fakeDB.rows('email_onboarding_state')[0]
    expect(state.processing_token).toBeNull()
    expect(state.welcome_sent_at).toBeTruthy()
  })
})
