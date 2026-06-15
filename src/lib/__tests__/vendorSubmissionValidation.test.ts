import { describe, it, expect } from 'vitest'
import {
  validateSubmission,
  normaliseUrl,
  cleanText,
  buildVendorSlugBase,
  RESERVED_SLUGS,
  LIMITS,
} from '../vendorSubmissionValidation'

const baseValid = (): any => ({
  name:        'Charizards Den',
  vendor_type: 'physical_shop',
  country:     'UK',
  city:        'Manchester',
  form_started_at_ms: Date.now() - (LIMITS.minFormFillTimeMs + 1000),
})

describe('normaliseUrl', () => {
  it('accepts an http url and returns it intact', () => {
    expect(normaliseUrl('https://example.com/path')).toBe('https://example.com/path')
  })

  it('upgrades a bare hostname to https', () => {
    expect(normaliseUrl('example.com')).toMatch(/^https:\/\/example\.com\/?$/)
  })

  it('rejects javascript: and data: protocols', () => {
    expect(normaliseUrl('javascript:alert(1)')).toBeNull()
    expect(normaliseUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('strips credentials embedded in the URL', () => {
    const out = normaliseUrl('https://user:pass@example.com/')
    expect(out).toBe('https://example.com/')
  })

  it('returns null for empty input', () => {
    expect(normaliseUrl('')).toBeNull()
    expect(normaliseUrl(null)).toBeNull()
    expect(normaliseUrl(undefined)).toBeNull()
  })
})

describe('cleanText', () => {
  it('trims whitespace and removes control characters', () => {
    expect(cleanText('  hello\x00world  ', 50)).toBe('helloworld')
  })

  it('preserves newlines and tabs', () => {
    expect(cleanText('line1\nline2\tend', 50)).toBe('line1\nline2\tend')
  })

  it('truncates to the max length', () => {
    expect(cleanText('a'.repeat(20), 5)).toBe('aaaaa')
  })
})

describe('buildVendorSlugBase', () => {
  it('lowercases and hyphenates', () => {
    expect(buildVendorSlugBase('Charizards Den', 'Manchester')).toBe('charizards-den-manchester')
  })

  it('rejects reserved slugs', () => {
    for (const reserved of Array.from(RESERVED_SLUGS)) {
      expect(buildVendorSlugBase(reserved, '')).toBe('')
    }
  })

  it('returns empty when name has no usable characters', () => {
    expect(buildVendorSlugBase('!!!', '')).toBe('')
  })
})

describe('validateSubmission', () => {
  it('accepts a minimum valid payload', () => {
    const out = validateSubmission(baseValid())
    expect(out.ok).toBe(true)
    expect(out.value?.name).toBe('Charizards Den')
    expect(out.value?.slug_base).toBe('charizards-den-manchester')
  })

  it('rejects missing name', () => {
    const out = validateSubmission({ ...baseValid(), name: '   ' })
    expect(out.ok).toBe(false)
    expect(out.status).toBe(400)
  })

  it('rejects invalid vendor_type', () => {
    const out = validateSubmission({ ...baseValid(), vendor_type: 'bogus' })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/vendor type/i)
  })

  it('rejects invalid country', () => {
    const out = validateSubmission({ ...baseValid(), country: 'XX' })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/country/i)
  })

  it('flags too-fast submissions but the route handler decides the response', () => {
    const out = validateSubmission({ ...baseValid(), form_started_at_ms: Date.now() })
    expect(out.ok).toBe(false)
    expect(out.tooFast).toBe(true)
    expect(out.status).toBe(400)
  })

  it('honeypot returns a soft outcome (200 status, honeypotHit true)', () => {
    const out = validateSubmission({ ...baseValid(), company_url: 'https://spam' })
    expect(out.ok).toBe(false)
    expect(out.honeypotHit).toBe(true)
    expect(out.status).toBe(200)
  })

  it('filters specialisms to the known whitelist', () => {
    const out = validateSubmission({
      ...baseValid(),
      specialisms: ['singles', 'invalid', 'singles', 'sealed'],
    })
    expect(out.ok).toBe(true)
    // duplicates removed and unknowns dropped
    expect(out.value?.specialisms).toEqual(['singles', 'sealed'])
  })

  it('rejects out-of-range latitude / longitude', () => {
    const bad = validateSubmission({ ...baseValid(), latitude: 99 })
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/latitude/i)
  })

  it('normalises a URL field', () => {
    const out = validateSubmission({ ...baseValid(), website: 'example.com' })
    expect(out.ok).toBe(true)
    expect(out.value?.website).toMatch(/^https:\/\/example\.com\/?$/)
  })

  it('returns null for an invalid URL field rather than failing the whole submission', () => {
    const out = validateSubmission({ ...baseValid(), website: 'javascript:alert(1)' })
    expect(out.ok).toBe(true)
    expect(out.value?.website).toBeNull()
  })
})
