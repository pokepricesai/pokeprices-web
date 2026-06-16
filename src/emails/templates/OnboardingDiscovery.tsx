// src/emails/templates/OnboardingDiscovery.tsx
// Block 3B Email 3 — Discovery. Sent ~7 days after enrolment. Final
// email of the sequence — after this we go quiet unless the user
// opts in to other categories.

import BaseLayout from '../layouts/BaseLayout'
import { Text, Link, Hr } from '@react-email/components'
import PrimaryButton from '../components/PrimaryButton'
import { emailLink, unsubscribePreferencesLink } from '@/lib/email/onboardingLinks'

export const ONBOARDING_DISCOVERY_KEY     = 'onboarding_discovery'
export const ONBOARDING_DISCOVERY_SUBJECT = 'A few PokePrices features you may have missed'

const REPLY_TO_NOTE = 'Reply to this email — Luke (sole developer) reads every message.'

export type OnboardingDiscoveryProps = {
  testPrefix?: boolean
}

export default function OnboardingDiscovery(_props: OnboardingDiscoveryProps) {
  return (
    <BaseLayout
      preview="A few PokePrices features you may have missed."
      headline="Worth a look"
      preferencesUrl={unsubscribePreferencesLink()}
    >
      <Text>
        You have been with PokePrices for a week. A few corners of the
        site that early collectors tend to miss:
      </Text>
      <Text style={{ margin: '12px 0' }}>
        • <Link href={emailLink('ai_assistant')} style={inline}>AI assistant</Link> — natural-language collector questions, with real PokePrices data behind the answers.<br/>
        • <Link href={emailLink('browse')}       style={inline}>Grading comparison</Link> — raw vs PSA premium per card so you can decide when grading is worth it.<br/>
        • <Link href={emailLink('browse')}       style={inline}>Market movers</Link> — weekly risers, fallers and steady earners across the catalogue.<br/>
        • <Link href={emailLink('card_shows')}   style={inline}>Card show calendar</Link> — UK + US shows with the sets traders tend to bring.<br/>
        • <Link href={emailLink('portfolio')}    style={inline}>Saved cards</Link> — portfolio totals, raw vs graded splits, simple landed-cost.
      </Text>
      <Text style={{ marginTop: 18 }}>
        <PrimaryButton href={emailLink('dashboard')}>Open your dashboard</PrimaryButton>
      </Text>
      <Hr style={{ margin: '20px 0 14px', borderColor: '#e6e8ef' }} />
      <Text>
        PokePrices is actively being built. The{' '}
        <Link href={emailLink('roadmap')} style={inline}>roadmap</Link>{' '}
        is public.
      </Text>
      <Text>
        {REPLY_TO_NOTE}
      </Text>
      <Text style={{ fontSize: 12, color: '#475569', marginTop: 14 }}>
        This is the last of the three getting-started tips. After this,
        we go quiet unless you opt in to other categories from{' '}
        <Link href={unsubscribePreferencesLink()} style={inline}>your settings</Link>.
      </Text>
    </BaseLayout>
  )
}

const inline: React.CSSProperties = { color: '#1a5fad', textDecoration: 'underline' }

export function onboardingDiscoveryPlainText(_props: OnboardingDiscoveryProps): string {
  return [
    'Worth a look',
    '',
    'You have been with PokePrices for a week. A few corners of the site',
    'that early collectors tend to miss:',
    `  • AI assistant:        ${emailLink('ai_assistant')}`,
    `  • Grading comparison:  ${emailLink('browse')}`,
    `  • Market movers:       ${emailLink('browse')}`,
    `  • Card show calendar:  ${emailLink('card_shows')}`,
    `  • Saved cards:         ${emailLink('portfolio')}`,
    '',
    `Open your dashboard: ${emailLink('dashboard')}`,
    '',
    `PokePrices is actively being built. Roadmap: ${emailLink('roadmap')}`,
    REPLY_TO_NOTE,
    '',
    'This is the last of the three getting-started tips. After this we',
    'go quiet unless you opt in to other categories:',
    unsubscribePreferencesLink(),
  ].join('\n')
}
