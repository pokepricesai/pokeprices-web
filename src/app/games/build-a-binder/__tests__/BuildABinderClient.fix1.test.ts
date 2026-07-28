// Block 5A-W-47E-A-FIX1 — pin the UX corrections applied to Build a
// Binder before deployment. The client component is heavy (Supabase
// import chain, useEffect data fetch) so these are source-invariant
// tests — they read BuildABinderClient.tsx / games/page.tsx as text
// and assert the specific bytes that implement each behaviour.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT_SRC = readFileSync(
  join(__dirname, '..', 'BuildABinderClient.tsx'),
  'utf8',
)
const INDEX_SRC = readFileSync(
  join(__dirname, '..', '..', 'page.tsx'),
  'utf8',
)

// ── FIX1 (1): unaffordable cards remain visible ──

describe('FIX1 — unaffordable cards remain visible in the pool', () => {
  it('the visible-pool memo does NOT filter by affordable budget any more', () => {
    // Regression pin: the pre-FIX1 code called `affordableCards`
    // inside the visible-pool memo, which stripped unaffordable
    // rows from the grid. FIX1 removed that call so the grid stays
    // stable.
    const memoBlock = CLIENT_SRC.match(/const filteredPool = useMemo\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[[\s\S]*?\]\)/)
    expect(memoBlock, 'filteredPool memo not found').toBeTruthy()
    expect(memoBlock![0]).not.toContain('affordableCards')
  })
  it('does not import the affordableCards helper any more (dead-code guard)', () => {
    // The pure helper is preserved and still unit-tested, but the
    // client should no longer import it. If it does, it likely
    // reintroduced the "hide unaffordable" bug.
    expect(CLIENT_SRC).not.toMatch(/import\s*\{[^}]*affordableCards[^}]*\}\s*from\s*'@\/lib\/games\/buildABinder'/)
  })

  it('each pool tile carries per-card affordability logic', () => {
    // The render must compute overBudget from remainingCents and use
    // it as the disabled reason. The specific patterns pinned here
    // are the ones the render uses.
    expect(CLIENT_SRC).toContain('c.current_raw > stats.remainingCents')
    expect(CLIENT_SRC).toContain("'Over remaining budget'")
    expect(CLIENT_SRC).toContain("'Binder full'")
  })

  it('the pool button propagates the disabled state via `disabled` AND `aria-disabled`', () => {
    // The button is non-selectable when either the binder is full
    // OR the card is over budget. Both attributes must be wired to
    // the same source-of-truth so keyboard + AT users see the same
    // state as sighted users.
    expect(CLIENT_SRC).toMatch(/disabled=\{nonSelectable\}/)
    expect(CLIENT_SRC).toMatch(/aria-disabled=\{nonSelectable\}/)
  })

  it('renders a restrained textual reason ("Over remaining budget" / "Binder full") — no bright badge or alarm', () => {
    // Regression guard against loud "TOO EXPENSIVE!" red badges.
    // Isolate the block that renders the `{reason}` label and check
    // it doesn't set an alarm colour on that specific label.
    const reasonBlock = CLIENT_SRC.match(/\{reason && \([\s\S]*?\)\}/)
    expect(reasonBlock, 'reason render block not found').toBeTruthy()
    expect(reasonBlock![0]).not.toContain('#ef4444')
    expect(reasonBlock![0]).toContain('var(--text-muted)')
    expect(CLIENT_SRC).not.toContain('TOO EXPENSIVE')
    expect(CLIENT_SRC).not.toContain('CANT AFFORD')
  })
})

// ── FIX1 (2): Games index has no 📒 emoji ──

describe('FIX1 — Games index removes the 📒 emoji from Build a Binder', () => {
  it('the games index does NOT contain the notebook emoji', () => {
    expect(INDEX_SRC).not.toContain('📒')
  })
  it('Build a Binder is still listed in ANYTIME_GAMES exactly once', () => {
    const matches = INDEX_SRC.match(/href:\s*'\/games\/build-a-binder'/g) ?? []
    expect(matches.length).toBe(1)
  })
  it('Build a Binder entry no longer sets an emoji field (guard against reintroducing another emoji)', () => {
    // Locate the /games/build-a-binder entry and confirm no `emoji:`
    // property survives inside it.
    const entry = INDEX_SRC.match(
      /\{[^{}]*href:\s*'\/games\/build-a-binder'[\s\S]*?\}/,
    )
    expect(entry, 'Build a Binder entry not found in ANYTIME_GAMES').toBeTruthy()
    expect(entry![0]).not.toMatch(/emoji:\s*'/)
    // No other single emoji character sneaked into the entry either
    // (spot-check the individual emojis the game area uses today).
    for (const glyph of ['📒', '🎯', '📈', '📕', '📗', '📘', '📙', '📖', '🎮', '🎲']) {
      expect(entry![0]).not.toContain(glyph)
    }
  })
  it('the other two games retain their existing emojis (regression pin)', () => {
    // The fix specifically targets Build a Binder; the sibling
    // games should still carry their emojis until a consistent icon
    // system exists.
    expect(INDEX_SRC).toContain("emoji: '🎯'")
    expect(INDEX_SRC).toContain("emoji: '📈'")
  })
  it('the emoji div only renders when the game has an emoji (no empty spacer div)', () => {
    // Pin the conditional render so a future refactor can't
    // accidentally always render the div.
    expect(INDEX_SRC).toContain('{g.emoji && <div')
  })
})

// ── FIX1 (3): budget-change reset behaviour ──

describe('FIX1 — changing the budget resets the binder + finalised result', () => {
  it('defines a shared resetPicksAndScore helper (avoids duplicated reset logic)', () => {
    expect(CLIENT_SRC).toContain('function resetPicksAndScore()')
    expect(CLIENT_SRC).toMatch(/resetPicksAndScore\(\)[\s\S]*?function resetGame/)
  })
  it('changeBudget uses the shared reset helper (not duplicated setPicks / setFinalisedScore calls)', () => {
    const changeBudgetBlock = CLIENT_SRC.match(/function changeBudget\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/)
    expect(changeBudgetBlock, 'changeBudget function not found').toBeTruthy()
    const body = changeBudgetBlock![0]
    expect(body).toContain('resetPicksAndScore()')
    // The old duplicated `setPicks([])` + `setFinalisedScore(null)`
    // in-function calls must be gone from changeBudget.
    expect(body).not.toContain('setPicks([])')
    expect(body).not.toContain('setFinalisedScore(null)')
  })
  it('changeBudget leaves search + sort UNTOUCHED (only picks + score reset)', () => {
    const changeBudgetBlock = CLIENT_SRC.match(/function changeBudget\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/)!
    expect(changeBudgetBlock[0]).not.toContain('setQuery(')
    expect(changeBudgetBlock[0]).not.toContain('setSortMode(')
  })
  it('no-ops when the user selects the same budget again (avoids clearing a valid binder)', () => {
    const changeBudgetBlock = CLIENT_SRC.match(/function changeBudget\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/)!
    expect(changeBudgetBlock[0]).toMatch(/if\s*\(next === budgetCents\)\s*return/)
  })
  it('resetGame reuses the shared helper and also clears the search query', () => {
    const resetGameBlock = CLIENT_SRC.match(/function resetGame\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/)!
    expect(resetGameBlock[0]).toContain('resetPicksAndScore()')
    expect(resetGameBlock[0]).toContain("setQuery('')")
  })
})
