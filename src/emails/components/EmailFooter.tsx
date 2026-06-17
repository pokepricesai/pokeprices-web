// src/emails/components/EmailFooter.tsx
// Block 3C — branded email footer.
//
// Slots:
//   * tagline + canonical link
//   * preferences link (when supplied)
//   * support / reply-to address (when supplied)
//   * affiliate disclosure (when supplied)
//
// All slots are individually optional so transactional emails can skip
// the preferences + affiliate slots without rendering an empty row.

import { Section, Text } from '@react-email/components'
import FooterLink from './FooterLink'
import Divider from './Divider'
import { ASSETS, COLORS, FONT_STACK, SPACING } from '../designTokens'

type Props = {
  preferencesUrl?:      string | null
  replyTo?:             string | null
  affiliateDisclosure?: string | null
}

export default function EmailFooter({ preferencesUrl, replyTo, affiliateDisclosure }: Props) {
  return (
    <Section style={{
      marginTop: SPACING.lg,
      padding:   `${SPACING.lg}px ${SPACING.md}px ${SPACING.xxl}px`,
      textAlign: 'center',
      fontFamily: FONT_STACK,
    }}>
      <Divider margin={SPACING.sm} color={COLORS.accent} />

      <Text style={{
        margin:     `${SPACING.md}px 0 0`,
        fontSize:   12,
        fontWeight: 700,
        color:      COLORS.primary,
        lineHeight: 1.5,
      }}>
        PokePrices
      </Text>
      <Text style={{
        margin:     `${SPACING.xs}px 0 ${SPACING.sm}px`,
        fontSize:   11,
        color:      COLORS.textMuted,
        lineHeight: 1.6,
      }}>
        Free Pokémon TCG price intelligence for UK + US collectors.
      </Text>

      <Text style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.7 }}>
        <FooterLink href={ASSETS.origin}>{ASSETS.origin.replace('https://', '')}</FooterLink>
        {preferencesUrl ? (
          <>
            {' · '}
            <FooterLink href={preferencesUrl}>Email preferences</FooterLink>
          </>
        ) : null}
        {replyTo ? (
          <>
            {' · '}
            <FooterLink href={`mailto:${replyTo}`}>{replyTo}</FooterLink>
          </>
        ) : null}
      </Text>

      {affiliateDisclosure ? (
        <>
          <Divider margin={SPACING.md} />
          <Text style={{ margin: 0, fontSize: 11, color: COLORS.textMuted, lineHeight: 1.55 }}>
            {affiliateDisclosure}
          </Text>
        </>
      ) : null}
    </Section>
  )
}
