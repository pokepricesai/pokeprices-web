// src/lib/editorial/styleFix.ts
//
// Final Cleanup — deterministic style repair.
//
// Most style-guard violations are simple substitutions that do not
// require an AI call:
//   * em dash (U+2014) → period or comma with a space
//   * British spellings → American forms (whole-word, case-preserving)
//   * whitespace cleanup (double spaces, stray line breaks around
//     punctuation)
//
// Forbidden trope phrases like "That said," or "Short answer:" are
// harder to fix deterministically without changing meaning, so those
// still surface as violations for optional AI repair. But this
// module first removes every fix that is safe to make automatically,
// so the tail of remaining violations is small enough that most
// runs will not need an AI style-repair call at all.
//
// Return value:
//   { text, changed: number }
// `changed` = total number of substitutions applied. If > 0, the
// caller should re-run the audit to confirm the remaining violations
// (if any) are trope-level, not em-dash / British-spelling.

import { BRITISH_SPELLING_PATTERNS } from './styleGuard'

const EM_DASH   = '—'
const EN_DASH   = '–'

export function applyDeterministicStyleFixes(text: string): { text: string; changed: number } {
  if (typeof text !== 'string' || text.length === 0) return { text: text ?? '', changed: 0 }
  let out = text
  let changed = 0

  // 1. Em dash → ", " (comma + space). Grammatically neutral in
  //    almost every case an editor would write. If the em dash was
  //    doing sentence-break duty ("thing — Yes."), the resulting
  //    comma is still readable and the human editor can polish.
  out = out.replace(/\s*—\s*/g, () => { changed += 1; return ', ' })

  // 2. En dash between numbers is fine ("2020–2024") but a stray
  //    en dash in prose becomes ", ".
  out = out.replace(/(\D)–(\D)/g, (_m, a, b) => { changed += 1; return `${a}, ${b}` })

  // 3. British spellings → American forms, whole-word, case-preserving.
  for (const { british, american } of BRITISH_SPELLING_PATTERNS) {
    const re = new RegExp(`\\b(${escapeRegex(british)})\\b`, 'gi')
    out = out.replace(re, (match) => {
      changed += 1
      return matchCase(match, american)
    })
  }

  // 4. Whitespace cleanup: double spaces → single; space-before-
  //    punctuation removed.
  out = out.replace(/[ \t]{2,}/g, ' ')
  out = out.replace(/ +([,.;:!?])/g, '$1')
  // Post-em-dash normalisation may leave ". ." at sentence joins.
  out = out.replace(/\.\s*\.(?!\s*\.)/g, '.')
  return { text: out, changed }
}

function matchCase(source: string, target: string): string {
  if (source === source.toUpperCase()) return target.toUpperCase()
  if (source[0] === source[0]?.toUpperCase()) return target[0].toUpperCase() + target.slice(1)
  return target
}
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Convenience: run the deterministic fixes over every string field
 *  of a WriterDraft in place (returns a new object). Only fields that
 *  render to the reader are touched; ids / slugs / URLs pass through. */
export function applyStyleFixesToDraft<T extends {
  headline: string; intro: string; seoTitle: string; seoDescription: string;
  sections: Array<{ heading?: string; paragraphs: string[] }>;
  conclusion?: string;
}>(draft: T): { draft: T; changed: number } {
  let changed = 0
  const fix = (s: string) => { const r = applyDeterministicStyleFixes(s); changed += r.changed; return r.text }
  const next = { ...draft }
  next.headline       = fix(draft.headline)
  next.intro          = fix(draft.intro)
  next.seoTitle       = fix(draft.seoTitle)
  next.seoDescription = fix(draft.seoDescription)
  next.sections = draft.sections.map(s => ({
    ...s,
    heading: s.heading ? fix(s.heading) : s.heading,
    paragraphs: (s.paragraphs || []).map(fix),
  }))
  if (draft.conclusion) next.conclusion = fix(draft.conclusion)
  return { draft: next, changed }
}
