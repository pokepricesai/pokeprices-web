import { describe, it, expect } from 'vitest'
import { normalizeEmail, hashEmail } from '../normalize'

describe('normalizeEmail', () => {
  it('accepts a plain address and lowercases it', () => {
    expect(normalizeEmail('Foo@Example.com')).toBe('foo@example.com')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('   foo@example.com  ')).toBe('foo@example.com')
  })

  it('preserves a +tag in the local part', () => {
    expect(normalizeEmail('Foo+Bar@example.com')).toBe('foo+bar@example.com')
  })

  it('strips ASCII control characters before parsing', () => {
    expect(normalizeEmail('foo\x00@example.com')).toBe('foo@example.com')
  })

  it('rejects strings with no @ symbol', () => {
    expect(normalizeEmail('plain')).toBeNull()
  })

  it('rejects strings with no domain dot', () => {
    expect(normalizeEmail('foo@example')).toBeNull()
  })

  it('rejects empty / whitespace-only strings', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
  })

  it('rejects non-string input', () => {
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
    expect(normalizeEmail({})).toBeNull()
  })

  it('rejects strings longer than 254 characters', () => {
    const long = 'a'.repeat(250) + '@b.co' // 256 chars
    expect(normalizeEmail(long)).toBeNull()
  })
})

describe('hashEmail', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const h = await hashEmail('foo@example.com')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', async () => {
    const a = await hashEmail('foo@example.com')
    const b = await hashEmail('foo@example.com')
    expect(a).toBe(b)
  })

  it('differs for different inputs', async () => {
    const a = await hashEmail('foo@example.com')
    const b = await hashEmail('bar@example.com')
    expect(a).not.toBe(b)
  })
})
