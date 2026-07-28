'use client'
// Block 5A-W-47E — Build a Binder game client.
//
// The user gets a preset budget, picks 5 cards without going over,
// then sees a score. Existing card data (popular_card_trends) is
// reused; no schema change. Scoring / stats / filters are all pure
// helpers pinned by unit tests.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fmtUsd, cleanCardName } from '@/lib/gamesUtil'
import {
  BUDGETS_CENTS,
  computeBinderStats,
  isPlayableCard,
  scoreBinder,
  scoreLabel,
  searchCards,
  sortCards,
  TARGET_CARD_COUNT,
  type BinderCard,
  type ScoreBreakdown,
  type SortMode,
} from '@/lib/games/buildABinder'

// ── Data loading ─────────────────────────────────────────────

async function loadPool(): Promise<BinderCard[]> {
  // Pull a wide slice from popular_card_trends. Cap at the highest
  // preset budget so we don't waste bandwidth on cards no user could
  // ever buy inside the game.
  const highestBudget = BUDGETS_CENTS[BUDGETS_CENTS.length - 1]
  const { data, error } = await supabase.from('popular_card_trends')
    .select('card_name, set_name, image_url, card_url_slug, card_number, card_number_display, set_printed_total, current_raw, sales_30d, is_sealed')
    .gt('current_raw', 100)                // reject nothing-priced cards
    .lte('current_raw', highestBudget)     // keep within the game's ceiling
    .order('sales_30d', { ascending: false })
    .limit(400)
  if (error || !data) return []
  return (data as BinderCard[]).filter(isPlayableCard)
}

// ── Component ────────────────────────────────────────────────

export default function BuildABinderClient() {
  const [pool, setPool] = useState<BinderCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [budgetCents, setBudgetCents] = useState<number>(BUDGETS_CENTS[1]) // $100 default
  const [picks, setPicks] = useState<BinderCard[]>([])

  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('popular')

  const [finalisedScore, setFinalisedScore] = useState<ScoreBreakdown | null>(null)

  useEffect(() => {
    (async () => {
      const list = await loadPool()
      if (list.length === 0) {
        setError('No cards available right now. Please try again in a few minutes.')
      }
      setPool(list)
      setLoading(false)
    })()
  }, [])

  const stats = useMemo(() => computeBinderStats(picks, budgetCents), [picks, budgetCents])

  const filteredPool = useMemo(() => {
    // FIX1 — keep unaffordable cards VISIBLE in the pool so the grid
    // doesn't jump/shrink as picks are made. Search + sort still
    // apply; the render decides per-card whether the button is
    // enabled based on the current remaining budget. Cards already
    // in the binder are still excluded so they can't be
    // double-added.
    const chosenSlugs = new Set(picks.map(p => p.card_url_slug))
    const stage1 = pool.filter(c => !chosenSlugs.has(c.card_url_slug))
    const stage2 = searchCards(stage1, query)
    return sortCards(stage2, sortMode).slice(0, 60)
  }, [pool, picks, query, sortMode])

  function addCard(c: BinderCard) {
    if (picks.length >= TARGET_CARD_COUNT) return
    if (picks.some(p => p.card_url_slug === c.card_url_slug)) return
    if (c.current_raw > stats.remainingCents) return
    setPicks(prev => [...prev, c])
    setFinalisedScore(null)
  }
  function removeCard(slug: string | null) {
    if (!slug) return
    setPicks(prev => prev.filter(p => p.card_url_slug !== slug))
    setFinalisedScore(null)
  }
  // FIX1 — shared "reset picks + score" so `resetGame` and
  // `changeBudget` clear the same fields the same way. `resetGame`
  // additionally clears the search query; `changeBudget` leaves
  // search / sort intact per the fix brief.
  function resetPicksAndScore() {
    setPicks([])
    setFinalisedScore(null)
  }
  function resetGame() {
    resetPicksAndScore()
    setQuery('')
  }
  function changeBudget(next: number) {
    if (next === budgetCents) return
    setBudgetCents(next)
    resetPicksAndScore()
  }
  function finalise() {
    if (!stats.isComplete) return
    setFinalisedScore(scoreBinder(picks, budgetCents))
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.10)', padding: '4px 12px', borderRadius: 14, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
          Anytime game
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 6px', color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Build a Binder
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0, maxWidth: 640 }}>
          Pick <strong>{TARGET_CARD_COUNT}</strong> cards without going over your budget.
          Real PokePrices market values. Spend efficiently and mix up your sets and Pokémon for bonus points.
        </p>
      </div>

      {/* Budget selector */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Budget</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {BUDGETS_CENTS.map(b => (
            <button
              key={b}
              type="button"
              onClick={() => changeBudget(b)}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: budgetCents === b ? '1px solid var(--primary)' : '1px solid var(--border)',
                background: budgetCents === b ? 'rgba(26,95,173,0.10)' : 'var(--bg-light)',
                color: budgetCents === b ? 'var(--primary)' : 'var(--text)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Figtree', sans-serif",
              }}
            >
              {fmtUsd(b)}
            </button>
          ))}
        </div>
      </div>

      {/* Your binder */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
            Your binder — {picks.length}/{TARGET_CARD_COUNT}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--text-muted)' }}>
            <span><strong style={{ color: 'var(--text)' }}>Spent</strong> {fmtUsd(stats.totalCents)}</span>
            <span><strong style={{ color: stats.isOverBudget ? '#ef4444' : 'var(--text)' }}>Remaining</strong> {fmtUsd(Math.max(0, stats.remainingCents))}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TARGET_CARD_COUNT}, minmax(0, 1fr))`, gap: 8, marginBottom: 10 }}>
          {Array.from({ length: TARGET_CARD_COUNT }).map((_, i) => {
            const pick = picks[i]
            if (pick) {
              return (
                <button
                  key={pick.card_url_slug}
                  type="button"
                  onClick={() => removeCard(pick.card_url_slug)}
                  title={`Remove ${cleanCardName(pick.card_name)}`}
                  style={{
                    border: '1px solid var(--border)', borderRadius: 10,
                    padding: '8px 6px', background: 'var(--bg-light)',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 4, position: 'relative', minWidth: 0,
                  }}
                >
                  <img
                    src={pick.image_url || ''}
                    alt={cleanCardName(pick.card_name)}
                    style={{ width: '100%', maxWidth: 80, aspectRatio: '5/7', objectFit: 'contain', borderRadius: 6, background: 'transparent' }}
                  />
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                    {cleanCardName(pick.card_name)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 800 }}>{fmtUsd(pick.current_raw)}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Tap to remove</div>
                </button>
              )
            }
            return (
              <div key={`empty-${i}`} style={{
                border: '2px dashed var(--border)', borderRadius: 10, minHeight: 130,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: 20, fontWeight: 700, background: 'var(--bg-light)',
              }}>
                +
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={resetGame}
            disabled={picks.length === 0 && !finalisedScore}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-light)',
              color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: picks.length === 0 ? 'default' : 'pointer',
              opacity: picks.length === 0 ? 0.6 : 1, fontFamily: "'Figtree', sans-serif",
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={finalise}
            disabled={!stats.isComplete || !!finalisedScore}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: stats.isComplete && !finalisedScore ? 'var(--primary)' : 'var(--border)',
              color: '#fff', fontSize: 13, fontWeight: 800, cursor: stats.isComplete && !finalisedScore ? 'pointer' : 'not-allowed',
              fontFamily: "'Figtree', sans-serif",
            }}
          >
            Finalise binder
          </button>
        </div>
      </div>

      {/* Results panel */}
      {finalisedScore && (
        <div style={{ background: 'linear-gradient(135deg, rgba(26,95,173,0.10), rgba(59,130,246,0.10))', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--primary)', marginBottom: 4 }}>
            Binder complete
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, fontFamily: "'Outfit', sans-serif", color: 'var(--text)', marginBottom: 6 }}>
            {finalisedScore.totalScore} <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)' }}>/ 120</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
            {scoreLabel(finalisedScore.totalScore)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
            <div><strong style={{ color: 'var(--text)' }}>Budget efficiency</strong>: {finalisedScore.efficiencyPoints}/100</div>
            <div><strong style={{ color: 'var(--text)' }}>Set diversity bonus</strong>: {finalisedScore.setDiversityPoints ? '+10' : '0'}</div>
            <div><strong style={{ color: 'var(--text)' }}>Pokémon diversity bonus</strong>: {finalisedScore.pokemonDiversityPoints ? '+10' : '0'}</div>
            <div><strong style={{ color: 'var(--text)' }}>Total spent</strong>: {fmtUsd(stats.totalCents)} of {fmtUsd(budgetCents)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" onClick={resetGame} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 800,
              cursor: 'pointer', fontFamily: "'Figtree', sans-serif",
            }}>
              Play again
            </button>
            <Link href="/games" style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-light)',
              color: 'var(--text)', fontSize: 13, fontWeight: 700, textDecoration: 'none',
              fontFamily: "'Figtree', sans-serif",
            }}>
              Back to games
            </Link>
          </div>
        </div>
      )}

      {/* Available cards */}
      {!finalisedScore && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by card or Pokémon name…"
              aria-label="Search cards"
              style={{
                flex: 1, minWidth: 180,
                padding: '9px 12px', fontSize: 14, borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-light)',
                color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                fontFamily: "'Figtree', sans-serif",
              }}
            />
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as SortMode)}
              aria-label="Sort cards"
              style={{
                padding: '9px 12px', fontSize: 13, borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-light)',
                color: 'var(--text)', outline: 'none', cursor: 'pointer',
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              <option value="popular">Sort: Most popular</option>
              <option value="price-asc">Sort: Lowest price</option>
              <option value="price-desc">Sort: Highest price</option>
            </select>
          </div>

          {loading && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>Loading card pool…</div>}
          {error && !loading && <div style={{ padding: 20, color: '#ef4444', textAlign: 'center' }}>{error}</div>}

          {!loading && !error && (
            <>
              {filteredPool.length === 0 ? (
                <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>
                  No cards match your search. Try a different keyword.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                  {filteredPool.map(c => {
                    // FIX1 — cards over the remaining budget stay VISIBLE
                    // but are marked non-selectable. When the binder is
                    // full, everything is non-selectable with the same
                    // treatment and a "Binder full" reason.
                    const binderFull    = picks.length >= TARGET_CARD_COUNT
                    const overBudget    = !binderFull && c.current_raw > stats.remainingCents
                    const nonSelectable = binderFull || overBudget
                    const reason =
                        binderFull ? 'Binder full'
                      : overBudget ? 'Over remaining budget'
                                   : ''
                    return (
                      <button
                        key={c.card_url_slug}
                        type="button"
                        onClick={() => addCard(c)}
                        disabled={nonSelectable}
                        aria-disabled={nonSelectable}
                        title={nonSelectable ? reason : `Add ${cleanCardName(c.card_name)}`}
                        style={{
                          border: '1px solid var(--border)', borderRadius: 10,
                          padding: '10px 8px',
                          background: 'var(--bg-light)',
                          cursor: nonSelectable ? 'not-allowed' : 'pointer',
                          opacity: nonSelectable ? 0.55 : 1,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                          minWidth: 0, textAlign: 'center',
                        }}
                      >
                        <img
                          src={c.image_url || ''}
                          alt={cleanCardName(c.card_name)}
                          style={{ width: '100%', maxWidth: 100, aspectRatio: '5/7', objectFit: 'contain', borderRadius: 6, background: 'transparent' }}
                        />
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cleanCardName(c.card_name)}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.set_name}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 800 }}>{fmtUsd(c.current_raw)}</div>
                        {reason && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 2 }}>
                            {reason}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
