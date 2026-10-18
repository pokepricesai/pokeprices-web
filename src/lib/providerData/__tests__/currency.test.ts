import { describe, it, expect } from 'vitest'
import { convertForDisplay, formatPrice, parseDisplayCcy, type FxTable } from '../currency'

const FX: FxTable = {
  as_of: '2026-10-18',
  rates: { USD_EUR: 0.92, EUR_USD: 1.0870, USD_USD: 1, EUR_EUR: 1 },
}

describe('currency: parseDisplayCcy', () => {
  it('defaults to USD for unknown values', () => {
    expect(parseDisplayCcy(null)).toBe('USD')
    expect(parseDisplayCcy(undefined)).toBe('USD')
    expect(parseDisplayCcy('GBP')).toBe('USD')
    expect(parseDisplayCcy('')).toBe('USD')
  })
  it('accepts EUR explicitly', () => {
    expect(parseDisplayCcy('EUR')).toBe('EUR')
  })
})

describe('currency: identity (no conversion)', () => {
  it('USD→USD passes through, no note', () => {
    const r = convertForDisplay(10.50, 'USD', 'USD', FX)
    expect(r.converted).toBe(10.50)
    expect(r.isConverted).toBe(false)
    expect(r.note).toBeNull()
  })
  it('EUR→EUR passes through, no note', () => {
    const r = convertForDisplay(10.50, 'EUR', 'EUR', FX)
    expect(r.converted).toBe(10.50)
    expect(r.isConverted).toBe(false)
  })
})

describe('currency: conversion with FX', () => {
  it('USD→EUR uses USD_EUR rate', () => {
    const r = convertForDisplay(100, 'USD', 'EUR', FX)
    expect(r.converted).toBe(92)
    expect(r.isConverted).toBe(true)
    expect(r.note).toContain('Converted from USD')
    expect(r.note).toContain('0.9200')
    expect(r.note).toContain('2026-10-18')
  })
  it('EUR→USD uses EUR_USD rate', () => {
    const r = convertForDisplay(100, 'EUR', 'USD', FX)
    expect(r.converted).toBeCloseTo(108.70, 2)
    expect(r.isConverted).toBe(true)
    expect(r.note).toContain('Converted from EUR')
  })
})

describe('currency: safety invariants', () => {
  it('null value → null converted, no methodology leak', () => {
    const r = convertForDisplay(null, 'USD', 'EUR', FX)
    expect(r.converted).toBeNull()
    expect(r.note).toBeNull()
  })
  it('no FX table → null converted, honest "FX unavailable" note', () => {
    const r = convertForDisplay(100, 'USD', 'EUR', null)
    expect(r.converted).toBeNull()
    expect(r.isConverted).toBe(false)
    expect(r.note).toContain('FX unavailable')
  })
  it('missing specific pair → null converted, honest "no rate" note', () => {
    const partial: FxTable = { as_of: '2026-10-18', rates: { USD_USD: 1 } }
    const r = convertForDisplay(100, 'USD', 'EUR', partial)
    expect(r.converted).toBeNull()
    expect(r.note).toContain('No USD→EUR rate')
  })

  it('converted amount is NEVER presented without a methodology note (defence against silent mislabeling)', () => {
    const r = convertForDisplay(100, 'USD', 'EUR', FX)
    expect(r.isConverted).toBe(true)
    expect(r.note).not.toBeNull()
    expect(r.note!.length).toBeGreaterThan(10)
  })
})

describe('currency: formatPrice', () => {
  it('formats USD with $, EUR with €', () => {
    expect(formatPrice(12.34, 'USD')).toBe('$12.34')
    expect(formatPrice(12.34, 'EUR')).toBe('€12.34')
  })
  it('rounds large values with thousands separators', () => {
    expect(formatPrice(1234.5, 'USD')).toBe('$1,235')
    expect(formatPrice(9999.9, 'EUR')).toBe('€10,000')
  })
  it('returns em-dash for null', () => {
    expect(formatPrice(null, 'USD')).toBe('—')
    expect(formatPrice(undefined, 'EUR')).toBe('—')
  })
})
