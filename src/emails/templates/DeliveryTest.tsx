// src/emails/templates/DeliveryTest.tsx
//
// Replaces the bespoke HTML used by /api/admin/test-resend. Demonstrates
// the same payload (timestamp, Vercel env) inside the branded layout.

import BaseLayout from '../layouts/BaseLayout'
import { Text } from '@react-email/components'

export type DeliveryTestProps = {
  timestamp:   string
  vercelEnv:   string
}

export const DELIVERY_TEST_KEY     = 'delivery_test'
export const DELIVERY_TEST_SUBJECT = 'PokePrices Vercel email test'

export default function DeliveryTest(props: DeliveryTestProps) {
  return (
    <BaseLayout
      preview="PokePrices Vercel email test"
      headline="Resend delivery test"
    >
      <Text>
        This email was sent directly by the PokePrices Vercel application
        through the Resend API.
      </Text>
      <Text>
        <strong>Timestamp:</strong> {props.timestamp}
        <br />
        <strong>Vercel environment:</strong> {props.vercelEnv}
      </Text>
      <Text>
        If you received this, the Resend API key on Vercel is wired up
        correctly. No further action is required.
      </Text>
    </BaseLayout>
  )
}

export function deliveryTestPlainText(props: DeliveryTestProps): string {
  return [
    'This email was sent directly by the PokePrices Vercel application',
    'through the Resend API.',
    '',
    `Timestamp: ${props.timestamp}`,
    `Vercel environment: ${props.vercelEnv}`,
    '',
    'If you received this, the Resend API key on Vercel is wired up',
    'correctly. No further action is required.',
  ].join('\n')
}
