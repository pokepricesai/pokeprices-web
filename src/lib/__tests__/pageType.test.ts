import { describe, it, expect } from 'vitest'
import { classifyPageType } from '../pageType'

describe('classifyPageType', () => {
  it('returns other for null / undefined / empty', () => {
    expect(classifyPageType(null)).toBe('other')
    expect(classifyPageType(undefined)).toBe('other')
    expect(classifyPageType('')).toBe('other')
  })

  it('detects the homepage', () => {
    expect(classifyPageType('/')).toBe('homepage')
  })

  it('classifies card pages from the set/card url shape', () => {
    expect(classifyPageType('/set/Base%20Set/card/charizard-4-102')).toBe('card')
  })

  it('classifies set pages that do not contain /card/', () => {
    expect(classifyPageType('/set/Base%20Set')).toBe('set')
  })

  it('classifies pokemon, illustrator, creator, insight, card-show, vendor, browse', () => {
    expect(classifyPageType('/pokemon/charizard')).toBe('pokemon')
    expect(classifyPageType('/illustrators/mitsuhiro-arita')).toBe('illustrator')
    expect(classifyPageType('/creators/some-creator')).toBe('creator')
    expect(classifyPageType('/insights/2026-recap')).toBe('insight')
    expect(classifyPageType('/card-shows/us/collect-a-con')).toBe('card_show')
    expect(classifyPageType('/vendors/charizards-den')).toBe('vendor')
    expect(classifyPageType('/browse')).toBe('browse')
  })

  it('classifies dashboard sub-paths separately', () => {
    expect(classifyPageType('/dashboard')).toBe('dashboard')
    expect(classifyPageType('/dashboard/portfolio')).toBe('dashboard')
    expect(classifyPageType('/dashboard/quick-price')).toBe('quick_price')
    expect(classifyPageType('/dashboard/grading')).toBe('grading')
  })

  it('classifies auth and ai_assistant', () => {
    expect(classifyPageType('/auth/callback')).toBe('auth')
    expect(classifyPageType('/auth/reset-password')).toBe('auth')
    expect(classifyPageType('/ai-assistant')).toBe('ai_assistant')
  })
})
