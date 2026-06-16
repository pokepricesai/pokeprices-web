// Pure classifier tests — proves the rules documented in
// docs/email-infrastructure.md (suppression policy section).

import { describe, it, expect } from 'vitest'
import { classifyBounce, classifyFailedReason } from '../providerEvents'

describe('classifyBounce', () => {
  it('returns hard for literal Hard / Permanent / Suppressed types', () => {
    expect(classifyBounce('Hard', null)).toBe('hard')
    expect(classifyBounce('Permanent', null)).toBe('hard')
    expect(classifyBounce('Suppressed', null)).toBe('hard')
    expect(classifyBounce('Undetermined', null)).toBe('hard')
    expect(classifyBounce('hard', null)).toBe('hard') // case-insensitive
  })

  it('returns hard when subType identifies a permanent address rejection', () => {
    expect(classifyBounce('', 'NoEmail')).toBe('hard')
    expect(classifyBounce('', 'mailbox_does_not_exist')).toBe('hard')
    expect(classifyBounce('', 'General')).toBe('hard')
    expect(classifyBounce('', 'recipient_reject')).toBe('hard')
  })

  it('returns soft for transient / soft / temporary types', () => {
    expect(classifyBounce('Soft', null)).toBe('soft')
    expect(classifyBounce('Transient', null)).toBe('soft')
    expect(classifyBounce('temporary', null)).toBe('soft')
    expect(classifyBounce('deferred', null)).toBe('soft')
    expect(classifyBounce('DnsFailure', null)).toBe('soft')
    expect(classifyBounce('ContentRejected', null)).toBe('soft')
  })

  it('returns unknown for empty / unrecognised types', () => {
    expect(classifyBounce(null, null)).toBe('unknown')
    expect(classifyBounce('', '')).toBe('unknown')
    expect(classifyBounce('something_weird', null)).toBe('unknown')
  })
})

describe('classifyFailedReason', () => {
  it('returns permanent_recipient on clear address-rejection language', () => {
    const yes = [
      'Mailbox does not exist',
      'Recipient rejected at server',
      'Invalid recipient',
      'No such user',
      '550 5.1.1 User unknown',
      '550 5.0.1 Address does not exist',
      'Unknown user',
      'permanent failure',
      'Account disabled',
      'Not a valid mailbox',
    ]
    for (const r of yes) expect(classifyFailedReason(r)).toBe('permanent_recipient')
  })

  it('returns temporary on transient / quota / timeout reasons', () => {
    const yes = [
      'Timeout connecting to MX',
      'Quota exceeded',
      'Rate limited by destination',
      'Throttled',
      'Temporary failure',
      'Deferred — try again later',
      'TLS handshake failed',
      'Connection refused',
      'Domain capacity exceeded',
      'Configuration error at provider',
      'Service unavailable',
      '421 4.4.2 Connection timed out',
      'Busy — please try again',
      'Greylisted',
    ]
    for (const r of yes) expect(classifyFailedReason(r)).toBe('temporary')
  })

  it('returns unknown for empty / non-string / unclassified reasons', () => {
    expect(classifyFailedReason(null)).toBe('unknown')
    expect(classifyFailedReason(undefined)).toBe('unknown')
    expect(classifyFailedReason('')).toBe('unknown')
    expect(classifyFailedReason('   ')).toBe('unknown')
    expect(classifyFailedReason('something completely unexplained')).toBe('unknown')
  })
})
