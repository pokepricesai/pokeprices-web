'use client'
// Block 5A-W-50C — shared progress-bar component for both the
// set-browse tile and the individual set-page header.
//
// Two variants:
//   * 'compact' — used inside browse tiles; single line under the
//     existing set info. Percentage + owned/total in a tiny row plus
//     a slim 4px bar.
//   * 'full'    — used in the set-page header; a slightly larger bar
//     with a two-line summary. Same colour treatment, same numbers.
//
// Accessibility:
//   * role="progressbar" with aria-valuenow / min / max wraps the
//     bar so assistive tech announces the completion state.
//   * The wrapper carries an aria-label naming the set (when given)
//     so a screen reader gets "Base Set — 32% complete, 41 of 128
//     cards" instead of a bare number.
//
// The component intentionally renders nothing when totalEligible is
// unavailable or ownedDistinct is zero — matches the block brief's
// "no placeholder for untouched sets" rule.

import { computePercentage } from '@/lib/setCompletion'

export type SetCompletionProgressProps = {
  ownedDistinct: number
  totalEligible: number
  variant?:      'compact' | 'full'
  /** Optional set name for accessible labelling only. Does not affect
   *  the visible copy. */
  setName?:      string
}

export default function SetCompletionProgress({
  ownedDistinct,
  totalEligible,
  variant = 'compact',
  setName,
}: SetCompletionProgressProps) {
  // Guard against unusable inputs — brief: "no placeholder for
  // untouched sets" and "do not show 0% for untouched sets".
  if (!Number.isFinite(ownedDistinct) || !Number.isFinite(totalEligible)) return null
  if (ownedDistinct <= 0)  return null
  if (totalEligible <= 0)  return null

  const percentage = computePercentage(ownedDistinct, totalEligible)
  const isFull   = variant === 'full'
  const isDone   = percentage >= 100

  // Two design tiers. Both use the site's green + neutral track. No
  // gradients, no emoji. 100% adds a subtle "Complete" chip so
  // finished sets are recognisable without shouting.
  const barHeight   = isFull ? 6 : 4
  const summaryFont = isFull ? 12.5 : 10.5
  const gap         = isFull ? 4 : 2
  const marginTop   = isFull ? 8 : 6

  const label = setName
    ? `${setName} — ${percentage}% complete, ${ownedDistinct} of ${totalEligible} cards`
    : `${percentage}% complete, ${ownedDistinct} of ${totalEligible} cards`

  return (
    <div
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-completion-variant={variant}
      data-completion-complete={isDone ? 'true' : 'false'}
      style={{
        marginTop,
        display: 'flex',
        flexDirection: 'column',
        gap,
        fontFamily: "'Figtree', sans-serif",
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        fontSize: summaryFont, color: 'var(--text-muted)',
        lineHeight: 1.2,
      }}>
        <span style={{
          fontWeight: 700,
          color: isDone ? '#16a34a' : 'var(--text)',
        }}>
          {percentage}% complete
        </span>
        <span>·</span>
        <span>
          {ownedDistinct} of {totalEligible} cards
        </span>
        {isDone && (
          <span
            aria-hidden="true"
            style={{
              marginLeft: 'auto',
              fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8,
              textTransform: 'uppercase',
              color: '#16a34a',
              background: 'rgba(34,197,94,0.10)',
              border: '1px solid rgba(34,197,94,0.35)',
              borderRadius: 4, padding: '0 5px',
              lineHeight: 1.6,
            }}
          >
            Complete
          </span>
        )}
      </div>
      <div
        aria-hidden="true"
        style={{
          height: barHeight,
          borderRadius: barHeight / 2,
          background: 'var(--bg-light)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width:  `${percentage}%`,
            height: '100%',
            background: '#16a34a',
            borderRadius: barHeight / 2,
            transition: 'width 0.25s ease-out',
          }}
        />
      </div>
    </div>
  )
}
