// src/lib/editorial/__tests__/ideaChatPrompt.test.ts
//
// Simplified HQ idea-chat: prompt structure + response parser tests.
// The parser must be forgiving (Anthropic returns fenced JSON most
// of the time, plain JSON sometimes, and prose when things go
// sideways) but never invent candidates.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import {
  IDEA_CHAT_SYSTEM_PROMPT,
  buildDiscoverUserTurn,
  buildDevelopUserTurn,
  parseIdeaChatResponse,
} from '../ideaChatPrompt'

describe('IDEA_CHAT_SYSTEM_PROMPT', () => {
  it('states the two-lane distinction', () => {
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/EXTERNAL/)
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/INTERNAL/)
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/No proprietary PokePrices data is required/i)
  })
  it('forbids the model from claiming a successful save', () => {
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/persistence is triggered by the admin clicking Yes/i)
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/Do not claim anything was saved/i)
  })
  it('mandates the JSON envelope with { message, ideas: [...] }', () => {
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/"message":\s*string/)
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/"ideas":/)
  })
  it('preserves the American-English / no-em-dashes rules', () => {
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/American English/)
    expect(IDEA_CHAT_SYSTEM_PROMPT).toMatch(/No em dashes/i)
  })
})

describe('buildDiscoverUserTurn', () => {
  it('emits LANE + the admin request verbatim', () => {
    const t = buildDiscoverUserTurn({ lane: 'external', userMessage: 'give me 5 Pikachu SEO ideas' })
    expect(t).toContain('LANE=external')
    expect(t).toContain('give me 5 Pikachu SEO ideas')
    expect(t).not.toContain('MODE=develop_existing')
  })
  it('injects the analytics summary only for the internal lane', () => {
    const withSummary = buildDiscoverUserTurn({ lane: 'internal', userMessage: 'x', internalSummary: 'Trend: Base Set rose 4.2%' })
    expect(withSummary).toContain('LANE=internal')
    expect(withSummary).toContain('Trend: Base Set rose 4.2%')

    const external = buildDiscoverUserTurn({ lane: 'external', userMessage: 'x', internalSummary: 'ignored' })
    expect(external).not.toContain('ignored')
  })
})

describe('buildDevelopUserTurn', () => {
  it('surfaces the existing idea as structured JSON so the model knows to refine', () => {
    const t = buildDevelopUserTurn({
      lane: 'external',
      existingIdea: { title: 'Pikachu history', angle: 'from base set to 30th', articleType: 'evergreen_guide' },
      userMessage: 'stronger SEO angle please',
    })
    expect(t).toContain('MODE=develop_existing')
    expect(t).toContain('"title": "Pikachu history"')
    expect(t).toContain('stronger SEO angle')
  })
})

describe('parseIdeaChatResponse', () => {
  it('parses a well-formed fenced JSON reply', () => {
    const raw = '```json\n' + JSON.stringify({
      message: 'Three angles for you.',
      ideas: [
        { title: 'History of Pikachu Cards',       mode: 'external', articleType: 'evergreen_guide', angle: 'A collector-focused history.', why: 'Broad evergreen search demand.' },
        { title: 'Base Set Pikachu Buying Guide',  mode: 'external', articleType: 'evergreen_guide', angle: 'Practical buying guide.',      why: 'Purchase-intent search.' },
        { title: 'Pikachu Illustrator Feature',    mode: 'external', articleType: 'evergreen_guide', angle: 'Behind the artwork.',          why: 'Topical authority.' },
      ],
    }) + '\n```'
    const parsed = parseIdeaChatResponse(raw, 'external')
    expect(parsed.message).toMatch(/Three angles/)
    expect(parsed.ideas).toHaveLength(3)
    expect(parsed.ideas[0].title).toMatch(/Pikachu/)
    expect(parsed.ideas[0].mode).toBe('external')
    expect(parsed.ideas[0].articleType).toBe('evergreen_guide')
  })

  it('drops candidates with a missing title', () => {
    const raw = '```json\n' + JSON.stringify({
      message: 'ok',
      ideas: [
        { title: 'Keep',                                         mode: 'external', articleType: 'evergreen_guide', angle: '', why: '' },
        { title: '', mode: 'external', articleType: 'evergreen_guide' },
      ],
    }) + '\n```'
    expect(parseIdeaChatResponse(raw, 'external').ideas).toHaveLength(1)
  })

  it('coerces unknown articleType to a lane-appropriate default', () => {
    const raw = '```json\n' + JSON.stringify({
      message: 'ok',
      ideas: [
        { title: 'A', mode: 'external', articleType: 'not_a_real_type', angle: '', why: '' },
        { title: 'B', mode: 'internal', articleType: 'also_wrong',       angle: '', why: '' },
      ],
    }) + '\n```'
    const parsed = parseIdeaChatResponse(raw, 'external')
    expect(parsed.ideas[0].articleType).toBe('evergreen_guide')
    expect(parsed.ideas[1].articleType).toBe('data_study')
  })

  it('falls back to lane when mode is missing', () => {
    const raw = '```json\n' + JSON.stringify({
      message: '',
      ideas: [{ title: 'Untyped mode', articleType: 'evergreen_guide' }],
    }) + '\n```'
    expect(parseIdeaChatResponse(raw, 'internal').ideas[0].mode).toBe('internal')
  })

  it('recovers via balanced-brace when the model omits the fence', () => {
    const raw = 'Sure.\n' + JSON.stringify({
      message: 'Here.', ideas: [{ title: 'One', mode: 'external', articleType: 'evergreen_guide', angle: '', why: '' }],
    }) + '\n\nHope this helps.'
    const parsed = parseIdeaChatResponse(raw, 'external')
    expect(parsed.ideas).toHaveLength(1)
  })

  it('degrades gracefully when the response has no JSON at all', () => {
    const raw = 'Sorry, I ran into an error and cannot produce structured ideas right now.'
    const parsed = parseIdeaChatResponse(raw, 'external')
    expect(parsed.ideas).toEqual([])
    expect(parsed.message.length).toBeGreaterThan(0)
  })

  it('never returns more than 12 candidates even if the model over-produces', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `t${i}`, mode: 'external', articleType: 'evergreen_guide', angle: '', why: '' }))
    const raw = '```json\n' + JSON.stringify({ message: 'a lot', ideas: many }) + '\n```'
    expect(parseIdeaChatResponse(raw, 'external').ideas.length).toBeLessThanOrEqual(12)
  })
})
