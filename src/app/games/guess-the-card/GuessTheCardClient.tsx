'use client'
// Block 5A-W-47E-B (with FIX1) — Guess the Card game client.
//
// FIX1 changes:
//   * blur is lighter — reads from the pure REVEAL_TRANSFORMS table
//     which was retuned in the same fix. No client-side hard-coding.
//   * text input is gone. The player now picks from 3 buttons
//     (1 correct + 2 distractors from the pool). Wrong picks grey
//     out with a strikethrough. After MAX_WRONG_PICKS misses (= 2
//     with 3 options), the answer auto-reveals and the streak
//     resets.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  clueForLevel,
  firstAcceptedDisplayName,
  generateOptions,
  isPlayableGuessCard,
  MAX_WRONG_PICKS,
  pickNextCard,
  readBestStreak,
  REVEAL_TRANSFORMS,
  revealLevel,
  writeBestStreak,
  type GuessCard,
  type GuessOption,
} from '@/lib/games/guessTheCard'

// ── Data loader ────────────────────────────────────

async function loadPool(): Promise<GuessCard[]> {
  const { data, error } = await supabase.from('popular_card_trends')
    .select('card_name, set_name, image_url, card_url_slug, card_number, card_number_display, set_printed_total, is_sealed, sales_30d')
    .not('image_url', 'is', null)
    .not('card_url_slug', 'is', null)
    .order('sales_30d', { ascending: false })
    .limit(400)
  if (error || !data) return []
  return (data as GuessCard[]).filter(isPlayableGuessCard)
}

// ── URL helper ────────────────────────────────────

function cardHref(card: GuessCard | null): string | null {
  if (!card || !card.set_name || !card.card_url_slug) return null
  return `/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}`
}

// ── Component ─────────────────────────────────────

type Phase = 'guessing' | 'won' | 'lost'

/** Max consecutive image-load failures we tolerate before showing a
 *  useful reload message. Prevents an infinite skip loop. */
const MAX_IMAGE_FAILURES = 5

export default function GuessTheCardClient() {
  const [pool, setPool] = useState<GuessCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const seenSlugsRef = useRef<Set<string>>(new Set())
  const failuresRef  = useRef(0)
  const firstOptionRef = useRef<HTMLButtonElement | null>(null)

  const [card, setCard] = useState<GuessCard | null>(null)
  const [options, setOptions] = useState<GuessOption[]>([])
  const [phase, setPhase] = useState<Phase>('guessing')
  const [wrongPicks, setWrongPicks] = useState<string[]>([])

  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)

  // ── Boot: load pool, mount first card, read best streak ──
  useEffect(() => {
    (async () => {
      const list = await loadPool()
      if (list.length === 0) {
        setError('No cards available right now. Try again in a few minutes.')
      } else {
        setPool(list)
        const first = pickNextCard(list, new Set())
        setCard(first)
        setOptions(first ? generateOptions(first, list) : [])
        if (first?.card_url_slug) seenSlugsRef.current.add(first.card_url_slug)
      }
      setBestStreak(readBestStreak())
      setLoading(false)
    })()
  }, [])

  // ── Move to a fresh card (used by Next and by image-error skip) ──
  const nextCard = useCallback(() => {
    if (pool.length === 0) return
    const next = pickNextCard(pool, seenSlugsRef.current)
    if (!next) return
    // If seen set covers the whole pool, reset it so future rounds
    // draw fresh cards again. pickNextCard already handles the
    // "everything seen" case by picking randomly from the full pool.
    if (seenSlugsRef.current.size >= pool.length) {
      seenSlugsRef.current = new Set()
    }
    if (next.card_url_slug) seenSlugsRef.current.add(next.card_url_slug)
    setCard(next)
    setOptions(generateOptions(next, pool))
    setPhase('guessing')
    setWrongPicks([])
    // Return focus to the first option so keyboard players don't
    // have to click. Guard against unmount.
    setTimeout(() => firstOptionRef.current?.focus(), 0)
  }, [pool])

  function bumpStreakAndPersist() {
    setStreak(prev => {
      const nextStreak = prev + 1
      if (nextStreak > bestStreak) {
        setBestStreak(nextStreak)
        writeBestStreak(nextStreak)
      }
      return nextStreak
    })
  }
  function resetStreak() {
    setStreak(0)
  }

  // ── Pick handler ──
  function onPickOption(opt: GuessOption) {
    if (phase !== 'guessing' || !card) return
    if (wrongPicks.includes(opt.key)) return   // already eliminated
    if (opt.isCorrect) {
      setPhase('won')
      bumpStreakAndPersist()
      return
    }
    const nextWrong = [...wrongPicks, opt.key]
    setWrongPicks(nextWrong)
    if (nextWrong.length >= MAX_WRONG_PICKS) {
      setPhase('lost')
      resetStreak()
    }
  }

  // ── Reveal / skip ──
  function revealAnswer() {
    if (phase !== 'guessing') return
    setPhase('lost')
    resetStreak()
  }

  // ── Image error handling — skip to next card, bounded ──
  function onImageError() {
    failuresRef.current += 1
    if (failuresRef.current >= MAX_IMAGE_FAILURES) {
      setError('The card pool is currently returning broken images. Please reload the page.')
      return
    }
    // Silently pull a different card and keep the round going.
    nextCard()
  }

  // ── Reveal state + clue ──
  const level = revealLevel(wrongPicks.length, phase !== 'guessing')
  const transform = REVEAL_TRANSFORMS[level]
  const clue = clueForLevel(level, card)

  const cardDisplayName = card ? firstAcceptedDisplayName(card) : ''
  const cardLink = cardHref(card)

  // Neutral alt text before reveal; real card name after reveal.
  const imgAlt = phase === 'guessing'
    ? 'Obscured Pokémon card'
    : `${cardDisplayName || 'Pokémon card'} — ${card?.set_name || ''}`.trim()

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px 60px', fontFamily: "'Figtree', sans-serif" }}>

      {/* Back-bar */}
      <div style={{ marginBottom: 14 }}>
        <Link href="/games" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Back to games
        </Link>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)', marginBottom: 6 }}>
          Guessing game · play anytime
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Guess the Card
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Identify the card from the obscured artwork. Pick from three options —
          each miss makes the picture clearer and unlocks another clue.
        </p>
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading a card…</div>}
      {error && !loading && (
        <div role="status" style={{ padding: 20, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {!loading && !error && card && (
        <>
          {/* Streak row */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', flex: 1, minWidth: 110, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)' }}>Current streak</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}>{streak}</div>
            </div>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', flex: 1, minWidth: 110, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)' }}>Best streak</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}>{bestStreak}</div>
            </div>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', flex: 1, minWidth: 110, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)' }}>Wrong</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}>
                {Math.min(wrongPicks.length, MAX_WRONG_PICKS)}/{MAX_WRONG_PICKS}
              </div>
            </div>
          </div>

          {/* Card image — obscured while guessing */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 240,
                aspectRatio: '5 / 7',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'var(--bg-light)',
                boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
                position: 'relative',
              }}
              data-guess-card-image
            >
              <img
                key={card.card_url_slug || 'x'}
                src={card.image_url || ''}
                alt={imgAlt}
                onError={onImageError}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                  transform: `scale(${transform.scale})`,
                  filter: `blur(${transform.blurPx}px)`,
                  // Honour the OS reduced-motion pref — otherwise we
                  // do a small easing on the CSS filter for a nicer
                  // reveal on repeated interactions.
                  transition: 'filter 250ms ease, transform 250ms ease',
                }}
              />
            </div>

            {/* Clue */}
            {clue && phase === 'guessing' && (
              <div style={{ fontSize: 13, color: 'var(--text)', textAlign: 'center', fontWeight: 600 }}>
                {clue.text}
              </div>
            )}

            {/* Result panel */}
            {phase === 'won' && (
              <div style={{ textAlign: 'center' }} role="status">
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#22c55e' }}>Correct</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)', marginTop: 2 }}>
                  {cardDisplayName}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  {card.set_name}{wrongPicks.length > 0 ? ` · after ${wrongPicks.length} wrong` : ''}
                </div>
              </div>
            )}
            {phase === 'lost' && (
              <div style={{ textAlign: 'center' }} role="status">
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Answer</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)', marginTop: 2 }}>
                  {cardDisplayName}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  {card.set_name}
                </div>
              </div>
            )}

            {/* Options row (during guessing) or Next / View card (after) */}
            {phase === 'guessing' ? (
              <div
                role="group"
                aria-label="Card guess options"
                style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                {options.map((opt, i) => {
                  const eliminated = wrongPicks.includes(opt.key)
                  return (
                    <button
                      key={opt.key || `opt-${i}`}
                      ref={i === 0 ? firstOptionRef : undefined}
                      type="button"
                      onClick={() => onPickOption(opt)}
                      disabled={eliminated}
                      aria-disabled={eliminated}
                      style={{
                        width: '100%', padding: '12px 14px',
                        borderRadius: 10,
                        border: eliminated ? '1px solid var(--border)' : '1px solid var(--primary)',
                        background: eliminated ? 'var(--bg-light)' : 'var(--card)',
                        color: eliminated ? 'var(--text-muted)' : 'var(--text)',
                        fontSize: 15, fontWeight: 700,
                        fontFamily: "'Figtree', sans-serif",
                        cursor: eliminated ? 'not-allowed' : 'pointer',
                        textDecoration: eliminated ? 'line-through' : 'none',
                        textAlign: 'left',
                        boxSizing: 'border-box',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={revealAnswer}
                  style={{
                    marginTop: 4, padding: '8px 14px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--text-muted)', fontSize: 12, fontWeight: 700,
                    fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                  }}
                >
                  Reveal answer
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" onClick={nextCard} style={primaryBtn}>Next card</button>
                {cardLink && (
                  <Link href={cardLink} style={secondaryBtn as any}>View card</Link>
                )}
              </div>
            )}
          </div>

          {/* Reduced-motion respect */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media (prefers-reduced-motion: reduce) {
              [data-guess-card-image] img { transition: none !important; }
            }
          ` }} />
        </>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────

const primaryBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 8, border: 'none',
  background: 'var(--primary)', color: '#fff',
  fontSize: 14, fontWeight: 800, cursor: 'pointer',
  fontFamily: "'Figtree', sans-serif",
  textDecoration: 'none', display: 'inline-block',
}
const secondaryBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'Figtree', sans-serif",
  textDecoration: 'none', display: 'inline-block',
}
