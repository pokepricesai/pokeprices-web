'use client'
// Block 5A-W-53A — sortable card grid + language filter (All /
// English / Japanese) + per-language completion bars for logged-in
// users. Previous history:
//   v1 — sortable "All <Name> Cards" grid, English-only.
//   v2 (53A) — Japanese cards, filter tabs, completion progress,
//              logged-out CTA, empty-state handling.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  loadPokemonCompletion,
  filterCardsByLanguage,
  countCardsByLanguage,
  type PokemonCompletion,
} from '@/lib/pokemonCompletion'

interface Card {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string
  image_url: string | null
  card_number: string | null
  card_number_display: string | null
  current_raw: number | null
  current_psa10: number | null
  raw_pct_30d: number | null
  set_release_date?: string | null
  language?: 'en' | 'jp' | null
}

type LanguageFilter = 'all' | 'en' | 'jp'

export default function SpeciesInteractiveSection({
  cards,
  displayName,
  pokemonSlug,
  enTotal,
  jpTotal,
}: {
  cards: Card[]
  displayName: string
  /**
   * Species slug used to look up the user's owned cards for this
   * Pokémon. Optional so unit tests can render the grid without
   * touching auth. When omitted, completion loading is skipped.
   */
  pokemonSlug?: string
  /** Per-language totals from the RPC. Used for the filter tab
   *  counts AND for the completion denominators. */
  enTotal?: number
  jpTotal?: number
}) {
  const [sort, setSort] = useState<'price_desc' | 'price_asc' | 'set' | 'name'>('price_desc')
  const [language, setLanguage] = useState<LanguageFilter>('all')
  const [user, setUser] = useState<{ id: string } | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [completion, setCompletion] = useState<PokemonCompletion | null>(null)
  const [completionLoading, setCompletionLoading] = useState(false)

  // Per-language card counts from the payload. These may differ
  // from enTotal/jpTotal when the RPC's all_cards LIMIT truncated
  // the list — we prefer the RPC totals for the tab labels because
  // they reflect the true catalogue coverage, not what fits in the
  // JSON payload.
  const payloadCounts = useMemo(() => countCardsByLanguage(cards), [cards])
  const totalEn = enTotal ?? payloadCounts.en
  const totalJp = jpTotal ?? payloadCounts.jp
  const totalAll = totalEn + totalJp

  const filteredCards = useMemo(
    () => filterCardsByLanguage(cards, language),
    [cards, language],
  )

  const sortedCards = useMemo(() => {
    const arr = [...filteredCards]
    if (sort === 'price_desc') arr.sort((a, b) => (b.current_raw ?? 0) - (a.current_raw ?? 0))
    if (sort === 'price_asc')  arr.sort((a, b) => (a.current_raw ?? Infinity) - (b.current_raw ?? Infinity))
    if (sort === 'name')       arr.sort((a, b) => a.card_name.localeCompare(b.card_name))
    if (sort === 'set')        arr.sort((a, b) => a.set_name.localeCompare(b.set_name))
    return arr
  }, [filteredCards, sort])

  // ── Auth + completion ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id } : null)
      setAuthChecked(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ? { id: session.user.id } : null)
      setAuthChecked(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user?.id || !pokemonSlug) {
      setCompletion(null)
      return
    }
    let live = true
    setCompletionLoading(true)
    loadPokemonCompletion(supabase, user.id, pokemonSlug, { en: totalEn, jp: totalJp })
      .then(c => { if (live) { setCompletion(c); setCompletionLoading(false) } })
      .catch(() => { if (live) setCompletionLoading(false) })
    return () => { live = false }
  }, [user?.id, pokemonSlug, totalEn, totalJp])

  const hasEn = totalEn > 0
  const hasJp = totalJp > 0
  const showCompletion = authChecked && (hasEn || hasJp)

  return (
    <section id="all-cards" style={{ marginBottom: 32, scrollMarginTop: 24 }}>
      {/* ── Completion progress OR sign-in CTA ────────────────── */}
      {showCompletion && (
        user ? (
          <div style={{
            marginBottom: 18, padding: '16px 18px',
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 12,
          }}>
            <div style={{
              fontSize: 12, fontWeight: 800, textTransform: 'uppercase',
              letterSpacing: 1.2, color: 'var(--text-muted)',
              fontFamily: "'Figtree', sans-serif", marginBottom: 12,
            }}>
              Your {displayName} collection
            </div>
            {completionLoading && !completion && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                Loading…
              </div>
            )}
            {!completionLoading && !completion && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                You don't own any {displayName} cards yet. Add cards from any card page to start tracking your collection.
              </div>
            )}
            {completion && (
              <div style={{ display: 'grid', gridTemplateColumns: hasEn && hasJp ? '1fr 1fr' : '1fr', gap: 16 }}>
                {hasEn && (
                  <CompletionBar
                    label={`English ${displayName} cards owned`}
                    owned={completion.en.ownedDistinct}
                    total={completion.en.totalEligible}
                    percentage={completion.en.percentage}
                  />
                )}
                {hasJp && (
                  <CompletionBar
                    label={`Japanese ${displayName} cards owned`}
                    owned={completion.jp.ownedDistinct}
                    total={completion.jp.totalEligible}
                    percentage={completion.jp.percentage}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{
            marginBottom: 18, padding: '14px 18px',
            background: 'var(--bg-light)', border: '1px dashed var(--border)',
            borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
              Create a free account to track your English and Japanese {displayName} collection progress.
            </div>
            <Link
              href={`/dashboard/login?returnTo=${encodeURIComponent(`/pokemon/${pokemonSlug ?? ''}`)}`}
              style={{
                padding: '8px 16px', borderRadius: 10,
                background: 'var(--primary)', color: '#fff',
                fontSize: 13, fontWeight: 800, textDecoration: 'none',
                fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap',
              }}
            >
              Sign up free
            </Link>
          </div>
        )
      )}

      {/* ── Header + filter + sort ─────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: 0, color: 'var(--text)' }}>
          All {sortedCards.length} {displayName} Cards{language !== 'all' ? ` (${language === 'en' ? 'English' : 'Japanese'})` : ''}
        </h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['price_desc', 'price_asc', 'set', 'name'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`sort-btn ${sort === s ? 'active' : ''}`}
              style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11 }}>
              {s === 'price_desc' ? 'Highest Price' : s === 'price_asc' ? 'Lowest Price' : s === 'set' ? 'By Set' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>

      {/* Language filter tabs. Only render when JP cards actually
          exist for this Pokémon — English-only species see the
          plain original grid. */}
      {hasJp && (
        <div role="tablist" aria-label="Filter cards by language" style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <LanguageTab active={language === 'all'} onClick={() => setLanguage('all')} label={`All (${totalAll})`} />
          <LanguageTab active={language === 'en'}  onClick={() => setLanguage('en')}  label={`English (${totalEn})`} disabled={!hasEn} />
          <LanguageTab active={language === 'jp'}  onClick={() => setLanguage('jp')}  label={`Japanese (${totalJp})`} />
        </div>
      )}

      {/* Empty-state for the active filter. */}
      {sortedCards.length === 0 && (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '28px 20px', textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
            {language === 'jp'
              ? `No Japanese cards are currently listed for ${displayName}.`
              : language === 'en'
              ? `No English cards are currently listed for ${displayName}.`
              : `No ${displayName} cards are currently listed.`}
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {sortedCards.map(card => (
          <Link key={card.card_slug}
            href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}`}
            style={{ textDecoration: 'none' }}>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 10px', textAlign: 'center', height: '100%', boxSizing: 'border-box', transition: 'border-color 0.15s, transform 0.15s', position: 'relative' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}>
              {card.language === 'jp' && (
                <span style={{
                  position: 'absolute', top: 6, right: 6,
                  fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                  padding: '2px 6px', borderRadius: 4,
                  background: '#e11d48', color: '#fff',
                  fontFamily: "'Figtree', sans-serif",
                }}>JP</span>
              )}
              {card.image_url
                ? <img src={card.image_url} alt={card.card_name}
                    style={{ width: 90, height: 126, objectFit: 'contain', borderRadius: 6, marginBottom: 8, display: 'block', margin: '0 auto 8px' }}
                    loading="lazy"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                : <div style={{ width: 90, height: 126, background: 'var(--bg-light)', borderRadius: 6, margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🃏</div>}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 2, lineHeight: 1.3 }}>{card.card_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
                {card.set_name}{card.card_number ? ` · #${card.card_number}` : ''}
              </div>
              {card.current_raw && card.current_raw > 0
                ? (
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
                    ${(card.current_raw / 100).toFixed(2)}
                  </div>
                )
                : <div style={{ fontSize: 11, color: 'var(--border)', fontFamily: "'Figtree', sans-serif" }}>No price</div>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function LanguageTab({ active, onClick, label, disabled }: {
  active: boolean
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 999,
        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        background: active ? 'var(--primary)' : 'var(--card)',
        color: active ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text)',
        fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  )
}

function CompletionBar({
  label, owned, total, percentage,
}: {
  label: string
  owned: number
  total: number
  percentage: number
}) {
  const zero = total <= 0
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 8,
        fontSize: 12, fontFamily: "'Figtree', sans-serif", marginBottom: 6,
      }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>
          {label}: <span style={{ fontWeight: 800 }}>{owned} / {total}</span>
        </span>
        {!zero && (
          <span style={{ fontWeight: 800, color: 'var(--primary)' }}>{percentage}% complete</span>
        )}
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-light)', overflow: 'hidden' }}>
        {!zero && (
          <div style={{
            height: '100%', width: `${Math.min(100, Math.max(0, percentage))}%`,
            background: 'var(--primary)', borderRadius: 99,
            transition: 'width 0.2s ease',
          }} />
        )}
      </div>
    </div>
  )
}
