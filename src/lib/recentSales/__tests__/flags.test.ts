// Block 4B-W-1 — recent-sales feature flags must FAIL CLOSED.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  isIngestionEnabled,
  isAdminViewEnabled,
  isFreePreviewEnabled,
  isProPreviewEnabled,
  isFullCatalogueEnabled,
  readRecentSalesFlagSnapshot,
  RECENT_SALES_FLAG_NAMES,
} from '../flags'

const KEYS = [
  'RECENT_SALES_INGESTION_ENABLED',
  'RECENT_SALES_ADMIN_VIEW_ENABLED',
  'RECENT_SALES_FREE_PREVIEW_ENABLED',
  'RECENT_SALES_PRO_PREVIEW_ENABLED',
  'RECENT_SALES_FULL_CATALOGUE',
] as const

let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

describe('fail-closed defaults', () => {
  it('every flag returns false when its env var is unset', () => {
    expect(isIngestionEnabled()).toBe(false)
    expect(isAdminViewEnabled()).toBe(false)
    expect(isFreePreviewEnabled()).toBe(false)
    expect(isProPreviewEnabled()).toBe(false)
    expect(isFullCatalogueEnabled()).toBe(false)
  })

  it('every flag returns false when its env var is empty / whitespace', () => {
    for (const k of KEYS) process.env[k] = '   '
    expect(isIngestionEnabled()).toBe(false)
    expect(isAdminViewEnabled()).toBe(false)
    expect(isFreePreviewEnabled()).toBe(false)
    expect(isProPreviewEnabled()).toBe(false)
    expect(isFullCatalogueEnabled()).toBe(false)
  })

  it('only the literal string "true" activates a flag', () => {
    process.env.RECENT_SALES_INGESTION_ENABLED = 'true'
    expect(isIngestionEnabled()).toBe(true)
  })

  it('rejects "1", "yes", "TRUE", "True", "false" — strict literal match', () => {
    for (const v of ['1', 'yes', 'TRUE', 'True', 'false', 'enabled', 'on']) {
      process.env.RECENT_SALES_ADMIN_VIEW_ENABLED = v
      expect(isAdminViewEnabled()).toBe(false)
    }
  })
})

describe('isolation between flags', () => {
  it('enabling one flag does not enable any other', () => {
    process.env.RECENT_SALES_INGESTION_ENABLED = 'true'
    expect(isIngestionEnabled()).toBe(true)
    expect(isAdminViewEnabled()).toBe(false)
    expect(isFreePreviewEnabled()).toBe(false)
    expect(isProPreviewEnabled()).toBe(false)
    expect(isFullCatalogueEnabled()).toBe(false)
  })
})

describe('readRecentSalesFlagSnapshot', () => {
  it('reports every flag in a single object', () => {
    process.env.RECENT_SALES_FREE_PREVIEW_ENABLED = 'true'
    process.env.RECENT_SALES_FULL_CATALOGUE       = 'true'
    expect(readRecentSalesFlagSnapshot()).toEqual({
      ingestion:     false,
      adminView:     false,
      freePreview:   true,
      proPreview:    false,
      fullCatalogue: true,
    })
  })
})

describe('RECENT_SALES_FLAG_NAMES', () => {
  it('lists every flag name exactly once and matches the env catalogue', () => {
    expect([...RECENT_SALES_FLAG_NAMES].sort()).toEqual([...KEYS].sort())
  })
})
