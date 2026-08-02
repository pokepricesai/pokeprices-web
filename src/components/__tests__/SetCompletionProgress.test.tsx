// Block 5A-W-50C — SetCompletionProgress contract (text-based, same
// convention as the other component tests in this folder).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/components/SetCompletionProgress.tsx'),
  'utf8',
)

describe('SetCompletionProgress — contract', () => {
  it('renders nothing when ownedDistinct <= 0', () => {
    // Explicit guard so untouched sets show no placeholder.
    expect(SRC).toMatch(/if \(ownedDistinct <= 0\)\s+return null/)
  })

  it('renders nothing when totalEligible <= 0', () => {
    expect(SRC).toMatch(/if \(totalEligible <= 0\)\s+return null/)
  })

  it('guards non-finite inputs', () => {
    expect(SRC).toContain('Number.isFinite(ownedDistinct)')
    expect(SRC).toContain('Number.isFinite(totalEligible)')
  })

  it('exposes progressbar semantics for assistive tech', () => {
    expect(SRC).toContain('role="progressbar"')
    expect(SRC).toContain('aria-valuenow={percentage}')
    expect(SRC).toContain('aria-valuemin={0}')
    expect(SRC).toContain('aria-valuemax={100}')
  })

  it('builds a descriptive accessible label including the set name', () => {
    expect(SRC).toContain('${setName} — ${percentage}% complete')
    expect(SRC).toContain('${ownedDistinct} of ${totalEligible} cards')
  })

  it('supports compact + full variants (data attribute for tests)', () => {
    expect(SRC).toContain("variant?:      'compact' | 'full'")
    expect(SRC).toContain('data-completion-variant={variant}')
  })

  it('marks 100% with a distinct data flag (no colour-hex assertion)', () => {
    // 100% renders a "Complete" chip + sets data-completion-complete
    expect(SRC).toContain('const isDone   = percentage >= 100')
    expect(SRC).toContain(`data-completion-complete={isDone ? 'true' : 'false'}`)
    expect(SRC).toMatch(/>\s*Complete\s*</)
  })

  it('uses the shared computePercentage helper (never in-lines math)', () => {
    // Ensures both call sites (compact + full) get the same clamp/round.
    expect(SRC).toContain("import { computePercentage } from '@/lib/setCompletion'")
    expect(SRC).toContain('computePercentage(ownedDistinct, totalEligible)')
  })

  it('does not use emoji in the visible chrome', () => {
    const EMOJI_CHARS = ['✓', '⭐', '🃏', '🎯', '📦']
    for (const emoji of EMOJI_CHARS) {
      expect(SRC).not.toContain(emoji)
    }
  })
})
