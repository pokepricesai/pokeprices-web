// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { trackEvent, setAuthContext } from '../analytics'

describe('analytics.trackEvent', () => {
  let gtagCalls: any[][]

  beforeEach(() => {
    gtagCalls = []
    ;(window as any).gtag = (...args: any[]) => { gtagCalls.push(args) }
    setAuthContext('anonymous')
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('is a no-op when gtag is missing', () => {
    delete (window as any).gtag
    expect(() => trackEvent('watchlist_add_attempt', { card_slug: 'pikachu-58' })).not.toThrow()
  })

  it('attaches auth_state, user_plan and page_type automatically', () => {
    setAuthContext('authenticated')
    window.history.replaceState({}, '', '/dashboard/portfolio')
    trackEvent('watchlist_add_attempt', { card_slug: 'pikachu-58' })
    expect(gtagCalls.length).toBe(1)
    const [, name, params] = gtagCalls[0]
    expect(name).toBe('watchlist_add_attempt')
    expect(params.auth_state).toBe('authenticated')
    expect(params.user_plan).toBe('free')
    expect(params.page_type).toBe('dashboard')
  })

  it('drops forbidden parameter names silently', () => {
    trackEvent('watchlist_add_attempt' as any, {
      card_slug: 'pikachu-58',
      email:     'leak@example.com',
      user_id:   'abc-123',
      prompt:    'My private prompt',
      password:  'hunter2',
      notes:     'private',
      portfolio_value: 1000,
    } as any)
    const params = gtagCalls[0][2]
    expect(params.card_slug).toBe('pikachu-58')
    expect('email'    in params).toBe(false)
    expect('user_id'  in params).toBe(false)
    expect('prompt'   in params).toBe(false)
    expect('password' in params).toBe(false)
    expect('notes'    in params).toBe(false)
    expect('portfolio_value' in params).toBe(false)
  })

  it('rejects forbidden names regardless of casing', () => {
    trackEvent('watchlist_add_attempt' as any, { Email: 'x@y' } as any)
    expect('email' in gtagCalls[0][2]).toBe(false)
    expect('Email' in gtagCalls[0][2]).toBe(false)
  })

  it('truncates over-long string values', () => {
    const big = 'x'.repeat(500)
    trackEvent('watchlist_add_attempt', { card_slug: big })
    expect(gtagCalls[0][2].card_slug.length).toBe(100)
  })

  it('drops non-primitive values rather than serialising them', () => {
    trackEvent('watchlist_add_attempt' as any, {
      card_slug: 'pikachu-58',
      payload:   { nested: 'object' },
      arr:       [1, 2, 3],
    } as any)
    const params = gtagCalls[0][2]
    expect(params.card_slug).toBe('pikachu-58')
    expect('payload' in params).toBe(false)
    expect('arr' in params).toBe(false)
  })

  it('classifies the page from window.location.pathname', () => {
    window.history.replaceState({}, '', '/set/Base%20Set/card/charizard-4-102')
    trackEvent('affiliate_click', { placement: 'card_page_chips' })
    expect(gtagCalls[0][2].page_type).toBe('card')
  })

  it('never throws even when the helper is misused', () => {
    expect(() => trackEvent('watchlist_add_attempt', undefined as any)).not.toThrow()
    expect(() => trackEvent('watchlist_add_attempt', null as any)).not.toThrow()
    expect(() => trackEvent('watchlist_add_attempt', 42 as any)).not.toThrow()
  })

  it('respects setAuthContext for plan derivation', () => {
    setAuthContext('authenticated')
    trackEvent('dashboard_view', { feature_name: 'hub' })
    expect(gtagCalls[0][2].user_plan).toBe('free')
    setAuthContext('anonymous')
    trackEvent('dashboard_view', { feature_name: 'hub' })
    expect(gtagCalls[1][2].user_plan).toBe('anonymous')
  })
})
