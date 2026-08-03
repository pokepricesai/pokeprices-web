// Block 5A-W-50G-B — Bulbagarden matcher unit tests.

import { describe, it, expect } from 'vitest'
import {
  matchBulbagardenFor,
  scoreFile,
  type BulbagardenFile,
  type PokePricesSetLite,
} from '../jpBulbagardenMatch'

const pp = (over: Partial<PokePricesSetLite> = {}): PokePricesSetLite => ({
  set_name:         'Japanese Battle Partners',
  set_release_date: '2025-01-24',
  language:         'jp',
  ...over,
})

const bg = (over: Partial<BulbagardenFile> = {}): BulbagardenFile => ({
  archive_title:        'File:SetSymbolBattlePartners.png',
  source_url:           'https://archives.bulbagarden.net/media/upload/x/xx/SetSymbolBattlePartners.png',
  thumb_url:            null,
  mime:                 'image/png',
  width:                128,
  height:               128,
  description_page_url: null,
  categories:           ['Category:Japanese TCG set symbols'],
  linked_pages:         ['Battle Partners (TCG)'],
  asset_type:           'symbol',
  is_english_market_likely: false,
  retrieved_at:         '2026-08-03T00:00:00Z',
  ...over,
})

// ── Scoring individual files ──────────────────────────

describe('scoreFile — positive signals', () => {
  it('scores highly for a file linked from the "(TCG)" page + JP category + correct asset type', () => {
    const r = scoreFile(pp(), bg(), 'symbol')
    expect(r.score).toBeGreaterThan(50)
    expect(r.reasons.some(x => /linked from page/.test(x))).toBe(true)
    expect(r.reasons.some(x => /category signals Japanese symbol/.test(x))).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('archive title matching alone contributes but doesn\'t confirm', () => {
    const r = scoreFile(pp(), bg({
      linked_pages: [], categories: [], asset_type: 'unknown',
    }), 'logo')
    // Only archive-title match remains.
    expect(r.score).toBeLessThan(30)
  })
})

describe('scoreFile — negative signals + rejections', () => {
  it('English-market asset gets an English warning + heavy score reduction', () => {
    const withoutEn = scoreFile(pp({ set_name: 'Japanese Neo Genesis' }), bg({
      archive_title: 'File:Neo_Genesis_Logo.png',
      linked_pages: ['Neo Genesis (TCG)'],
      is_english_market_likely: false,
      asset_type: 'logo',
    }), 'logo')
    const withEn = scoreFile(pp({ set_name: 'Japanese Neo Genesis' }), bg({
      archive_title: 'File:Neo_Genesis_Logo_EN.png',
      linked_pages: ['Neo Genesis (TCG)'],
      is_english_market_likely: true,
      asset_type: 'logo',
    }), 'logo')
    expect(withEn.warnings.some(w => /English-market/.test(w))).toBe(true)
    // Same-set English candidate scores at least 40 points below the
    // non-English variant (matches ENGLISH_MARKET_LIKELY weight).
    expect(withoutEn.score - withEn.score).toBeGreaterThanOrEqual(40)
  })

  it('pack image gets a wrong-asset-type warning + score below any logo', () => {
    const packR = scoreFile(pp(), bg({
      archive_title: 'File:SV9_Battle_Partners_pack.png',
      asset_type: 'pack',
    }), 'logo')
    const logoR = scoreFile(pp(), bg({
      archive_title: 'File:SetLogoBattlePartners.png',
      asset_type: 'logo',
    }), 'logo')
    expect(packR.warnings.some(w => /wrong asset/.test(w))).toBe(true)
    // A real logo for the same set must outscore a pack shot by at
    // least the wrong-asset penalty spread (40+).
    expect(logoR.score - packR.score).toBeGreaterThanOrEqual(40)
  })

  it('tiny image asked for as a logo triggers a warning', () => {
    const r = scoreFile(pp(), bg({ width: 40, height: 40, asset_type: 'unknown' }), 'logo')
    expect(r.warnings.some(w => /tiny image/.test(w))).toBe(true)
  })
})

// ── Aggregate matching per set ─────────────────────────

describe('matchBulbagardenFor', () => {
  it('CONFIRMED_AUTOMATIC symbol + NO_MATCH logo when only a symbol candidate exists', () => {
    const files = [bg()] // one JP symbol candidate
    const r = matchBulbagardenFor(pp(), files)
    expect(r.symbolClassification).toBe('CONFIRMED_AUTOMATIC')
    expect(r.symbolBest?.file.archive_title).toBe('File:SetSymbolBattlePartners.png')
    expect(r.logoClassification).toBe('NO_MATCH')
    expect(r.logoBest).toBeNull()
  })

  it('English-flagged best candidate demotes to NO_MATCH regardless of score', () => {
    const files: BulbagardenFile[] = [
      bg({
        archive_title: 'File:Neo_Genesis_Logo_EN.png',
        linked_pages: ['Neo Genesis (TCG)'],
        is_english_market_likely: true,
        asset_type: 'logo',
      }),
    ]
    const r = matchBulbagardenFor(pp({ set_name: 'Japanese Neo Genesis' }), files)
    expect(r.logoClassification).toBe('NO_MATCH')
  })

  it('WRONG_ASSET_TYPE when the only candidate is a pack shot', () => {
    const files: BulbagardenFile[] = [
      bg({
        archive_title: 'File:SV9_Battle_Partners_pack.png',
        asset_type: 'pack',
        linked_pages: ['Battle Partners (TCG)'],
        categories: [],
      }),
    ]
    const r = matchBulbagardenFor(pp(), files)
    // Symbol lookup ignores non-symbol assets → NO_MATCH.
    expect(r.symbolClassification).toBe('NO_MATCH')
    // Logo lookup sees the pack as best-but-wrong-type.
    expect(r.logoClassification).toBe('WRONG_ASSET_TYPE')
  })

  it('AMBIGUOUS when two logo candidates score close together', () => {
    const shared = { linked_pages: ['Battle Partners (TCG)'], asset_type: 'logo' as const, is_english_market_likely: false }
    const files: BulbagardenFile[] = [
      bg({ archive_title: 'File:BattlePartnersLogo_v1.png', ...shared }),
      bg({ archive_title: 'File:BattlePartnersLogo_v2.png', ...shared }),
    ]
    const r = matchBulbagardenFor(pp(), files)
    expect(r.logoClassification).toBe('AMBIGUOUS')
    expect(r.logoAlternates.length).toBeGreaterThanOrEqual(1)
  })

  it('NO_MATCH when no candidate clears the probable threshold', () => {
    const files: BulbagardenFile[] = [
      bg({
        archive_title: 'File:Completely_Unrelated.png',
        linked_pages: ['Some Other Page'],
        categories: [],
        asset_type: 'unknown',
        is_english_market_likely: false,
      }),
    ]
    const r = matchBulbagardenFor(pp(), files)
    expect(r.logoClassification).toBe('NO_MATCH')
    expect(r.symbolClassification).toBe('NO_MATCH')
  })
})

// ── Paired expansion / punctuation-heavy names ────────

describe('name normalisation carries through', () => {
  it('smart apostrophes still find the correct page match', () => {
    const files: BulbagardenFile[] = [
      bg({
        archive_title: "File:SetSymbolLeadersStadium.png",
        linked_pages: ["Leaders' Stadium (TCG)"],
        asset_type: 'symbol',
      }),
    ]
    const r = matchBulbagardenFor(pp({ set_name: "Japanese Leaders’ Stadium" }), files)
    expect(r.symbolClassification === 'CONFIRMED_AUTOMATIC' || r.symbolClassification === 'PROBABLE_REVIEW').toBe(true)
  })
})
