import { describe, it, expect } from 'vitest'
import {
  ALL_EMAIL_CATEGORIES,
  EMAIL_CATEGORIES,
  isMarketing,
  isTransactional,
  isValidEmailCategory,
} from '../categories'

describe('email categories', () => {
  it('exposes the full list', () => {
    expect([...ALL_EMAIL_CATEGORIES].sort()).toEqual([
      'card_show_reminder',
      'marketing_newsletter',
      'onboarding',
      'service_product',
      'transactional',
      'watchlist_alert',
      'weekly_report',
    ])
  })

  it('isMarketing is true only for marketing_newsletter', () => {
    for (const c of ALL_EMAIL_CATEGORIES) {
      expect(isMarketing(c)).toBe(c === EMAIL_CATEGORIES.MARKETING_NEWSLETTER)
    }
  })

  it('isTransactional is true only for transactional', () => {
    for (const c of ALL_EMAIL_CATEGORIES) {
      expect(isTransactional(c)).toBe(c === EMAIL_CATEGORIES.TRANSACTIONAL)
    }
  })

  it('isValidEmailCategory rejects unknown values', () => {
    expect(isValidEmailCategory('marketing_newsletter')).toBe(true)
    expect(isValidEmailCategory('something_else')).toBe(false)
    expect(isValidEmailCategory(null)).toBe(false)
    expect(isValidEmailCategory(42)).toBe(false)
  })
})
