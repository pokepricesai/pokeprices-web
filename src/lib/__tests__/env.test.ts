import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ENV_CATALOGUE,
  getRequiredServerEnv,
  getRequiredPublicEnv,
  getOptionalEnv,
  missingRequiredEnvNames,
} from '../env'

describe('ENV_CATALOGUE', () => {
  it('lists every required variable with a description', () => {
    for (const spec of ENV_CATALOGUE) {
      expect(spec.name).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(spec.scope).toMatch(/^(public|server)$/)
      expect(typeof spec.required).toBe('boolean')
      expect(spec.description.length).toBeGreaterThan(10)
    }
  })

  it('has no duplicate names', () => {
    const names = ENV_CATALOGUE.map(s => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('marks SUPABASE_SERVICE_ROLE_KEY as required and server-only', () => {
    const spec = ENV_CATALOGUE.find(s => s.name === 'SUPABASE_SERVICE_ROLE_KEY')
    expect(spec?.required).toBe(true)
    expect(spec?.scope).toBe('server')
  })
})

describe('accessors', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('getRequiredServerEnv throws naming the variable when missing', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(() => getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY'))
      .toThrowError(/SUPABASE_SERVICE_ROLE_KEY is not set/)
  })

  it('getRequiredServerEnv refuses to read a known public var', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    expect(() => getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'))
      .toThrowError(/public var/)
  })

  it('getRequiredPublicEnv returns the value when present', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    expect(getRequiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL')).toBe('https://example.supabase.co')
  })

  it('getOptionalEnv returns the catalogue fallback when missing', () => {
    vi.stubEnv('VENDOR_DAILY_IP_SALT', '')
    expect(getOptionalEnv('VENDOR_DAILY_IP_SALT')).toBe('v1')
  })

  it('getOptionalEnv returns the caller-provided fallback when missing', () => {
    vi.stubEnv('INTEL_PASSWORD', '')
    expect(getOptionalEnv('INTEL_PASSWORD', 'override')).toBe('override')
  })

  it('missingRequiredEnvNames lists the names that are unset', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',  '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    const missing = missingRequiredEnvNames()
    expect(missing).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(missing).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(missing).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })
})
