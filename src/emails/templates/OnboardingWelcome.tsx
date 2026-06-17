// src/emails/templates/OnboardingWelcome.tsx
// Block 3C — branded welcome email.
//
// Tone: collector talking to collectors. No urgency, no investor
// language, no paid-plan pitch, no eBay links.

import { Text, Section } from '@react-email/components'
import BaseLayout from '../layouts/BaseLayout'
import PrimaryButton from '../components/PrimaryButton'
import SecondaryButton from '../components/SecondaryButton'
import FeatureList, { type FeatureListItem } from '../components/FeatureList'
import { COLORS, FONT_STACK, SPACING } from '../designTokens'
import { emailLink, unsubscribePreferencesLink } from '@/lib/email/onboardingLinks'

export const ONBOARDING_WELCOME_KEY       = 'onboarding_welcome'
export const ONBOARDING_WELCOME_SUBJECT   = 'Welcome to PokePrices'
export const ONBOARDING_WELCOME_PREHEADER =
  'Your dashboard is ready — track prices, build a portfolio, ask the AI.'

export type OnboardingWelcomeProps = {
  replyTo?: string | null
}

const features: ReadonlyArray<FeatureListItem> = [
  { glyph: '📈', text: 'Track card prices across raw, PSA 9 and PSA 10', href: emailLink('browse') },
  { glyph: '🗂️', text: 'Build a portfolio with real landed cost',         href: emailLink('portfolio') },
  { glyph: '⭐', text: 'Save cards to a watchlist for what you are eyeing', href: emailLink('watchlist') },
  { glyph: '💬', text: 'Ask the AI assistant a collector question',        href: emailLink('ai_assistant') },
  { glyph: '📅', text: 'Find UK + US card shows and the sets they bring',  href: emailLink('card_shows') },
]

export default function OnboardingWelcome(props: OnboardingWelcomeProps) {
  return (
    <BaseLayout
      preview={ONBOARDING_WELCOME_PREHEADER}
      eyebrow="Onboarding · 1 of 3"
      headline="Welcome to PokePrices"
      preferencesUrl={unsubscribePreferencesLink()}
      replyTo={props.replyTo ?? null}
    >
      <Text style={lead}>
        Thanks for signing up. PokePrices is a free price-intelligence
        tool for Pokémon TCG collectors — no paid plans, no email-capture
        wall, just data and tools you can use straight away.
      </Text>

      <Text style={subhead}>Here is what is waiting for you:</Text>
      <FeatureList items={features} />

      <Section style={{ marginTop: SPACING.lg }}>
        <PrimaryButton href={emailLink('dashboard')}>Explore your dashboard</PrimaryButton>
      </Section>
      <Section style={{ marginTop: SPACING.md }}>
        <SecondaryButton href={emailLink('browse')}>Find a card</SecondaryButton>
      </Section>

      <Text style={footnote}>
        These getting-started tips arrive over your first week and then
        stop. You can turn them off any time from your settings.
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

const subhead: React.CSSProperties = {
  margin:     `${SPACING.md}px 0 ${SPACING.xs}px`,
  fontFamily: FONT_STACK,
  fontSize:   13,
  color:      COLORS.textMuted,
  fontWeight: 700,
  lineHeight: 1.4,
}

const footnote: React.CSSProperties = {
  margin:     `${SPACING.xl}px 0 0`,
  fontFamily: FONT_STACK,
  fontSize:   12,
  color:      COLORS.textMuted,
  lineHeight: 1.6,
}

export function onboardingWelcomePlainText(_props: OnboardingWelcomeProps): string {
  return [
    'WELCOME TO POKEPRICES',
    '',
    'Thanks for signing up. PokePrices is a free price-intelligence tool',
    'for Pokémon TCG collectors. No paid plans, no email-capture wall,',
    'just data and tools you can use straight away.',
    '',
    'Here is what is waiting for you:',
    `  - Track card prices: ${emailLink('browse')}`,
    `  - Build a portfolio: ${emailLink('portfolio')}`,
    `  - Save a watchlist:  ${emailLink('watchlist')}`,
    `  - AI assistant:      ${emailLink('ai_assistant')}`,
    `  - UK + US card shows:${emailLink('card_shows')}`,
    '',
    `Explore your dashboard: ${emailLink('dashboard')}`,
    `Or jump straight to:    ${emailLink('browse')}`,
    '',
    'These getting-started tips arrive over your first week and then',
    'stop. Turn them off any time:',
    unsubscribePreferencesLink(),
  ].join('\n')
}
