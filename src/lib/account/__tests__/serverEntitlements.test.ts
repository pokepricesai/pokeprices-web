// Block 5A-W-27 — server-side instant-alert entitlement helper tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  getInstantAlertEntitlement,
  isInstantAlertEntitled,
} from '../serverEntitlements'

const KEY = 'ACCOUNT_PRO_USER_IDS' as const
let snap: string | undefined

beforeEach(() => { snap = process.env[KEY]; delete process.env[KEY] })
afterEach(()  => { if (snap === undefined) delete process.env[KEY]; else process.env[KEY] = snap })

describe('getInstantAlertEntitlement', () => {
  it('null user_id → free + not allowed (anonymous default)', () => {
    expect(getInstantAlertEntitlement(null)).toEqual({
      plan: 'free', instantAlertsAllowed: false,
    })
    expect(getInstantAlertEntitlement(undefined)).toEqual({
      plan: 'free', instantAlertsAllowed: false,
    })
  })

  it('user NOT in allowlist → free + not allowed', () => {
    process.env[KEY] = 'someone-else'
    expect(getInstantAlertEntitlement('uuid-not-listed')).toEqual({
      plan: 'free', instantAlertsAllowed: false,
    })
  })

  it('user IN allowlist → pro + allowed', () => {
    process.env[KEY] = '745453cb-db78-4b29-96ed-8aad8f060c55,other-uuid'
    expect(getInstantAlertEntitlement('745453cb-db78-4b29-96ed-8aad8f060c55')).toEqual({
      plan: 'pro', instantAlertsAllowed: true,
    })
  })

  it('whitespace-tolerant env', () => {
    process.env[KEY] = ' uuid-A , uuid-B '
    expect(getInstantAlertEntitlement('uuid-A').instantAlertsAllowed).toBe(true)
    expect(getInstantAlertEntitlement('uuid-B').instantAlertsAllowed).toBe(true)
  })

  it('empty env → every user is free + not allowed', () => {
    expect(getInstantAlertEntitlement('uuid-1').instantAlertsAllowed).toBe(false)
  })
})

describe('isInstantAlertEntitled', () => {
  it('mirrors getInstantAlertEntitlement(...).instantAlertsAllowed', () => {
    process.env[KEY] = 'uuid-1'
    expect(isInstantAlertEntitled('uuid-1')).toBe(true)
    expect(isInstantAlertEntitled('uuid-2')).toBe(false)
    expect(isInstantAlertEntitled(null)).toBe(false)
  })
})
