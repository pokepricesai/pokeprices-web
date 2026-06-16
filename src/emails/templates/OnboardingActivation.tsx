// src/emails/templates/OnboardingActivation.tsx
// Block 3B Email 2 — Activation. Sent ~2 days after enrolment.
//
// Branches on the user's aggregate state. We never render card names,
// purchase prices or notes — only aggregate-count-driven copy.

import BaseLayout from '../layouts/BaseLayout'
import PrimaryButton from '../components/PrimaryButton'
import { Text, Link, Hr } from '@react-email/components'
import { emailLink, unsubscribePreferencesLink } from '@/lib/email/onboardingLinks'
import type { ActivationBranch } from '@/lib/email/onboardingActivation'

export const ONBOARDING_ACTIVATION_KEY = 'onboarding_activation'

type Copy = { subject: string; headline: string; body: string[]; ctaLabel: string; ctaUrl: string }

const COPY: Record<ActivationBranch, Copy> = {
  // No portfolio, no watchlist — basic setup prompt.
  A: {
    subject:  'Save your first card on PokePrices',
    headline: 'Start with one card',
    body: [
      'You signed up a couple of days ago — welcome back. The fastest way to make PokePrices useful is to add a single card. Either drop a card you own into your portfolio, or watchlist a card you are thinking about.',
      'You will then see weekly price moves, grading premium and (if it is a chase card) where it sits against your target.',
    ],
    ctaLabel: 'Find a card',
    ctaUrl:   emailLink('browse'),
  },
  // Watchlist exists, portfolio empty — push to owned-cards.
  B: {
    subject:  'Turn your watchlist into a portfolio',
    headline: 'You have a watchlist — add the ones you own',
    body: [
      'Your watchlist is a great signal of what you care about. Adding the cards you actually own gives you a real landed-cost view alongside live market price.',
      'You can keep raw, PSA 9 and PSA 10 holdings separate. Grade premium gets calculated automatically.',
    ],
    ctaLabel: 'Add owned cards',
    ctaUrl:   emailLink('portfolio'),
  },
  // Portfolio exists, watchlist empty — push to watchlist.
  C: {
    subject:  'Track the cards you are considering',
    headline: 'Add the cards you are eyeing',
    body: [
      'Your portfolio is set up — nice work. A watchlist is the other half of the picture. Drop in the cards you are weighing up and PokePrices tracks the move so you can time the buy.',
      'Watchlist cards do not affect your portfolio totals; they just keep you on top of prices you care about.',
    ],
    ctaLabel: 'Build your watchlist',
    ctaUrl:   emailLink('watchlist'),
  },
  // Both exist — discover deeper features.
  D: {
    subject:  'You are set up — try the deeper tools',
    headline: 'You are set up. Try the next layer.',
    body: [
      'Portfolio and watchlist both look healthy. Worth a look:',
      '  • Ask the AI assistant a collector question in plain English.\n  • Run a grading-cost comparison before you send a card in.\n  • Check the card-show calendar for the next event near you.',
    ],
    ctaLabel: 'Open the AI assistant',
    ctaUrl:   emailLink('ai_assistant'),
  },
}

export function subjectFor(branch: ActivationBranch): string {
  return COPY[branch].subject
}

export type OnboardingActivationProps = {
  branch: ActivationBranch
}

export default function OnboardingActivation({ branch }: OnboardingActivationProps) {
  const c = COPY[branch]
  return (
    <BaseLayout
      preview={c.subject}
      headline={c.headline}
      preferencesUrl={unsubscribePreferencesLink()}
    >
      {c.body.map((p, i) => (
        <Text key={i} style={p.indexOf('\n') >= 0 ? { whiteSpace: 'pre-line' } : undefined}>
          {p}
        </Text>
      ))}
      <Text style={{ marginTop: 18 }}>
        <PrimaryButton href={c.ctaUrl}>{c.ctaLabel}</PrimaryButton>
      </Text>
      <Hr style={{ margin: '20px 0 12px', borderColor: '#e6e8ef' }} />
      <Text style={{ fontSize: 12, color: '#475569', margin: 0 }}>
        We send three getting-started tips, then stop.{' '}
        <Link href={unsubscribePreferencesLink()} style={{ color: '#1a5fad', textDecoration: 'underline' }}>
          Turn these off
        </Link>{' '}any time.
      </Text>
    </BaseLayout>
  )
}

export function onboardingActivationPlainText({ branch }: OnboardingActivationProps): string {
  const c = COPY[branch]
  return [
    c.headline,
    '',
    ...c.body,
    '',
    `${c.ctaLabel}: ${c.ctaUrl}`,
    '',
    'We send three getting-started tips, then stop. Turn these off:',
    unsubscribePreferencesLink(),
  ].join('\n')
}
