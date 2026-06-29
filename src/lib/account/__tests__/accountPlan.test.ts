// Block 5A-W-25 — server-side account plan resolver tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// server-only is imported by accountPlan; stub it for node tests.
vi.mock('server-only', () => ({}))

import {
  parseAccountProUserIds,
  isUserInProAllowlist,
  resolvePlanForUser,
} from '../accountPlan'

// ─────────────────────────────────────────────────────────────────────
// parseAccountProUserIds — pure parsing, no env reads here
// ─────────────────────────────────────────────────────────────────────

describe('parseAccountProUserIds', () => {
  it('empty / missing input → empty set', () => {
    expect(parseAccountProUserIds(undefined).size).toBe(0)
    expect(parseAccountProUserIds('').size).toBe(0)
    expect(parseAccountProUserIds('   ').size).toBe(0)
  })

  it('single id → set with one entry', () => {
    const s = parseAccountProUserIds('uuid-1')
    expect(s.size).toBe(1)
    expect(s.has('uuid-1')).toBe(true)
  })

  it('multiple comma-separated ids → set with all entries', () => {
    const s = parseAccountProUserIds('uuid-1,uuid-2,uuid-3')
    expect(s.size).toBe(3)
    expect(s.has('uuid-2')).toBe(true)
  })

  it('whitespace and empty entries tolerated ("u1 ,, , u2 ")', () => {
    const s = parseAccountProUserIds(' uuid-1 ,, , uuid-2 ')
    expect(s.size).toBe(2)
    expect(s.has('uuid-1')).toBe(true)
    expect(s.has('uuid-2')).toBe(true)
  })

  it('duplicates collapse', () => {
    const s = parseAccountProUserIds('uuid-1,uuid-1,uuid-2')
    expect(s.size).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────
// isUserInProAllowlist — reads process.env at call time
// ─────────────────────────────────────────────────────────────────────

describe('isUserInProAllowlist', () => {
  const KEY = 'ACCOUNT_PRO_USER_IDS' as const
  let snap: string | undefined
  beforeEach(() => { snap = process.env[KEY]; delete process.env[KEY] })
  afterEach(()  => { if (snap === undefined) delete process.env[KEY]; else process.env[KEY] = snap })

  it('env unset → false for any user', () => {
    expect(isUserInProAllowlist('uuid-1')).toBe(false)
  })

  it('user_id NULL / empty → false (never accidentally true)', () => {
    process.env[KEY] = 'uuid-1'
    expect(isUserInProAllowlist(null)).toBe(false)
    expect(isUserInProAllowlist(undefined)).toBe(false)
    expect(isUserInProAllowlist('')).toBe(false)
  })

  it('listed user_id → true', () => {
    process.env[KEY] = 'uuid-1,uuid-2'
    expect(isUserInProAllowlist('uuid-2')).toBe(true)
  })

  it('unlisted user_id → false (env present but no match)', () => {
    process.env[KEY] = 'uuid-1,uuid-2'
    expect(isUserInProAllowlist('uuid-99')).toBe(false)
  })

  it('whitespace in env still resolves the listed id', () => {
    process.env[KEY] = ' uuid-1 , uuid-2 '
    expect(isUserInProAllowlist('uuid-1')).toBe(true)
    expect(isUserInProAllowlist('uuid-2')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────
// resolvePlanForUser — full resolver wrapper
// ─────────────────────────────────────────────────────────────────────

describe('resolvePlanForUser', () => {
  const KEY = 'ACCOUNT_PRO_USER_IDS' as const
  let snap: string | undefined
  beforeEach(() => { snap = process.env[KEY]; delete process.env[KEY] })
  afterEach(()  => { if (snap === undefined) delete process.env[KEY]; else process.env[KEY] = snap })

  it('env-allowlisted user → pro (even with no profile row)', () => {
    process.env[KEY] = '745453cb-db78-4b29-96ed-8aad8f060c55'
    expect(resolvePlanForUser({
      userId: '745453cb-db78-4b29-96ed-8aad8f060c55',
      profile: null,
    })).toBe('pro')
  })

  it('profile.plan=pro → pro (even when env allowlist is empty)', () => {
    expect(resolvePlanForUser({
      userId: 'uuid-1',
      profile: { plan: 'pro' },
    })).toBe('pro')
  })

  it('priority: env allowlist beats a profile.plan=free row', () => {
    process.env[KEY] = 'uuid-1'
    expect(resolvePlanForUser({
      userId: 'uuid-1',
      profile: { plan: 'free' },
    })).toBe('pro')
  })

  it('no allowlist + no pro profile → free', () => {
    expect(resolvePlanForUser({ userId: 'uuid-1', profile: null })).toBe('free')
    expect(resolvePlanForUser({ userId: 'uuid-1', profile: { plan: 'free' } })).toBe('free')
    expect(resolvePlanForUser({ userId: 'uuid-1', profile: { plan: null } })).toBe('free')
  })

  it('null user_id + empty allowlist → free (anonymous default)', () => {
    expect(resolvePlanForUser({ userId: null, profile: null })).toBe('free')
  })

  it('null user_id + profile.plan=pro → pro (profile path still works)', () => {
    expect(resolvePlanForUser({ userId: null, profile: { plan: 'pro' } })).toBe('pro')
  })
})
