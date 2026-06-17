// src/emails/components/InfoBox.tsx
// Block 3C — soft brand-tinted box. Used by the discovery email's
// feedback prompt and by activation variant D's "next layer" tip.

import { Section, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { COLORS, FONT_STACK, RADIUS, SPACING } from '../designTokens'

type Props = {
  children: ReactNode
  tone?: 'primary' | 'accent'
}

export default function InfoBox({ children, tone = 'primary' }: Props) {
  const palette = tone === 'accent'
    ? { bg: COLORS.accentSoft, border: COLORS.accent }
    : { bg: COLORS.pageBg,     border: COLORS.cardBorder }
  return (
    <Section style={{
      backgroundColor: palette.bg,
      border:          `1px solid ${palette.border}`,
      borderRadius:    RADIUS.md,
      padding:         `${SPACING.md}px ${SPACING.lg}px`,
      marginTop:       SPACING.lg,
      marginBottom:    SPACING.lg,
    }}>
      <Text style={{
        margin:      0,
        fontFamily:  FONT_STACK,
        fontSize:    13.5,
        color:       COLORS.text,
        lineHeight:  1.6,
      }}>
        {children}
      </Text>
    </Section>
  )
}
