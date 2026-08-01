// Block 5A-W-50B — AuthPromptModal contract tests (text-based, same
// convention as the other component tests in this folder).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/components/AuthPromptModal.tsx'),
  'utf8',
)

describe('AuthPromptModal — contract', () => {
  it('closed when open=false (returns null)', () => {
    expect(SRC).toMatch(/if \(!open\) return null/)
  })

  it('renders context-appropriate title copy', () => {
    // Two contexts: watchlist ("Save this card") + portfolio
    // ("Track this card"). One shared modal, per brief.
    expect(SRC).toContain("'Save this card'")
    expect(SRC).toContain("'Track this card'")
  })

  it('preserves returnTo on both auth actions', () => {
    // Both loginHref and signupHref must include the encoded returnTo.
    expect(SRC).toContain('/dashboard/login?returnTo=')
    expect(SRC).toContain('/dashboard/login?mode=signup&returnTo=')
    expect(SRC).toContain('const encodedReturn = encodeURIComponent(returnTo)')
  })

  it('FIX1 — Log in and Create free account point to DISTINCT auth states', () => {
    // Log-in link uses loginHref (default sign-in state);
    // Create-account link uses signupHref (?mode=signup).
    expect(SRC).toContain('href={loginHref}')
    expect(SRC).toContain('href={signupHref}')
    // They must not be the same variable — the two hrefs are distinct
    expect(SRC).not.toMatch(/const loginHref\s*=\s*signupHref/)
    expect(SRC).not.toMatch(/const signupHref\s*=\s*loginHref/)
  })

  it('closes on Escape', () => {
    expect(SRC).toContain("if (e.key === 'Escape') onClose()")
  })

  it('closes on backdrop click but not on inner click', () => {
    expect(SRC).toMatch(/e\.target === e\.currentTarget\)?\s*onClose\(\)/)
  })

  it('exposes accessible dialog semantics', () => {
    expect(SRC).toContain('role="dialog"')
    expect(SRC).toContain('aria-modal="true"')
    expect(SRC).toContain('aria-labelledby="auth-prompt-title"')
    expect(SRC).toContain('id="auth-prompt-title"')
    expect(SRC).toContain('aria-label="Close"')
  })

  it('focuses the first action when opened (keyboard flow)', () => {
    expect(SRC).toContain('firstBtnRef.current?.focus()')
  })

  it('restores focus to the trigger element on close', () => {
    expect(SRC).toMatch(/prev\?\.focus\?\.\(\)/)
  })

  it('provides Log in + Create free account + Cancel actions', () => {
    // JSX puts inner text on its own line, so `>Log in<` never appears
    // literally — assert on the human-readable label instead.
    expect(SRC).toMatch(/>\s*Log in\s*</)
    expect(SRC).toMatch(/>\s*Create free account\s*</)
    expect(SRC).toMatch(/>\s*Cancel\s*</)
  })

  it('does not trigger any auto-write before auth', () => {
    // The modal is UI-only — no supabase import, no DB calls. The
    // words "watchlist" / "portfolio" appear in the visible copy
    // (that's fine — they describe what the user is about to save).
    // What matters is no import from '@/lib/supabase' and no query.
    expect(SRC).not.toMatch(/from ['"]@\/lib\/supabase['"]/)
    expect(SRC).not.toContain('.from(')
    expect(SRC).not.toContain('.insert(')
    expect(SRC).not.toContain('.delete(')
  })
})
