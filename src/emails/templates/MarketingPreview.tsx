// src/emails/templates/MarketingPreview.tsx
//
// Generic marketing/newsletter preview template. Carries the
// preferences/unsubscribe link in the footer (BaseLayout footer slot).
// Used by the admin preview route to QA marketing copy before any
// actual newsletter is wired in.

import BaseLayout from '../layouts/BaseLayout'
import { Text } from '@react-email/components'
import PrimaryButton from '../components/PrimaryButton'

export type MarketingPreviewProps = {
  preferencesUrl: string | null
}

export const MARKETING_PREVIEW_KEY     = 'marketing_preview'
export const MARKETING_PREVIEW_SUBJECT = 'A peek at what is coming to PokePrices'

export default function MarketingPreview(props: MarketingPreviewProps) {
  return (
    <BaseLayout
      preview="A peek at what is coming to PokePrices."
      headline="A peek at what is coming to PokePrices"
      preferencesUrl={props.preferencesUrl}
    >
      <Text>
        Hello collector,
      </Text>
      <Text>
        This is a preview of the kind of message we might send when
        there is something genuinely worth opening — a new tool, a
        useful data report, or a price intelligence story we think you
        will enjoy.
      </Text>
      <Text>
        We only send marketing messages to collectors who have opted in.
        You can change your preferences at any time using the link in
        the footer of this email.
      </Text>
      <Text>
        <PrimaryButton href="https://www.pokeprices.io/tools">
          See what we are working on
        </PrimaryButton>
      </Text>
    </BaseLayout>
  )
}

export function marketingPreviewPlainText(_props: MarketingPreviewProps): string {
  return [
    'Hello collector,',
    '',
    'This is a preview of the kind of message we might send when there',
    'is something genuinely worth opening — a new tool, a useful data',
    'report, or a price intelligence story we think you will enjoy.',
    '',
    'We only send marketing messages to collectors who have opted in.',
    'You can change your preferences at any time using the link in the',
    'footer of this email.',
    '',
    'See what we are working on:',
    'https://www.pokeprices.io/tools',
  ].join('\n')
}
