// src/lib/editorial/__tests__/strategistIntents.test.ts
//
// Regression tests for the Strategist chat write-intent flow. Root
// cause of the "Strategist says it created a project but did not"
// bug was that the chat had no mutation capability at all — the
// model hallucinated a successful write. These tests lock down:
//
//   * intent detection catches the phrases the admin uses
//     ("please create this as a planned external article", "save this
//     idea", "add this to the plan", etc.)
//   * intent detection does NOT fire on discussion turns
//     ("could we create...", "should we save...")
//   * the latest structured brief in a chat history is used, not the
//     admin's chat turn or an unrelated earlier recommendation
//   * duplicate handling produces a grounded "already exists" line
//     rather than silently double-creating
//   * grounded confirmation messages match the acceptance spec
//     ("Added as planned external article. Project #N. ...")

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import {
  detectStrategistWriteIntent,
  extractLatestBriefFromHistory,
  buildGroundedConfirmation,
  type HistoryTurn,
} from '../strategistIntents'

// ── Intent detection ──────────────────────────────────────────────

describe('detectStrategistWriteIntent', () => {
  const positive: Array<[string, string]> = [
    ['Please create this in the opportunity radar as an external article',                      'planned'],
    ['Please create this as a planned external article.',                                        'planned'],
    ['save this idea',                                                                           'idea'],
    ['add this to the plan',                                                                     'planned'],
    ['add this to Editorial HQ',                                                                 'planned'],
    ['make this an external article',                                                            'planned'],
    ['make this an internal article',                                                            'planned'],
    ['plan this',                                                                                'planned'],
    ['put this in the backlog',                                                                  'idea'],
    ['add this to the idea backlog',                                                             'idea'],
    ['create the article',                                                                       'planned'],
    ['log this',                                                                                 'planned'],
  ]
  for (const [msg, expected] of positive) {
    it(`fires on "${msg}" with status=${expected}`, () => {
      const intent = detectStrategistWriteIntent(msg)
      expect(intent).not.toBeNull()
      expect(intent!.kind).toBe('create')
      expect(intent!.targetStatus).toBe(expected)
    })
  }

  const negative: string[] = [
    'What do you think of this angle?',
    'Could we create something similar for Charizard?',
    'Do you think we should save this for later?',
    "I'm not sure — let's think about it.",
    'How would you rank the alternatives?',
    'Actually, no.',
    '',
    '   ',
  ]
  for (const msg of negative) {
    it(`does NOT fire on non-command "${msg}"`, () => {
      expect(detectStrategistWriteIntent(msg)).toBeNull()
    })
  }
})

// ── Brief extraction from history ─────────────────────────────────

function pikachuRecommendationTurn(): HistoryTurn {
  return {
    role: 'assistant',
    content:
      'Sure, I can frame that.\n```json\n' + JSON.stringify({
        assistantMessage: 'Frame as an evergreen SEO piece.',
        recommendations: {
          summary: 'One strong external evergreen pick.',
          primary: [{
            headline: 'The History of Pikachu Pokémon Cards: From Day One to the 30th Anniversary',
            mode: 'external',
            angle: 'A collector-focused history of Pikachu cards from the earliest Japanese/English releases through major promos and the 30th anniversary.',
            whyNow: 'Broad evergreen recognition; strong internal-linking potential.',
            whyUseful: 'Serves collector curiosity and captures search demand for Pikachu-history queries.',
            evidenceAvailable: ['Pikachu tag page', 'Base Set / anniversary release calendar'],
            evidenceStillNeeded: [],
            citationPotential: 'high',
            searchOrEditorialIntent: 'Informational / collector',
            suggestedVisualsOrDataBlocks: ['Timeline of iconic Pikachu prints'],
            existingContentOverlap: { risk: 'low', related: [] },
            recommendedPublishDay: 'Tuesday',
            confidence: 'high',
            suggestedArticleType: 'evergreen_guide',
            radarOpportunityId: null,
            radarScore: null,
          }],
          alternatives: [],
        },
      }) + '\n```',
  }
}

describe('extractLatestBriefFromHistory', () => {
  it('extracts the primary recommendation from the most recent assistant turn', () => {
    const history: HistoryTurn[] = [
      { role: 'user',      content: 'Please make me an external article on the history of Pikachu.' },
      pikachuRecommendationTurn(),
      { role: 'user',      content: 'Please create this as a planned external article.' },
    ]
    const brief = extractLatestBriefFromHistory(history)
    expect(brief).not.toBeNull()
    expect(brief!.headline).toMatch(/History of Pikachu/i)
    expect(brief!.mode).toBe('external')
    expect(brief!.articleType).toBe('evergreen_guide')
    expect(brief!.angle).toMatch(/collector-focused/)
    expect(brief!.confidence).toBe('high')
  })

  it('walks backwards through history when the latest assistant turn has no recommendations', () => {
    const history: HistoryTurn[] = [
      pikachuRecommendationTurn(),
      { role: 'user',      content: 'What about a different angle?' },
      { role: 'assistant', content: 'That is a fair question — could go either way.' },  // no recs
      { role: 'user',      content: 'Please create this.' },
    ]
    const brief = extractLatestBriefFromHistory(history)
    expect(brief).not.toBeNull()
    expect(brief!.headline).toMatch(/History of Pikachu/i)
  })

  it('returns null when no assistant turn in history has a recommendation', () => {
    const history: HistoryTurn[] = [
      { role: 'user',      content: 'Please create this.' },
      { role: 'assistant', content: 'What idea did you have in mind?' },
    ]
    expect(extractLatestBriefFromHistory(history)).toBeNull()
  })

  it('coerces an unknown suggestedArticleType to a lane-appropriate default', () => {
    const bad: HistoryTurn = {
      role: 'assistant',
      content: '```json\n' + JSON.stringify({
        assistantMessage: 'ok',
        recommendations: { summary: '', primary: [{
          headline: 'A completely new idea',
          mode: 'external',
          suggestedArticleType: 'not-a-real-type',
          citationPotential: 'medium', confidence: 'medium',
          existingContentOverlap: { risk: 'none', related: [] },
          recommendedPublishDay: '', evidenceAvailable: [], evidenceStillNeeded: [],
          suggestedVisualsOrDataBlocks: [],
          angle: '', whyNow: '', whyUseful: '', searchOrEditorialIntent: '',
        }], alternatives: [] },
      }) + '\n```',
    }
    const brief = extractLatestBriefFromHistory([bad])
    expect(brief!.articleType).toBe('evergreen_guide')
    expect(brief!.mode).toBe('external')
  })
})

// ── Grounded confirmation messages ────────────────────────────────

describe('buildGroundedConfirmation', () => {
  it('generates the acceptance-spec confirmation for a real create', () => {
    const msg = buildGroundedConfirmation({
      kind: 'created', projectId: 34, title: 'The History of Pikachu...',
      articleType: 'evergreen_guide', mode: 'external', status: 'planned',
    })
    expect(msg).toMatch(/planned external article/i)
    expect(msg).toMatch(/#34/)
    expect(msg).toMatch(/evergreen guide/i)
    expect(msg).toMatch(/Pipeline/i)
  })

  it('surfaces the existing project when a duplicate is detected', () => {
    const msg = buildGroundedConfirmation({
      kind: 'duplicate', projectId: 34, title: 'The History of Pikachu...', status: 'planned',
    })
    expect(msg).toMatch(/already exists as #34/)
    expect(msg).toMatch(/Nothing new was created/i)
  })

  it('routes to Idea Backlog when created as an idea', () => {
    const msg = buildGroundedConfirmation({
      kind: 'created', projectId: 88, title: 't',
      articleType: 'evergreen_guide', mode: 'external', status: 'idea',
    })
    expect(msg).toMatch(/Idea Backlog/i)
  })

  it('reports failure honestly rather than pretending', () => {
    const msg = buildGroundedConfirmation({ kind: 'failed', error: 'article_type must be one of: ...' })
    expect(msg).toMatch(/couldn't create the project/i)
    expect(msg).toMatch(/article_type/)
  })

  it('tells the admin the brief was missing when no recommendation could be extracted', () => {
    const msg = buildGroundedConfirmation({ kind: 'no_brief' })
    expect(msg).toMatch(/structured brief/i)
    expect(msg).toMatch(/propose the article/i)
  })
})
