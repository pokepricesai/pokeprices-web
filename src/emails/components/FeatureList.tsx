// src/emails/components/FeatureList.tsx
// Block 3C — simple bulleted feature list. Stacked rows; no flex/grid.
// Used by the welcome email to present the five core PokePrices
// pillars without filling the email with imagery.

import { Link, Section, Text } from '@react-email/components'
import { COLORS, FONT_STACK, SPACING } from '../designTokens'

export type FeatureListItem = {
  glyph?: string
  text:   string
  href:   string
}

export default function FeatureList({ items }: { items: ReadonlyArray<FeatureListItem> }) {
  return (
    <Section style={{ marginTop: SPACING.md, marginBottom: SPACING.md }}>
      {items.map((item, i) => (
        <Text key={i} style={{
          margin:      0,
          padding:     `${SPACING.xs}px 0`,
          fontFamily:  FONT_STACK,
          fontSize:    14,
          color:       COLORS.text,
          lineHeight:  1.55,
        }}>
          {item.glyph
            ? <span style={{ display: 'inline-block', width: 22 }} aria-hidden="true">{item.glyph}</span>
            : <span style={{ display: 'inline-block', width: 22 }} aria-hidden="true">•</span>}
          <Link
            href={item.href}
            style={{
              color:          COLORS.primary,
              textDecoration: 'underline',
              fontWeight:     600,
            }}
          >
            {item.text}
          </Link>
        </Text>
      ))}
    </Section>
  )
}
