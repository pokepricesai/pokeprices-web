// src/lib/editorial/__tests__/dashPrompts.test.ts
//
// Prompt-content lock: every editorial writer prompt must explicitly
// ban both em dashes and en dashes and must instruct the model to
// self-check for their presence before returning the article. These
// tests fail loudly if a future prompt edit accidentally relaxes the
// rule.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { buildDeepResearchPrompt } from '../deepResearchPrompt'
import { INTERNAL_WRITER_SYSTEM_PROMPT } from '../writer/writerInternal'
import { VALIDATE_AND_FIX_SYSTEM_PROMPT } from '../writer/validateAndFix'

describe('editorial prompts ban em + en dashes', () => {
  it('Deep Research prompt bans em and en dashes explicitly', () => {
    const prompt = buildDeepResearchPrompt({
      project: { id: 1, title: 'Test', angle: null, articleType: 'evergreen_guide', targetPublishAt: null },
      today: '2026-09-10',
      internalLinks: [],
    })
    expect(prompt).toMatch(/em dashes or en dashes/i)
    expect(prompt).toMatch(/first-edition|30-year|high-value/)   // compound-hyphen carve-out
    expect(prompt).toMatch(/Search the finished prose for the em dash character/i)
  })

  it('Deep Research prompt template contains NO em or en dash characters itself', () => {
    // If the prompt itself contains "—" or "–" the model imitates it,
    // which is exactly what this whole change is trying to prevent.
    const prompt = buildDeepResearchPrompt({
      project: { id: 1, title: 'Test', angle: null, articleType: 'evergreen_guide', targetPublishAt: null },
      today: '2026-09-10',
      internalLinks: [{ title: 'Link', url: '/set/base-set' }],
    })
    // Skip the literal self-check line that explicitly names the
    // characters as targets to look for — that line MUST contain them.
    const withoutSelfCheck = prompt.replace(/Search the finished prose[^\n]+/i, '')
    expect(withoutSelfCheck.includes('—')).toBe(false)
    expect(withoutSelfCheck.includes('–')).toBe(false)
  })

  it('Internal writer prompt bans em and en dashes and includes a self-check', () => {
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/No em dashes and no en dashes/i)
    expect(INTERNAL_WRITER_SYSTEM_PROMPT).toMatch(/Search your finished bodyMarkdown for the em dash character/i)
  })

  it('Validate & Fix prompt tells the checker to strip stray dashes while fixing', () => {
    expect(VALIDATE_AND_FIX_SYSTEM_PROMPT).toMatch(/em dashes or en dashes/i)
    expect(VALIDATE_AND_FIX_SYSTEM_PROMPT).toMatch(/remove it while you are here/i)
  })
})
