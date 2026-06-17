// src/emails/components/FeatureCard.tsx
// Block 3C — single feature row used by FeatureList AND as a
// stand-alone card for the discovery email.
//
// Renders a small icon glyph (text only — emoji or single character —
// never an image, so the row remains useful with images blocked),
// a heading and a body line linking to the relevant section of the
// site.

import { Link, Section, Text } from '@react-email/components'
import { COLORS, FONT_STACK, RADIUS, SPACING } from '../designTokens'

export type FeatureCardProps = {
  /** Short glyph/emoji (max ~2 chars). Used as a small visual marker. */
  glyph?:   string
  title:    string
  body:     string
  href:     string
  cta?:     string
}

export default function FeatureCard({ glyph, title, body, href, cta = 'Open' }: FeatureCardProps) {
  return (
    <Section style={{
      backgroundColor: COLORS.pageBg,
      border:          `1px solid ${COLORS.cardBorder}`,
      borderRadius:    RADIUS.md,
      padding:         `${SPACING.md}px ${SPACING.lg}px`,
      marginBottom:    SPACING.sm,
    }}>
      <Text style={{
        margin:      0,
        fontFamily:  FONT_STACK,
        fontSize:    14,
        fontWeight:  700,
        color:       COLORS.text,
        lineHeight:  1.35,
      }}>
        {glyph ? <span style={{ marginRight: 6 }} aria-hidden="true">{glyph}</span> : null}
        {title}
      </Text>
      <Text style={{
        margin:      `${SPACING.xs}px 0 ${SPACING.sm}px`,
        fontFamily:  FONT_STACK,
        fontSize:    13,
        color:       COLORS.textMuted,
        lineHeight:  1.5,
      }}>
        {body}
      </Text>
      <Link
        href={href}
        style={{
          fontFamily:     FONT_STACK,
          fontSize:       12,
          fontWeight:     700,
          color:          COLORS.primary,
          textDecoration: 'underline',
        }}
      >
        {cta} →
      </Link>
    </Section>
  )
}
