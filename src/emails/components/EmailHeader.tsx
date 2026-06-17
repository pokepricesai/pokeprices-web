// src/emails/components/EmailHeader.tsx
// Block 3C — branded email header.
//
// Layered presentation:
//   1. A thin gold gradient stripe across the very top — works even
//      when images are blocked (it is solid CSS, not an image).
//   2. The PokePrices logo, hosted at https://www.pokeprices.io/logo.png,
//      referenced as an external <img>. width + height are explicit so
//      every major client renders at the intended size.
//   3. A styled text wordmark linked to the homepage, shown beneath the
//      logo. When images are blocked the wordmark stands alone and
//      remains the brand cue.
//   4. An optional small eyebrow label slot (e.g. "Onboarding").

import { Img, Link, Section, Text } from '@react-email/components'
import { ASSETS, COLORS, FONT_STACK, SPACING } from '../designTokens'

type Props = {
  /** Optional eyebrow label (small uppercase tag above the wordmark). */
  eyebrow?: string | null
}

export default function EmailHeader({ eyebrow = null }: Props) {
  return (
    <>
      {/* Gold brand stripe — pure CSS so it renders without images. */}
      <Section style={{
        background: `linear-gradient(90deg, ${COLORS.goldStripeFrom} 0%, ${COLORS.goldStripeTo} 100%)`,
        height:     6,
        lineHeight: '6px',
        padding:    0,
        margin:     0,
      }} />

      {/* Logo + wordmark block. */}
      <Section style={{
        padding:    `${SPACING.xl}px 0 ${SPACING.md}px`,
        textAlign:  'center',
      }}>
        <Link
          href={ASSETS.origin}
          style={{
            display:        'inline-block',
            textDecoration: 'none',
            color:          COLORS.primary,
            fontFamily:     FONT_STACK,
          }}
        >
          <Img
            src={ASSETS.logoUrl}
            alt={ASSETS.logoAlt}
            width={ASSETS.logoWidth}
            height={ASSETS.logoHeight}
            style={{
              display:       'block',
              margin:        '0 auto',
              maxWidth:      ASSETS.logoWidth,
              height:        'auto',
              border:        0,
              outline:       'none',
              textDecoration:'none',
            }}
          />
          <Text style={{
            margin:        `${SPACING.sm}px 0 0`,
            fontFamily:    FONT_STACK,
            fontSize:      22,
            fontWeight:    900,
            color:         COLORS.primary,
            letterSpacing: '-0.01em',
            lineHeight:    1.1,
          }}>
            PokePrices
          </Text>
        </Link>

        <Text style={{
          margin:     `${SPACING.xs}px 0 0`,
          fontFamily: FONT_STACK,
          fontSize:   12,
          color:      COLORS.textMuted,
          lineHeight: 1.4,
        }}>
          Pokémon TCG price intelligence for collectors
        </Text>

        {eyebrow ? (
          <Text style={{
            margin:        `${SPACING.md}px 0 0`,
            fontFamily:    FONT_STACK,
            fontSize:      11,
            fontWeight:    800,
            color:         COLORS.warning,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            lineHeight:    1,
          }}>
            {eyebrow}
          </Text>
        ) : null}
      </Section>
    </>
  )
}
