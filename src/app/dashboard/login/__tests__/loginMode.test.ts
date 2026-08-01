// Block 5A-W-50B-FIX1 — login page must honour ?mode=signup so the
// set-page auth prompt's "Create free account" button lands on the
// registration form, not the default sign-in form.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/dashboard/login/page.tsx'),
  'utf8',
)

describe('/dashboard/login — initial mode', () => {
  it('reads the mode from the URL search params', () => {
    // Must inspect searchParams for a 'mode' value.
    expect(SRC).toContain("searchParams.get('mode')")
  })

  it('accepts signup / signin / magic', () => {
    // All three internal Mode values should be reachable via the URL.
    expect(SRC).toMatch(/m === ['"]signup['"] \|\| m === ['"]signin['"] \|\| m === ['"]magic['"]/)
  })

  it('falls back to signin when the mode query is missing or unknown', () => {
    // The initialMode ternary must default to 'signin' for anything else.
    expect(SRC).toMatch(/:\s*['"]signin['"]/)
  })

  it('mode state is initialised from initialMode (not hardcoded to signin)', () => {
    // The old code was: const [mode, setMode] = useState<Mode>('signin')
    // FIX1 replaces the literal with the URL-derived value.
    expect(SRC).toMatch(/useState<Mode>\(initialMode\)/)
  })
})
