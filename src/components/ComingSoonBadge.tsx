'use client'

type Variant = 'light' | 'dark' | 'amber' | 'planned'
type Tone = 'soon' | 'planned' | 'new'

interface ComingSoonBadgeProps {
  variant?: Variant
  tone?: Tone
  label?: string
}

const TONE_LABEL: Record<Tone, string> = {
  soon: 'Coming soon',
  planned: 'Planned',
  new: 'New',
}

const baseStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
  padding: '2px 7px',
  borderRadius: 10,
  whiteSpace: 'nowrap',
  fontFamily: "'Figtree', sans-serif",
}

export default function ComingSoonBadge({ variant = 'amber', tone = 'soon', label }: ComingSoonBadgeProps) {
  let style: React.CSSProperties = { ...baseStyle }

  if (variant === 'light') {
    // On dark / coloured backgrounds (e.g. coloured hero cards, navbar)
    style = { ...style, background: 'rgba(255,255,255,0.20)', color: '#fff' }
  } else if (variant === 'dark') {
    // Subtle inline tag for light surfaces
    style = { ...style, background: 'var(--bg-light)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
  } else if (variant === 'planned') {
    // Even more muted, for "planned (not started)" status
    style = { ...style, background: 'rgba(148,163,184,0.12)', color: '#64748b' }
  } else {
    // amber (default) — for light backgrounds, matches the original dashboard style
    style = { ...style, background: 'rgba(245,158,11,0.14)', color: '#b45309' }
  }

  if (tone === 'new') {
    style = { ...style, background: 'var(--accent)', color: '#0f172a' }
  }

  return <span style={style}>{label ?? TONE_LABEL[tone]}</span>
}
