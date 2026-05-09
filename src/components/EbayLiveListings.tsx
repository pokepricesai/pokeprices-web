'use client'
import { getEbayUkUrl, getEbayUsUrl } from '@/lib/ebayAffiliate'

type Size = 'sm' | 'md'

type Props = {
  searchQuery: string
  customId?: string
  /** Optional — kept for backwards compat. Ignored after the eBay-compliance update. */
  label?: string
  size?: Size
  className?: string
}

const SIZE_STYLES: Record<Size, { padding: string; fontSize: number; flagSize: number; gap: number }> = {
  sm: { padding: '6px 12px', fontSize: 11, flagSize: 13, gap: 6 },
  md: { padding: '9px 16px', fontSize: 13, flagSize: 15, gap: 7 },
}

export default function EbayLiveListings({
  searchQuery,
  customId,
  size = 'md',
  className,
}: Props) {
  const ukUrl = getEbayUkUrl(searchQuery, customId)
  const usUrl = getEbayUsUrl(searchQuery, customId)
  const s = SIZE_STYLES[size]

  return (
    <div className={className} style={{ fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <RegionButton href={ukUrl} flag="🇬🇧" sizeStyles={s} primary />
        <RegionButton href={usUrl} flag="🇺🇸" sizeStyles={s} />
      </div>
      <p
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          margin: '8px 0 0',
          opacity: 0.75,
        }}
      >
        Affiliate link · we may earn commission
      </p>
    </div>
  )
}

// Compact, single-link variant for inline use inside dense rows (top movers,
// risers, fallers). Defaults to UK since the site is UK-focused.
export function EbayInlineLink({
  searchQuery,
  customId,
  label = 'See listings →',
}: {
  searchQuery: string
  customId: string
  label?: string
}) {
  const url = getEbayUkUrl(searchQuery, customId)
  return (
    <a
      href={url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        textDecoration: 'none',
        fontFamily: "'Figtree', sans-serif",
        whiteSpace: 'nowrap',
        flexShrink: 0,
        padding: '2px 4px',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline'
        ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none'
        ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'
      }}
    >
      {label}
    </a>
  )
}

function RegionButton({
  href,
  flag,
  sizeStyles,
  primary = false,
}: {
  href: string
  flag: string
  sizeStyles: { padding: string; fontSize: number; flagSize: number; gap: number }
  primary?: boolean
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: sizeStyles.gap,
        padding: sizeStyles.padding,
        borderRadius: 10,
        textDecoration: 'none',
        fontSize: sizeStyles.fontSize,
        fontWeight: 700,
        fontFamily: "'Figtree', sans-serif",
        border: '1px solid var(--border)',
        background: primary ? 'var(--primary)' : 'var(--bg-light)',
        color: primary ? '#fff' : 'var(--text)',
        whiteSpace: 'nowrap',
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.opacity = '0.85'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.opacity = '1'
      }}
    >
      <span style={{ fontSize: sizeStyles.flagSize }}>{flag}</span>
      Click here for eBay listings
    </a>
  )
}
