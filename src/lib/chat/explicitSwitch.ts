// src/lib/chat/explicitSwitch.ts
//
// Block 5A-W-52A.2 — deterministic explicit-card-switch signal
// used by the client (InlineChat) to decide whether a message on
// a pinned activeCard should reuse that card or resolve fresh.
//
// This is NOT a classifier — cheap surface checks only:
//   1. NEVER-SWITCH: message is a stock follow-up phrase ("PSA 9",
//      "raw", "reverse holo", "sell it", "grade it", "it",
//      "this card", etc.). Return false immediately so a pinned
//      Charizard turn stays pinned.
//   2. Different KNOWN_SETS name from activeCard.setName → switch.
//   3. Explicit "#NN" or "NN/MM" where NN differs from
//      activeCard.cardNumber → switch.
//   4. Explicit language keyword ("japanese", "english") that
//      differs from activeCard.language → switch.
//   5. A capitalized proper-noun token that does not appear in
//      activeCard.cardName and is not a set name / grader / metric
//      → switch (typical case: "What about Blastoise instead?").
//
// Kept in a pure module so tests can import it without the
// supabase client's env vars.

import type { CardContext } from './cardContext'

// Sets used to detect an in-message reference to a different set.
export const KNOWN_SETS: readonly string[] = [
  'Base Set', 'Jungle', 'Fossil', 'Team Rocket', 'Neo Genesis', 'Neo Discovery',
  'Neo Revelation', 'Neo Destiny', 'Legendary Collection', 'Expedition',
  'Aquapolis', 'Skyridge', 'EX Ruby & Sapphire', 'EX Sandstorm', 'EX Dragon',
  'EX Team Magma vs Team Aqua', 'EX Hidden Legends', 'EX FireRed & LeafGreen',
  'EX Team Rocket Returns', 'EX Deoxys', 'EX Emerald', 'EX Unseen Forces',
  'EX Delta Species', 'EX Legend Maker', 'EX Holon Phantoms', 'EX Crystal Guardians',
  'EX Dragon Frontiers', 'EX Power Keepers',
  'Diamond & Pearl', 'Mysterious Treasures', 'Secret Wonders', 'Great Encounters',
  'Majestic Dawn', 'Legends Awakened', 'Stormfront',
  'Platinum', 'Rising Rivals', 'Supreme Victors', 'Arceus',
  'HeartGold SoulSilver', 'Unleashed', 'Undaunted', 'Triumphant',
  'Call of Legends', 'Black & White', 'Emerging Powers', 'Noble Victories',
  'Next Destinies', 'Dark Explorers', 'Dragons Exalted', 'Boundaries Crossed',
  'Plasma Storm', 'Plasma Freeze', 'Plasma Blast', 'Legendary Treasures',
  'XY', 'Flashfire', 'Furious Fists', 'Phantom Forces', 'Primal Clash',
  'Roaring Skies', 'Ancient Origins', 'BREAKthrough', 'BREAKpoint',
  'Generations', 'Fates Collide', 'Steam Siege', 'Evolutions',
  'Sun & Moon', 'Guardians Rising', 'Burning Shadows', 'Crimson Invasion',
  'Ultra Prism', 'Forbidden Light', 'Celestial Storm', 'Dragon Majesty',
  'Lost Thunder', 'Team Up', 'Unbroken Bonds', 'Unified Minds',
  'Cosmic Eclipse', 'Hidden Fates', 'Shining Fates',
  'Sword & Shield', 'Rebel Clash', 'Darkness Ablaze', 'Vivid Voltage',
  'Battle Styles', 'Chilling Reign', 'Evolving Skies',
  'Celebrations', 'Fusion Strike', 'Brilliant Stars', 'Astral Radiance',
  'Pokemon GO', 'Lost Origin', 'Silver Tempest', 'Crown Zenith',
  'Scarlet & Violet', 'Paldea Evolved', 'Obsidian Flames', 'Paradox Rift',
  'Paldean Fates', 'Temporal Forces', 'Twilight Masquerade', 'Shrouded Fable',
  'Stellar Crown', 'Surging Sparks', 'Prismatic Evolutions', 'Journey Together',
]

const SETS_SORTED = [...KNOWN_SETS].sort((a, b) => b.length - a.length)

// Explicit non-switch patterns. Match these BEFORE any switch check
// so a stock follow-up like "should I sell it?" cannot accidentally
// trigger a switch via a stray capitalized word.
const NEVER_SWITCH_PATTERNS: RegExp[] = [
  /^\s*(?:it|this|that|the|these|those)\s*[.?!]?\s*$/i,
  /^\s*(?:yes|no|ok|okay|sure|thanks|thank you)\b/i,
  /^\s*(?:in\s+(?:dollars|pounds|euros|usd|gbp|eur))\s*[.?!]?\s*$/i,
  /^\s*(?:365|180|90|30|7)\s*days?\s*[.?!]?\s*$/i,
  /^\s*(?:this|the|that)\s+card\s*[.?!]?\s*$/i,
]

// Sub-string signals that indicate the message is a *dimension*
// question about the active card ("what about PSA 9?", "grade it")
// — not a new-card request. If NONE of the switch signals below
// beat these, we return false.
const DIMENSION_SIGNALS: RegExp[] = [
  /\bpsa\s*[0-9]+\b/i,
  /\bcgc\s*[0-9]+(?:\.\d)?\b/i,
  /\bbgs\s*[0-9]+(?:\.\d)?\b/i,
  /\bsgc\s*[0-9]+\b/i,
  /\bace\s*[0-9]+\b/i,
  /\btag\s*[0-9]+\b/i,
  /\braw\b/i,
  /\breverse\s+holo\b/i,
  /\b1st\s+edition\b/i,
  /\bshadowless\b/i,
  /\bthis\s+card\b/i,
  /\b(?:sell|grade|buy|hold|keep|flip)\s+it\b/i,
  /\ball[- ]time\s+high\b/i,
]

// Capitalized proper-noun-like tokens that are NOT card names.
// If a message contains only these plus lowercase words, the
// name-diff signal must not fire.
//
// Split into two categories for clarity:
//   * SENTENCE_OPENERS — question / imperative starters that get
//     capitalised purely by sentence position. Ignoring these
//     stops "How has it performed?" from firing the name signal.
//   * NON_NAME_TOKENS — grader labels, month/day names, first-
//     person contractions.
const SENTENCE_OPENERS = [
  'How','What','Why','When','Where','Which','Who','Whose','Whom',
  'Should','Would','Could','Will','Can','Do','Does','Did',
  'Is','Are','Was','Were','Has','Have','Had','Am',
  'Be','Been','Being','Let','Give','Show','Tell','Ask','Try',
  'And','But','Or','So','Then','Now','Also','Just','Actually',
  'Yes','No','OK','Okay','Please','Thanks','Thank',
]
const NON_NAME_TOKENS = [
  'PSA','CGC','BGS','SGC','ACE','TAG',
  'PokePrices','Pokemon','Pokémon','TCG',
  'English','Japanese','UK','US','USA',
  'January','February','March','April','May','June','July',
  'August','September','October','November','December',
  'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday',
  'I','I\'m','I\'ve','I\'d','I\'ll',
]
const CAPITAL_NON_NAMES = new Set([...SENTENCE_OPENERS, ...NON_NAME_TOKENS])

function extractProperNounTokens(text: string): string[] {
  // Capitalized 3+ letter tokens, excluding sentence-initial pronouns.
  const matches = text.match(/\b[A-Z][a-zA-Z'\-]{2,}\b/g) ?? []
  return matches.filter(t => !CAPITAL_NON_NAMES.has(t))
}

function tokensOf(text: string): string[] {
  return text.split(/\W+/).filter(Boolean).map(t => t.toLowerCase())
}

export function detectExplicitCardSwitch(text: string, activeCard: CardContext): boolean {
  if (!text) return false
  const trimmed = text.trim()
  // 1. Never-switch stock phrases.
  for (const p of NEVER_SWITCH_PATTERNS) {
    if (p.test(trimmed)) return false
  }

  // 2. Explicit different set name.
  const activeSetLower = activeCard.setName.toLowerCase()
  for (const set of SETS_SORTED) {
    const s = set.toLowerCase()
    if (s === activeSetLower) continue
    const pattern = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (pattern.test(trimmed)) return true
  }

  // 3. Explicit language switch. "japanese"/"english"/"jp"/"en"
  //    mentioned when activeCard has the opposite language.
  const lower = trimmed.toLowerCase()
  const mentionsJp = /\b(?:japanese|jp|japan)\b/.test(lower)
  const mentionsEn = /\b(?:english|en(?:glish)?|eng)\b/.test(lower)
  if (activeCard.language === 'en' && mentionsJp) return true
  if (activeCard.language === 'jp' && mentionsEn) return true

  // 4. Different collector number ("#NN" / "NN/MM").
  const numMatch = lower.match(/#\s*(\d{1,4})\b/) || lower.match(/\b(\d{1,4})\s*\/\s*\d{1,4}\b/)
  if (numMatch && numMatch[1] && numMatch[1] !== activeCard.cardNumber) return true

  // 5. Different proper-noun (card name) token.
  //    Only fire when the message is NOT dominated by dimension
  //    signals — a "what about PSA 9" style follow-up should not
  //    switch even if some capitalized token slipped in.
  const dimensionOnly = DIMENSION_SIGNALS.some(p => p.test(trimmed))
  if (!dimensionOnly) {
    const properTokens = extractProperNounTokens(trimmed)
    if (properTokens.length > 0) {
      const activeNameTokens = new Set(tokensOf(activeCard.cardName ?? ''))
      const foreignName = properTokens.find(t => !activeNameTokens.has(t.toLowerCase()))
      if (foreignName) return true
    }
  }

  return false
}
