'use client'
// Block 5A-W-47E-B — Guess the Card game client.
//
// The player sees an obscured card image, submits guesses, gets
// progressive clues after incorrect attempts, and can move to a
// fresh card. Card pool comes from popular_card_trends — the same
// existing table used by the other three games. Guess logic +
// reveal progression + best-streak storage are all pure helpers
// pinned by unit tests.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { cleanCardName } from '@/lib/gamesUtil'
import {
  acceptedAnswersFor,
  clueForLevel,
  firstAcceptedDisplayName,
  isCorrectGuess,
  isDuplicateGuess,
  isPlayableGuessCard,
  MAX_ATTEMPTS,
  pickNextCard,
  readBestStreak,
  REVEAL_TRANSFORMS,
  revealLevel,
  writeBestStreak,
  type GuessCard,
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

  const [card, setCard] = useState<GuessCard | null>(null)
  const [phase, setPhase] = useState<Phase>('guessing')
  const [guess, setGuess] = useState('')
  const [guesses, setGuesses] = useState<string[]>([])
  const [validationMsg, setValidationMsg] = useState<string | null>(null)

  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)

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
    setPhase('guessing')
    setGuess('')
    setGuesses([])
    setValidationMsg(null)
    // Return focus to the input so keyboard players don't have to
    // click again. Guard against unmount.
    setTimeout(() => inputRef.current?.focus(), 0)
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

  // ── Submit handler ──
  function onSubmitGuess(e: React.FormEvent) {
    e.preventDefault()
    if (phase !== 'guessing' || !card) return
    const raw = guess.trim()
    if (!raw) {
      setValidationMsg('Type a card name first.')
      return
    }
    // Duplicate guess — don't spend an attempt, just tell the user.
    if (isDuplicateGuess(raw, guesses)) {
      setValidationMsg('You already tried that guess.')
      setGuess('')
      return
    }
    setValidationMsg(null)

    if (isCorrectGuess(raw, card)) {
      setGuesses(prev => [...prev, raw])
      setPhase('won')
      bumpStreakAndPersist()
      setGuess('')
      return
    }

    // Incorrect. Record the guess and either continue or reveal.
    const nextGuesses = [...guesses, raw]
    setGuesses(nextGuesses)
    setGuess('')
    if (nextGuesses.length >= MAX_ATTEMPTS) {
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
  const misses = guesses.length - (phase === 'won' ? 1 : 0)
  const level = revealLevel(misses, phase !== 'guessing')
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
          Identify the card from the obscured artwork. Each miss makes the picture clearer
          and unlocks another clue. You have {MAX_ATTEMPTS} guesses per card.
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
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)' }}>Attempts</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}>
                {Math.min(guesses.length, MAX_ATTEMPTS)}/{MAX_ATTEMPTS}
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
                  {card.set_name} · {guesses.length} {guesses.length === 1 ? 'attempt' : 'attempts'}
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

            {/* Guess input row */}
            {phase === 'guessing' ? (
              <form onSubmit={onSubmitGuess} style={{ width: '100%', maxWidth: 360 }} aria-label="Card name guess">
                <label htmlFor="guess-input" style={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Your guess
                </label>
                <input
                  id="guess-input"
                  ref={inputRef}
                  type="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={guess}
                  onChange={e => { setGuess(e.target.value); setValidationMsg(null) }}
                  placeholder="Enter a card name…"
                  aria-invalid={!!validationMsg}
                  aria-describedby={validationMsg ? 'guess-validation' : undefined}
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 15, borderRadius: 8,
                    border: `1px solid ${validationMsg ? '#ef4444' : 'var(--border)'}`,
                    background: 'var(--bg-light)', color: 'var(--text)',
                    outline: 'none', boxSizing: 'border-box',
                    fontFamily: "'Figtree', sans-serif",
                  }}
                />
                {validationMsg && (
                  <div id="guess-validation" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    {validationMsg}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="submit" style={primaryBtn}>Submit guess</button>
                  <button type="button" onClick={revealAnswer} style={secondaryBtn}>Reveal answer</button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" onClick={nextCard} style={primaryBtn}>Next card</button>
                {cardLink && (
                  <Link href={cardLink} style={secondaryBtn as any}>View card</Link>
                )}
              </div>
            )}

            {/* Past guesses (during the round) */}
            {phase === 'guessing' && guesses.length > 0 && (
              <div style={{ width: '100%', maxWidth: 360, marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Previous guesses
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {guesses.map((g, i) => (
                    <li key={i} style={{ fontSize: 12, padding: '3px 10px', border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text-muted)', borderRadius: 20, textDecoration: 'line-through' }}>
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Reduced-motion respect */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media (prefers-reduced-motion: reduce) {
              [data-guess-card-image] { transition: none !important; }
            }
          ` }} />
        </>
      )}

      {/* Accepted-answer accessibility hint — only after reveal so we
          don't spoil the guess. */}
      {phase !== 'guessing' && card && (
        <div aria-hidden="true" style={{ display: 'none' }}>{acceptedAnswersFor(card).join(', ')}</div>
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
