// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setIntendedAction,
  consumeIntendedAction,
  peekIntendedAction,
  clearIntendedAction,
} from '../intendedAction'

const SAMPLE = {
  type: 'watchlist_add',
  payload: { card_slug: 'pikachu-123', card_name: 'Pikachu', set_name: 'Base Set' },
} as const

describe('intendedAction', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('round-trips a watchlist intent', () => {
    setIntendedAction(SAMPLE)
    const got = consumeIntendedAction()
    expect(got).not.toBeNull()
    expect(got?.type).toBe('watchlist_add')
    expect((got as any).payload.card_slug).toBe('pikachu-123')
  })

  it('returns null when nothing is stored', () => {
    expect(consumeIntendedAction()).toBeNull()
  })

  it('clears the entry on consume', () => {
    setIntendedAction(SAMPLE)
    consumeIntendedAction()
    expect(consumeIntendedAction()).toBeNull()
    expect(peekIntendedAction()).toBeNull()
  })

  it('peek does not clear the entry', () => {
    setIntendedAction(SAMPLE)
    const peeked = peekIntendedAction()
    expect(peeked).not.toBeNull()
    const consumed = consumeIntendedAction()
    expect(consumed).not.toBeNull()
  })

  it('clearIntendedAction wipes the entry', () => {
    setIntendedAction(SAMPLE)
    clearIntendedAction()
    expect(consumeIntendedAction()).toBeNull()
  })

  it('rejects an unknown action type', () => {
    window.sessionStorage.setItem('pp_intended_action_v1', JSON.stringify({ type: 'phishing', payload: {}, ts: Date.now() }))
    expect(consumeIntendedAction()).toBeNull()
  })

  it('rejects an expired entry', () => {
    window.sessionStorage.setItem('pp_intended_action_v1', JSON.stringify({ ...SAMPLE, ts: Date.now() - 60 * 60 * 1000 }))
    expect(consumeIntendedAction()).toBeNull()
  })

  it('handles a card_show_star intent', () => {
    setIntendedAction({ type: 'card_show_star', payload: { show_id: 'us-collect-a-con-dallas-2026-10' } })
    const got = consumeIntendedAction()
    expect(got?.type).toBe('card_show_star')
    expect((got as any).payload.show_id).toBe('us-collect-a-con-dallas-2026-10')
  })

  // ── Block 5A-W-50B-FIX1 additions ─────────────────────────────

  it('accepts portfolio_open with origin_set_name', () => {
    setIntendedAction({
      type: 'portfolio_open',
      payload: {
        card_slug: '8330138', card_name: "Aura's Lucario",
        set_name: 'Japanese Promo', origin_set_name: 'Japanese Promo',
      },
    })
    const got = consumeIntendedAction()
    expect(got?.type).toBe('portfolio_open')
    expect((got as any).payload.origin_set_name).toBe('Japanese Promo')
    expect((got as any).payload.card_slug).toBe('8330138')
  })

  it('watchlist_add persists origin_set_name for set-scoped replay', () => {
    setIntendedAction({
      type: 'watchlist_add',
      payload: {
        card_slug: '111', card_name: 'X', set_name: 'Base Set',
        origin_set_name: 'Base Set',
      },
    })
    const got = peekIntendedAction()
    expect((got as any).payload.origin_set_name).toBe('Base Set')
  })

  it('peek preserves the entry across multiple reads', () => {
    setIntendedAction({
      type: 'portfolio_open',
      payload: { card_slug: '1', card_name: 'X', set_name: 's', origin_set_name: 's' },
    })
    expect(peekIntendedAction()).not.toBeNull()
    expect(peekIntendedAction()).not.toBeNull()
    expect(peekIntendedAction()).not.toBeNull()
    // Consume once, then peek returns null
    consumeIntendedAction()
    expect(peekIntendedAction()).toBeNull()
  })

  it('malformed JSON is refused without throwing', () => {
    window.sessionStorage.setItem('pp_intended_action_v1', '{not json')
    expect(peekIntendedAction()).toBeNull()
    expect(consumeIntendedAction()).toBeNull()
  })
})
