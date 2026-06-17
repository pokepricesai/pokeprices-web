// src/emails/components/SecondaryButton.tsx
// Block 3C — gold/accent secondary CTA, used to subordinate a second
// action without losing brand recognition. Dark text on gold for
// strong contrast.

import { Button } from '@react-email/components'
import type { ReactNode } from 'react'
import { BUTTON, COLORS, FONT_STACK } from '../designTokens'

const style: React.CSSProperties = {
  display:         'inline-block',
  backgroundColor: COLORS.accent,
  color:           COLORS.textOnAccent,
  paddingTop:      BUTTON.secondary.paddingY,
  paddingBottom:   BUTTON.secondary.paddingY,
  paddingLeft:     BUTTON.secondary.paddingX,
  paddingRight:    BUTTON.secondary.paddingX,
  borderRadius:    BUTTON.secondary.radius,
  fontFamily:      FONT_STACK,
  fontSize:        BUTTON.secondary.fontSize,
  fontWeight:      BUTTON.secondary.fontWeight,
  textDecoration:  'none',
  letterSpacing:   0.2,
  minHeight:       BUTTON.secondary.minHeight,
  lineHeight:      `${BUTTON.secondary.minHeight - 2 * BUTTON.secondary.paddingY}px`,
}

export default function SecondaryButton({ href, children }: { href: string; children: ReactNode }) {
  return <Button href={href} style={style}>{children}</Button>
}
