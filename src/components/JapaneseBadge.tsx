// src/components/JapaneseBadge.tsx
// Block 5A-W-48B — small language pill used across the card page,
// set page kicker, and search results. Renders NOTHING unless
// `language === 'jp'`, so callers can pass it unconditionally and
// let English rows silently skip.
//
// Deliberately minimal: no icon, no emoji, no i18n. Just a chip that
// says "Japanese" so a scanning collector cannot mistake a Japanese
// printing for an English one.

export type JapaneseBadgeProps = {
  language?: string | null
  /** Visual size variant. 'sm' is used inside dense listings (search,
   *  set-grid tiles); 'md' is used near a page H1. */
  size?: 'sm' | 'md'
  /** Optional style override — merged on top of the base. */
  style?: React.CSSProperties
}

export default function JapaneseBadge({ language, size = 'md', style }: JapaneseBadgeProps) {
  if (language !== 'jp') return null

  const isSmall = size === 'sm'
  const base: React.CSSProperties = {
    display:        'inline-flex',
    alignItems:     'center',
    padding:        isSmall ? '2px 6px' : '4px 10px',
    fontSize:       isSmall ? 9 : 10,
    fontWeight:     800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color:          'var(--primary)',
    background:     'rgba(26,95,173,0.10)',
    border:         '1px solid var(--primary)',
    borderRadius:   isSmall ? 10 : 14,
    fontFamily:     "'Figtree', sans-serif",
    whiteSpace:     'nowrap',
  }

  return (
    <span
      aria-label="Japanese-language printing"
      style={{ ...base, ...(style ?? {}) }}
    >
      Japanese
    </span>
  )
}
