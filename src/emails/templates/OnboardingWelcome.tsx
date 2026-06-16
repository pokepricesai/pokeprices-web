// src/emails/templates/OnboardingWelcome.tsx
// Block 3B Email 1 — Welcome. Sent ~10 minutes after verified signup.
//
// Tone: collector talking to collectors. No investor hype, no eBay
// links, no paid-plan pitch, no fake urgency.

import BaseLayout from '../layouts/BaseLayout'
import PrimaryButton from '../components/PrimaryButton'
import { Text, Link, Hr } from '@react-email/components'
import { emailLink, unsubscribePreferencesLink } from '@/lib/email/onboardingLinks'

export const ONBOARDING_WELCOME_KEY     = 'onboarding_welcome'
export const ONBOARDING_WELCOME_SUBJECT = 'Welcome to PokePrices'

export type OnboardingWelcomeProps = {
  testPrefix?: boolean
}

export default function OnboardingWelcome(_props: OnboardingWelcomeProps) {
  const dashboardUrl    = emailLink('dashboard')
  const browseUrl       = emailLink('browse')
  const portfolioUrl    = emailLink('portfolio')
  const watchlistUrl    = emailLink('watchlist')
  const aiUrl           = emailLink('ai_assistant')
  const showsUrl        = emailLink('card_shows')
  return (
    <BaseLayout
      preview="Welcome to PokePrices — your dashboard is ready."
      headline="Welcome to PokePrices"
      preferencesUrl={unsubscribePreferencesLink()}
    >
      <Text>
        Thanks for signing up. PokePrices is a free price intelligence
        tool for Pokémon TCG collectors. No paid plans, no email capture
        wall — just data and tools you can use.
      </Text>
      <Text>Here is what is waiting for you:</Text>
      <Text style={{ margin: '12px 0' }}>
        • <Link href={browseUrl}    style={inline}>Card pricing</Link> — raw, PSA 9 and PSA 10 across thousands of cards.<br/>
        • <Link href={portfolioUrl} style={inline}>Portfolio</Link> — track what you own with real landed cost.<br/>
        • <Link href={watchlistUrl} style={inline}>Watchlist</Link> — follow cards you are considering.<br/>
        • <Link href={aiUrl}        style={inline}>AI assistant</Link> — ask collector questions in plain English.<br/>
        • <Link href={showsUrl}     style={inline}>Card shows</Link> — UK + US calendar with the sets people are bringing.
      </Text>
      <Text style={{ marginTop: 20 }}>
        <PrimaryButton href={dashboardUrl}>Explore your dashboard</PrimaryButton>
      </Text>
      <Text style={{ fontSize: 12, color: '#475569', marginTop: 14 }}>
        Want to dive straight in? <Link href={browseUrl} style={inline}>Find a card</Link>.
      </Text>

      <Hr style={{ margin: '20px 0 12px', borderColor: '#e6e8ef' }} />
      <Text style={{ fontSize: 12, color: '#475569', margin: 0 }}>
        These getting-started tips arrive over your first week and then
        stop. You can turn them off at any time from your settings.
      </Text>
    </BaseLayout>
  )
}

const inline: React.CSSProperties = { color: '#1a5fad', textDecoration: 'underline' }

export function onboardingWelcomePlainText(_props: OnboardingWelcomeProps): string {
  return [
    'Welcome to PokePrices',
    '',
    'Thanks for signing up. PokePrices is a free price intelligence tool',
    'for Pokémon TCG collectors. No paid plans, no email capture wall —',
    'just data and tools you can use.',
    '',
    'Here is what is waiting for you:',
    `  Card pricing:  ${emailLink('browse')}`,
    `  Portfolio:     ${emailLink('portfolio')}`,
    `  Watchlist:     ${emailLink('watchlist')}`,
    `  AI assistant:  ${emailLink('ai_assistant')}`,
    `  Card shows:    ${emailLink('card_shows')}`,
    '',
    `Explore your dashboard: ${emailLink('dashboard')}`,
    `Or jump straight to: ${emailLink('browse')}`,
    '',
    'These getting-started tips arrive over your first week and then',
    'stop. You can turn them off at any time from your settings:',
    unsubscribePreferencesLink(),
  ].join('\n')
}
