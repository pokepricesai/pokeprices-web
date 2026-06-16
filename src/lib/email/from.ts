// src/lib/email/from.ts
// Resolves the From / Reply-To addresses every send goes out under.
//
// Defaults are tuned for production: `hello@pokeprices.io` is the
// verified Resend sender today. Overrides land via env so the operator
// can promote a new sender after DNS verification without a redeploy.

const DEFAULT_FROM     = 'PokePrices <hello@pokeprices.io>'
const DEFAULT_REPLY_TO = 'hello@pokeprices.io'

export function resolveFromAddress(): string {
  const v = (process.env.EMAIL_FROM_ADDRESS ?? '').trim()
  return v.length > 0 ? v : DEFAULT_FROM
}

export function resolveReplyTo(): string {
  const v = (process.env.EMAIL_REPLY_TO ?? '').trim()
  return v.length > 0 ? v : DEFAULT_REPLY_TO
}
