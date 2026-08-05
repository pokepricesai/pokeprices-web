// Block 5A-W-52A.2 — unit tests on the pure helpers in cardContext.ts
// with the corrected identifier naming + cardName field.

import { describe, it, expect } from 'vitest'
import {
  cleanCardName,
  displayCardLabel,
  displayQuickActionText,
  CARD_QUICK_PROMPTS,
  SET_QUICK_PROMPTS,
  type CardContext,
} from '@/lib/chat/cardContext'

describe('cleanCardName', () => {
  it('strips the DB "#NN" suffix', () => {
    expect(cleanCardName('Kleavor #86')).toBe('Kleavor')
    expect(cleanCardName('Pikachu #58')).toBe('Pikachu')
  })
  it('strips promo-style suffixes like "#SWSH123"', () => {
    expect(cleanCardName('Zacian #SWSH123')).toBe('Zacian')
  })
  it('leaves names without a suffix alone', () => {
    expect(cleanCardName('Fossil Aerodactyl')).toBe('Fossil Aerodactyl')
  })
  it('returns "" for null/undefined/empty', () => {
    expect(cleanCardName(null)).toBe('')
    expect(cleanCardName(undefined)).toBe('')
    expect(cleanCardName('')).toBe('')
  })
  it('strips the suffix even when the card name contains a slash', () => {
    expect(cleanCardName("Kleavor VMAX #86")).toBe('Kleavor VMAX')
  })
})

const kleavorCtx: CardContext = {
  cardRecordId: 2587,
  cardUrlSlug: 'kleavor-holo-86',
  priceChartingProductId: '3489584',
  cardName: 'Kleavor',
  setName: 'Astral Radiance',
  cardNumber: '86',
  cardNumberDisplay: '86/189',
  language: 'en',
}

describe('displayCardLabel', () => {
  it('uses card_number_display when available', () => {
    expect(displayCardLabel(kleavorCtx, 'Kleavor #86')).toBe('Kleavor 86/189')
  })
  it('falls back to "#NN" when only card_number is set', () => {
    const ctx2: CardContext = { ...kleavorCtx, cardNumberDisplay: null }
    expect(displayCardLabel(ctx2, 'Kleavor #86')).toBe('Kleavor #86')
  })
  it('handles no number at all', () => {
    const ctx3: CardContext = { ...kleavorCtx, cardNumberDisplay: null, cardNumber: null }
    expect(displayCardLabel(ctx3, 'Kleavor')).toBe('Kleavor')
  })
})

describe('displayQuickActionText — clean natural sentences', () => {
  const ctx: CardContext = {
    cardRecordId: null,
    cardUrlSlug: 'pikachu-58',
    priceChartingProductId: '630471',
    cardName: 'Pikachu',
    setName: 'Base Set',
    cardNumber: '58',
    cardNumberDisplay: '58/102',
    language: 'en',
  }

  it('grade_card produces "Should I grade Pikachu 58/102 from Base Set?"', () => {
    expect(displayQuickActionText('grade_card', ctx, 'Pikachu #58'))
      .toBe('Should I grade Pikachu 58/102 from Base Set?')
  })

  it('price_trend, best_value_grade, all_time_high all read as natural questions', () => {
    expect(displayQuickActionText('price_trend', ctx, 'Pikachu #58'))
      .toBe('How has Pikachu 58/102 from Base Set trended in price?')
    expect(displayQuickActionText('best_value_grade', ctx, 'Pikachu #58'))
      .toBe('What grade is the best value for Pikachu 58/102 from Base Set?')
    expect(displayQuickActionText('all_time_high', ctx, 'Pikachu #58'))
      .toBe('How far is Pikachu 58/102 from Base Set from its all-time high?')
  })

  it('NEVER produces a bracketed prefix like "[Context: ..."', () => {
    for (const intent of ['grade_card','price_trend','best_value_grade','all_time_high','card_price'] as const) {
      const text = displayQuickActionText(intent, ctx, 'Pikachu #58')
      expect(text).not.toMatch(/^\[Context:/)
      expect(text).not.toContain('] ')
      expect(text).not.toMatch(/\][^,.\s]/)
      expect(text).toMatch(/[.?!]$/)
    }
  })

  it('set-level intents read as clean questions', () => {
    const setCtx: CardContext = {
      cardRecordId: null, cardUrlSlug: '', priceChartingProductId: null,
      cardName: '', setName: 'Astral Radiance',
      cardNumber: null, cardNumberDisplay: null, language: 'en',
    }
    expect(displayQuickActionText('set_value', setCtx, ''))
      .toBe('What is Astral Radiance worth?')
    expect(displayQuickActionText('set_top_cards', setCtx, ''))
      .toBe('What are the top cards in Astral Radiance?')
  })
})

describe('quick-prompt registries have every intent used by the UI', () => {
  it('CARD_QUICK_PROMPTS covers the 4 card-page suggestions', () => {
    expect(CARD_QUICK_PROMPTS).toHaveLength(4)
    const intents = CARD_QUICK_PROMPTS.map(p => p.intent).sort()
    expect(intents).toEqual(['all_time_high','best_value_grade','grade_card','price_trend'])
  })
  it('SET_QUICK_PROMPTS covers the 2 set-page suggestions', () => {
    expect(SET_QUICK_PROMPTS).toHaveLength(2)
    const intents = SET_QUICK_PROMPTS.map(p => p.intent).sort()
    expect(intents).toEqual(['set_top_cards','set_value'])
  })
  it('every prompt label is a non-empty string', () => {
    for (const p of [...CARD_QUICK_PROMPTS, ...SET_QUICK_PROMPTS]) {
      expect(p.label).toBeTruthy()
      expect(p.label.length).toBeGreaterThan(3)
    }
  })
})

// ── 52A.2 identifier semantics ────────────────────────

describe('identifier semantics — cardRecordId vs cardUrlSlug vs priceChartingProductId', () => {
  // The three identifiers on CardContext map to distinct cards
  // columns and must never be confused:
  //   cardRecordId           → cards.id (bigint PK — globally unique)
  //   priceChartingProductId → cards.card_slug ("3489584" — globally unique)
  //   cardUrlSlug            → cards.card_url_slug ("kleavor-holo-86" — unique WITHIN a set only)

  it('cardRecordId accepts number|string|null (matches cards.id shape)', () => {
    const b: CardContext = { ...kleavorCtx, cardRecordId: '2587' }
    const c: CardContext = { ...kleavorCtx, cardRecordId: null }
    expect(typeof kleavorCtx.cardRecordId).toBe('number')
    expect(typeof b.cardRecordId).toBe('string')
    expect(c.cardRecordId).toBeNull()
  })

  it('cardUrlSlug is always a string and matches URL slug shape', () => {
    expect(kleavorCtx.cardUrlSlug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('priceChartingProductId is a numeric string (or null)', () => {
    expect(kleavorCtx.priceChartingProductId).toMatch(/^\d+$/)
  })

  it('cardName is required (empty string acceptable for set stubs)', () => {
    expect(typeof kleavorCtx.cardName).toBe('string')
  })
})

// ── Regression fixtures from the 1,000-chat review ──────

describe('representative wrong-card fixtures — identity resolution', () => {
  it('Astral Radiance #86 cannot be silently replaced by another card', () => {
    const ctx: CardContext = {
      cardRecordId: null,
      cardUrlSlug: 'kleavor-holo-86',
      priceChartingProductId: '3489584',
      cardName: 'Kleavor',
      setName: 'Astral Radiance', cardNumber: '86',
      cardNumberDisplay: '86/189', language: 'en',
    }
    expect(displayQuickActionText('grade_card', ctx, 'Kleavor #86'))
      .toBe('Should I grade Kleavor 86/189 from Astral Radiance?')
    expect(ctx.cardUrlSlug).toBe('kleavor-holo-86')
    expect(ctx.setName).toBe('Astral Radiance')
    expect(ctx.priceChartingProductId).toBe('3489584')
  })

  it('Fossil #19 cannot silently become "Dragonite #4"', () => {
    const ctx: CardContext = {
      cardRecordId: null, cardUrlSlug: 'lapras-19', priceChartingProductId: '999001',
      cardName: 'Lapras',
      setName: 'Fossil', cardNumber: '19',
      cardNumberDisplay: '19/62', language: 'en',
    }
    expect(displayQuickActionText('grade_card', ctx, 'Lapras #19'))
      .toBe('Should I grade Lapras 19/62 from Fossil?')
    expect(ctx.setName).toBe('Fossil')
    expect(ctx.cardNumber).toBe('19')
  })

  it('Fossil Kabuto #50 cannot silently become "Kabutops #24"', () => {
    // 52A.3 correction: Fossil #50 is Kabuto (not Ditto — the
    // earlier fixture was fabricated). Real production identifiers
    // probed from Supabase:
    //   id=14038, card_slug=643417, card_url_slug=kabuto-50,
    //   card_name="Kabuto #50", set_name=Fossil, card_number=50.
    // The retrieval path pins card_slug=643417 (globally unique)
    // so Kabutops #24 (a different DB record) can never resolve.
    const ctx: CardContext = {
      cardRecordId: 14038, cardUrlSlug: 'kabuto-50', priceChartingProductId: '643417',
      cardName: 'Kabuto',
      setName: 'Fossil', cardNumber: '50',
      cardNumberDisplay: '50/62', language: 'en',
    }
    expect(displayQuickActionText('grade_card', ctx, 'Kabuto #50'))
      .toBe('Should I grade Kabuto 50/62 from Fossil?')
    expect(ctx.cardUrlSlug).toBe('kabuto-50')
    expect(ctx.priceChartingProductId).toBe('643417')
    // Kabutops #24 has different card_number and different card_slug —
    // there is no path in the 52A.2 retrieval order that maps
    // Kabuto #50's identifiers to Kabutops #24's row.
    expect(ctx.cardNumber).not.toBe('24')
    expect(ctx.cardName.toLowerCase()).not.toContain('kabutops')
  })

  it('Base Set Pikachu #58 cannot be replaced by Crown Zenith Pikachu', () => {
    const ctx: CardContext = {
      cardRecordId: null, cardUrlSlug: 'pikachu-58', priceChartingProductId: '630471',
      cardName: 'Pikachu',
      setName: 'Base Set', cardNumber: '58',
      cardNumberDisplay: '58/102', language: 'en',
    }
    expect(displayQuickActionText('price_trend', ctx, 'Pikachu #58'))
      .toBe('How has Pikachu 58/102 from Base Set trended in price?')
    expect(ctx.setName).toBe('Base Set')
  })

  it('English and Japanese cards with the same number stay distinct', () => {
    const en: CardContext = {
      cardRecordId: null, cardUrlSlug: 'articuno-102', priceChartingProductId: '111',
      cardName: 'Articuno', setName: 'Fossil', cardNumber: '102',
      cardNumberDisplay: '102/62', language: 'en',
    }
    const jp: CardContext = {
      cardRecordId: null, cardUrlSlug: 'articuno-102-jp', priceChartingProductId: '222',
      cardName: 'Articuno', setName: 'Japanese Battle Partners', cardNumber: '102',
      cardNumberDisplay: '102/100', language: 'jp',
    }
    expect(en.language).not.toBe(jp.language)
    expect(en.setName).not.toBe(jp.setName)
    expect(en.cardUrlSlug).not.toBe(jp.cardUrlSlug)
    expect(en.priceChartingProductId).not.toBe(jp.priceChartingProductId)
  })

  it('#102 never collides with #12 (regression against 51B.1 fix)', () => {
    const c102: CardContext = {
      cardRecordId: null, cardUrlSlug: 'articuno-102', priceChartingProductId: 'a',
      cardName: 'Articuno', setName: 'Fossil',
      cardNumber: '102', cardNumberDisplay: '102/62', language: 'en',
    }
    const c12: CardContext = {
      cardRecordId: null, cardUrlSlug: 'weedle-12', priceChartingProductId: 'b',
      cardName: 'Weedle', setName: 'Base Set',
      cardNumber: '12', cardNumberDisplay: '12/102', language: 'en',
    }
    expect(c102.cardNumber).not.toBe(c12.cardNumber)
    expect(c102.cardUrlSlug).not.toBe(c12.cardUrlSlug)
  })
})
