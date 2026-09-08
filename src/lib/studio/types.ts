// src/lib/studio/types.ts
//
// EIC Block 7 — Article Studio document shape.
//
// The Studio saves ONE current draft per editorial project into
// `editorial_projects.studio_json`. This module owns the canonical
// TypeScript type. It is intentionally NOT the same shape as
// `insights.body_json`: the Studio format is an editor internal
// format (TipTap doc + settings); the public renderer format is
// `{blocks: []}`. The Studio → insight adapter bridges the two
// (see `src/lib/studio/adapter.ts`).

/** Anchor for future migrations. Bump when the doc shape changes. */
export const STUDIO_DOCUMENT_VERSION = 1

export type StudioHeroImage = {
  url:      string
  alt:      string
  caption?: string
}

export type StudioSeo = {
  title:       string
  description: string
}

/**
 * A single-project Studio draft. Everything the editor UI needs to
 * persist. Purely JSON-safe.
 */
export type StudioDocument = {
  version:    typeof STUDIO_DOCUMENT_VERSION
  headline:   string
  intro:      string
  themeKey:   string    // e.g. 'grading', 'market' — matches insights.theme
  themeLabel: string    // display label, matches insights.theme_label
  authorName: string
  seo:        StudioSeo
  heroImage:  StudioHeroImage | null
  /**
   * The TipTap document tree ({ type: 'doc', content: [...] }).
   * Stored as unknown here so `types.ts` does not pull in the TipTap
   * package. The editor + adapter validate the shape at their
   * boundaries.
   */
  bodyDoc:    unknown
  updatedAt:  string    // ISO datetime the draft was last saved
}

export function emptyStudioDocument(seed: {
  headline?: string
  intro?:    string
  themeKey?: string
} = {}): StudioDocument {
  return {
    version:    STUDIO_DOCUMENT_VERSION,
    headline:   seed.headline ?? '',
    intro:      seed.intro    ?? '',
    themeKey:   seed.themeKey ?? 'market',
    themeLabel: '',
    authorName: '',
    seo:        { title: '', description: '' },
    heroImage:  null,
    bodyDoc:    { type: 'doc', content: [{ type: 'paragraph' }] },
    updatedAt:  new Date().toISOString(),
  }
}
