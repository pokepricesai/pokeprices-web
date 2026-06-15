// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractUtmFromUrl,
  extractReferrerDomain,
  hasMeaningfulAttribution,
  captureAttribution,
  getAttribution,
  attributionDimensions,
  clearAttribution,
  FIRST_TOUCH_KEY,
  LAST_TOUCH_KEY,
} from '../attribution'

describe('extractUtmFromUrl', () => {
  it('parses standard utm parameters', () => {
    const out = extractUtmFromUrl('?utm_source=newsletter&utm_medium=email&utm_campaign=jul&utm_content=top&utm_term=psa10')
    expect(out).toEqual({
      utm_source:   'newsletter',
      utm_medium:   'email',
      utm_campaign: 'jul',
      utm_content:  'top',
      utm_term:     'psa10',
    })
  })

  it('accepts a search string without the leading ?', () => {
    const out = extractUtmFromUrl('utm_source=reddit')
    expect(out.utm_source).toBe('reddit')
  })

  it('ignores non-utm params', () => {
    const out = extractUtmFromUrl('?foo=bar&utm_source=x')
    expect(Object.keys(out)).toEqual(['utm_source'])
  })

  it('truncates long values', () => {
    const longVal = 'a'.repeat(200)
    const out = extractUtmFromUrl('?utm_source=' + longVal)
    expect(out.utm_source?.length).toBe(100)
  })
})

describe('extractReferrerDomain', () => {
  it('returns the hostname only — never the full URL', () => {
    expect(extractReferrerDomain('https://reddit.com/r/PokemonTCG/comments/xyz?q=secret')).toBe('reddit.com')
  })

  it('handles missing or invalid input', () => {
    expect(extractReferrerDomain('')).toBeUndefined()
    expect(extractReferrerDomain(null)).toBeUndefined()
    expect(extractReferrerDomain('not a url')).toBeUndefined()
  })
})

describe('hasMeaningfulAttribution', () => {
  it('false for empty payload', () => {
    expect(hasMeaningfulAttribution({})).toBe(false)
    expect(hasMeaningfulAttribution({ captured_at: 1 })).toBe(false)
  })

  it('true when any utm or referrer present', () => {
    expect(hasMeaningfulAttribution({ utm_source: 'x' })).toBe(true)
    expect(hasMeaningfulAttribution({ referrer_domain: 'reddit.com' })).toBe(true)
  })
})

describe('captureAttribution + getAttribution', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // Reset the jsdom URL between tests.
    window.history.replaceState({}, '', '/')
    Object.defineProperty(document, 'referrer', { value: '', configurable: true })
  })

  it('stores first-touch + last-touch when UTMs are present', () => {
    window.history.replaceState({}, '', '/?utm_source=newsletter&utm_campaign=jul')
    captureAttribution(1_700_000_000_000)
    const { first_touch, last_touch } = getAttribution()
    expect(first_touch?.utm_source).toBe('newsletter')
    expect(last_touch?.utm_campaign).toBe('jul')
  })

  it('does not overwrite first-touch on a fresh capture before expiry', () => {
    window.history.replaceState({}, '', '/?utm_source=newsletter')
    captureAttribution(1_700_000_000_000)
    window.history.replaceState({}, '', '/?utm_source=reddit')
    captureAttribution(1_700_000_001_000)
    const { first_touch, last_touch } = getAttribution()
    expect(first_touch?.utm_source).toBe('newsletter')
    expect(last_touch?.utm_source).toBe('reddit')
  })

  it('does NOT store anything when capture is empty', () => {
    captureAttribution(1_700_000_000_000)
    expect(window.localStorage.getItem(FIRST_TOUCH_KEY)).toBeNull()
    expect(window.localStorage.getItem(LAST_TOUCH_KEY)).toBeNull()
  })

  it('ignores a same-origin referrer', () => {
    Object.defineProperty(document, 'referrer', { value: window.location.origin + '/foo', configurable: true })
    captureAttribution(1)
    expect(window.localStorage.getItem(LAST_TOUCH_KEY)).toBeNull()
  })

  it('captures a cross-origin referrer domain only', () => {
    Object.defineProperty(document, 'referrer', { value: 'https://twitter.com/user/status/123', configurable: true })
    captureAttribution(1)
    const { first_touch, last_touch } = getAttribution()
    expect(first_touch?.referrer_domain).toBe('twitter.com')
    expect(last_touch?.referrer_domain).toBe('twitter.com')
  })

  it('exposes a flat dimensions object for events', () => {
    window.history.replaceState({}, '', '/?utm_source=newsletter')
    captureAttribution(1)
    const d = attributionDimensions()
    expect(d['ft_utm_source']).toBe('newsletter')
    expect(d['lt_utm_source']).toBe('newsletter')
  })

  it('clearAttribution wipes both keys', () => {
    window.history.replaceState({}, '', '/?utm_source=newsletter')
    captureAttribution(1)
    clearAttribution()
    expect(getAttribution()).toEqual({ first_touch: undefined, last_touch: undefined })
  })
})
