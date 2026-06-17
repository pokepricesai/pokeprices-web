// src/emails/components/SmallBadge.tsx
// Tiny accent badge used for branch eyebrows ("Start your collection",
// "Build your portfolio", etc.).

import type { ReactNode } from 'react'
import { COLORS, RADIUS, SPACING } from '../designTokens'

type Props = {
  children: ReactNode
  /** Variant: 'gold' (default) | 'soft' (light blue) */
  variant?: 'gold' | 'soft'
}

export default function SmallBadge({ children, variant = 'gold' }: Props) {
  const palette = variant === 'gold'
    ? { bg: COLORS.accentSoft, fg: COLORS.warning, ring: COLORS.accent }
    : { bg: '#eaf3ff',         fg: COLORS.primary, ring: COLORS.cardBorder }
  return (
    <span style={{
      display:           'inline-block',
      backgroundColor:   palette.bg,
      color:             palette.fg,
      border:            `1px solid ${palette.ring}`,
      borderRadius:      RADIUS.pill,
      padding:           `4px ${SPACING.md}px`,
      fontSize:          11,
      fontWeight:        800,
      letterSpacing:     0.6,
      textTransform:     'uppercase',
      lineHeight:        1.2,
    }}>
      {children}
    </span>
  )
}
