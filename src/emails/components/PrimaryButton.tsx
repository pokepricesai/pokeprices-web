// src/emails/components/PrimaryButton.tsx
// Block 3C — branded primary CTA. Uses the React Email `Button`
// helper which emits Outlook-bulletproof markup (vml fallback on
// engagement clients that need it).

import { Button } from '@react-email/components'
import type { ReactNode } from 'react'
import { BUTTON, COLORS, FONT_STACK } from '../designTokens'

const style: React.CSSProperties = {
  display:         'inline-block',
  backgroundColor: COLORS.primary,
  color:           COLORS.textOnPrimary,
  paddingTop:      BUTTON.primary.paddingY,
  paddingBottom:   BUTTON.primary.paddingY,
  paddingLeft:     BUTTON.primary.paddingX,
  paddingRight:    BUTTON.primary.paddingX,
  borderRadius:    BUTTON.primary.radius,
  fontFamily:      FONT_STACK,
  fontSize:        BUTTON.primary.fontSize,
  fontWeight:      BUTTON.primary.fontWeight,
  textDecoration:  'none',
  letterSpacing:   0.2,
  minHeight:       BUTTON.primary.minHeight,
  lineHeight:      `${BUTTON.primary.minHeight - 2 * BUTTON.primary.paddingY}px`,
}

export default function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return <Button href={href} style={style}>{children}</Button>
}
