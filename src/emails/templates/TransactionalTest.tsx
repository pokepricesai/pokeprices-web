// src/emails/templates/TransactionalTest.tsx
//
// Generic transactional/service email used to validate the
// transactional category path end-to-end without activating any
// account flow. Carries NO unsubscribe link — transactional category
// must reach the recipient unconditionally.

import BaseLayout from '../layouts/BaseLayout'
import { Text } from '@react-email/components'

export type TransactionalTestProps = {
  displayName: string | null
}

export const TRANSACTIONAL_TEST_KEY     = 'transactional_test'
export const TRANSACTIONAL_TEST_SUBJECT = 'PokePrices service notice (test)'

export default function TransactionalTest(props: TransactionalTestProps) {
  const who = props.displayName ?? 'there'
  return (
    <BaseLayout
      preview="A service notice from PokePrices."
      headline="Service notice"
    >
      <Text>Hi {who},</Text>
      <Text>
        This is a transactional test message from PokePrices. We send
        transactional notices like this when something about your
        account or a tool you have used needs a one-off update.
      </Text>
      <Text>
        Transactional messages do not carry an unsubscribe link because
        they cover account-critical situations such as security
        notices, password resets and refunds.
      </Text>
      <Text>
        No action is needed.
      </Text>
    </BaseLayout>
  )
}

export function transactionalTestPlainText(props: TransactionalTestProps): string {
  const who = props.displayName ?? 'there'
  return [
    `Hi ${who},`,
    '',
    'This is a transactional test message from PokePrices. We send',
    'transactional notices like this when something about your account',
    'or a tool you have used needs a one-off update.',
    '',
    'Transactional messages do not carry an unsubscribe link because',
    'they cover account-critical situations such as security notices,',
    'password resets and refunds.',
    '',
    'No action is needed.',
  ].join('\n')
}
