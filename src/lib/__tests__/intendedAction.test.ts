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
})
