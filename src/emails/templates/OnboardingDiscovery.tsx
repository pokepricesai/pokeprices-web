// src/emails/templates/OnboardingDiscovery.tsx
// Block 3C — branded discovery email (final in the onboarding
// sequence). Stacked feature cards + a feedback InfoBox using the
// configured EMAIL_REPLY_TO address.

import { Section, Text } from '@react-email/components'
import BaseLayout from '../layouts/BaseLayout'
import PrimaryButton from '../components/PrimaryButton'
import FeatureCard from '../components/FeatureCard'
import InfoBox from '../components/InfoBox'
import TextLink from '../components/TextLink'
import { COLORS, FONT_STACK, SPACING } from '../designTokens'
import { emailLink, unsubscribePreferencesLink } from '@/lib/email/onboardingLinks'

export const ONBOARDING_DISCOVERY_KEY        = 'onboarding_discovery'
export const ONBOARDING_DISCOVERY_SUBJECT    = 'A few PokePrices features you may have missed'
export const ONBOARDING_DISCOVERY_PREHEADER  =
  'AI assistant, grading comparison, market movers and card shows.'

export type OnboardingDiscoveryProps = {
  /**
   * Required for the feedback InfoBox + footer. The renderer plumbs
   * `resolveReplyTo()` into this; falls back to "hello@pokeprices.io".
   */
  replyTo?: string | null
}

const REPLY_FALLBACK = 'hello@pokeprices.io'

export default function OnboardingDiscovery({ replyTo }: OnboardingDiscoveryProps) {
  const reply = replyTo && replyTo.trim().length > 0 ? replyTo : REPLY_FALLBACK
  return (
    <BaseLayout
      preview={ONBOARDING_DISCOVERY_PREHEADER}
      eyebrow="Onboarding · 3 of 3"
      headline="Worth a look"
      preferencesUrl={unsubscribePreferencesLink()}
      replyTo={reply}
    >
      <Text style={lead}>
        You have been with PokePrices for about a week. A few corners
        of the site that early collectors tend to miss:
      </Text>

      <FeatureCard
        glyph="💬"
        title="AI assistant"
        body="Natural-language collector questions, answered with real PokePrices data behind them."
        href={emailLink('ai_assistant')}
        cta="Try it"
      />
      <FeatureCard
        glyph="🔍"
        title="Grading comparison"
        body="Raw vs PSA premium per card — useful when deciding whether grading is worth it."
        href={emailLink('browse')}
        cta="Compare grades"
      />
      <FeatureCard
        glyph="📊"
        title="Market movers"
        body="Weekly risers, fallers and steady earners across the catalogue."
        href={emailLink('browse')}
        cta="See movers"
      />
      <FeatureCard
        glyph="📅"
        title="Card show calendar"
        body="UK + US shows with the sets traders tend to bring."
        href={emailLink('card_shows')}
        cta="Open calendar"
      />
      <FeatureCard
        glyph="🗂️"
        title="Saved cards"
        body="Portfolio totals, raw vs graded splits, simple landed-cost."
        href={emailLink('portfolio')}
        cta="Open portfolio"
      />

      <Section style={{ marginTop: SPACING.lg }}>
        <PrimaryButton href={emailLink('dashboard')}>Open your dashboard</PrimaryButton>
      </Section>

      <InfoBox tone="accent">
        <strong style={{ color: COLORS.text }}>Tell us what would help.</strong>
        {' '}
        PokePrices is being built for collectors. If something is missing or
        unclear, reply to this email — you can reach the team at{' '}
        <TextLink href={`mailto:${reply}`}>{reply}</TextLink>.
        Public roadmap: <TextLink href={emailLink('roadmap')}>www.pokeprices.io/roadmap</TextLink>.
      </InfoBox>

      <Text style={footnote}>
        This is the last of the three getting-started tips. After this,
        PokePrices goes quiet unless you opt into other categories from{' '}
        <TextLink href={unsubscribePreferencesLink()}>your settings</TextLink>.
      </Text>
    </BaseLayout>
  )
}

const lead: React.CSSProperties = {
  margin:     `0 0 ${SPACING.md}px`,
  fontFamily: FONT_STACK,
  fontSize:   15,
  color:      COLORS.text,
  lineHeight: 1.6,
}
const footnote: React.CSSProperties = {
  margin:     `${SPACING.xl}px 0 0`,
  fontFamily: FONT_STACK,
  fontSize:   12,
  color:      COLORS.textMuted,
  lineHeight: 1.6,
}

export function onboardingDiscoveryPlainText({ replyTo }: OnboardingDiscoveryProps): string {
  const reply = replyTo && replyTo.trim().length > 0 ? replyTo : REPLY_FALLBACK
  return [
    'WORTH A LOOK',
    '',
    'You have been with PokePrices for about a week. A few corners of',
    'the site that early collectors tend to miss:',
    '',
    `  - AI assistant:        ${emailLink('ai_assistant')}`,
    `  - Grading comparison:  ${emailLink('browse')}`,
    `  - Market movers:       ${emailLink('browse')}`,
    `  - Card show calendar:  ${emailLink('card_shows')}`,
    `  - Saved cards:         ${emailLink('portfolio')}`,
    '',
    `Open your dashboard:   ${emailLink('dashboard')}`,
    '',
    'TELL US WHAT WOULD HELP',
    'PokePrices is being built for collectors. If something is missing',
    `or unclear, reply to this email or write to ${reply}.`,
    `Public roadmap: ${emailLink('roadmap')}`,
    '',
    'This is the last of the three getting-started tips. After this,',
    'PokePrices goes quiet unless you opt into other categories:',
    unsubscribePreferencesLink(),
  ].join('\n')
}
