import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveFromAddress, resolveReplyTo } from '../from'

const KEYS = ['EMAIL_FROM_ADDRESS', 'EMAIL_REPLY_TO'] as const
let snapshot: Record<string, string | undefined>

beforeEach(() => {
  snapshot = {}
  for (const k of KEYS) snapshot[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
})

describe('resolveFromAddress', () => {
  it('falls back to PokePrices hello@', () => {
    expect(resolveFromAddress()).toBe('PokePrices <hello@pokeprices.io>')
  })

  it('honours the env override', () => {
    process.env.EMAIL_FROM_ADDRESS = 'PokePrices <news@pokeprices.io>'
    expect(resolveFromAddress()).toBe('PokePrices <news@pokeprices.io>')
  })

  it('treats whitespace as unset', () => {
    process.env.EMAIL_FROM_ADDRESS = '   '
    expect(resolveFromAddress()).toBe('PokePrices <hello@pokeprices.io>')
  })
})

describe('resolveReplyTo', () => {
  it('falls back to hello@', () => {
    expect(resolveReplyTo()).toBe('hello@pokeprices.io')
  })

  it('honours the env override', () => {
    process.env.EMAIL_REPLY_TO = 'support@pokeprices.io'
    expect(resolveReplyTo()).toBe('support@pokeprices.io')
  })
})
