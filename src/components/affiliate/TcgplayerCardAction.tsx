'use client'

// src/components/affiliate/TcgplayerCardAction.tsx
// CN-05 Sprint 4 — TCGplayer buying CTA alongside EbayCardPrimaryAction.
//
// Contract:
//   * Impact deep-link via partner.tcgplayer.com/k4EaNV?u=<dest>
//     (verified end-to-end in Sprint 4).
//   * No stored TCGplayer product IDs on this repo's `cards` table
//     today, so the destination is a TCGplayer per-game search URL
//     and the label is "Find this card on TCGplayer" — honest about
//     search vs exact-product per the Sprint 4 brief.
//   * GA4 `affiliate_click` emitted via the central trackEvent helper
//     with marketplace='tcgplayer', mirroring the eBay call shape so
//     dashboards can filter cleanly on merchant.
//   * Returns null for sealed products or when card name is empty,
//     mirroring EbayCardPrimaryAction.
//   * data-affiliate="1" on the anchor so any future shared beacon
//     can intercept the click. No server beacon is wired for
//     TCGplayer in this sprint (no Supabase write per click, per
//     the Sprint 3 directive).
//   * No external scripts, pure anchor + inline style, same
//     dimensions as EbayCardPrimaryAction to avoid layout shift.
//     Outline-only styling to distinguish from the primary eBay
//     fill while remaining visually balanced.

import { useEffect, useRef } from 'react'
import { trackEvent } from '@/lib/analytics'
import { buildTcgplayerLink } from '@/lib/tcgplayerAffiliate'

export type TcgplayerCardActionProps = {
  cardName:   string
  cardNumber?: string | null
  cardSlug?:  string | null
  setSlug?:   string | null
  isSealed?:  boolean
}

// PokePrices stores modifiers inside card_name like "Blastoise #E9" or
// "Pikachu [Rainbow Foil]". These confuse TCGplayer's search. Strip
// them to a clean species/product name; pass the number separately
// if we have it. Memory: feedback_pokeprices_cardname_modifiers.
function cleanCardName(raw: string): string {
  return raw
    .replace(/\s*#\d+[A-Za-z]*\b/g, '')
    .replace(/\s*\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function TcgplayerCardAction(props: TcgplayerCardActionProps) {
  const containerRef = useRef<HTMLAnchorElement>(null)
  const firedRef = useRef(false)

  const trimmedName = (props.cardName ?? '').trim()
  const shouldRender = !props.isSealed && trimmedName.length > 0

  const cleanName = cleanCardName(trimmedName)
  const number = (props.cardNumber ?? '').toString().trim()
  // Keep the card_number as a separate query token when present so the
  // TCGplayer search can narrow by printing without the "#" prefix
  // confusing their tokenizer.
  const query = number ? `${cleanName} ${number}` : cleanName

  const link = shouldRender
    ? buildTcgplayerLink({
        cardName: query,
        game: 'pokemon',
        subid: `pp:card_primary:${(props.cardSlug ?? 'unknown').toString().slice(0, 50)}`,
      })
    : null

  useEffect(() => {
    if (!shouldRender || !link) return
    if (firedRef.current) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !firedRef.current) {
          firedRef.current = true
          trackEvent('affiliate_link_view', {
            marketplace: 'tcgplayer',
            placement: 'card_primary_tcgplayer',
            intent: link.isExact ? 'exact_listing' : 'other',
            card_slug: props.cardSlug ?? undefined,
            set_slug: props.setSlug ?? undefined,
            source_component: 'tcgplayer_card_action',
          })
          io.disconnect()
          break
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [shouldRender, link, props.cardSlug, props.setSlug])

  if (!shouldRender || !link) return null

  function onClick() {
    if (!link) return
    trackEvent('affiliate_click', {
      marketplace: 'tcgplayer',
      placement: 'card_primary_tcgplayer',
      intent: link.isExact ? 'exact_listing' : 'other',
      card_slug: props.cardSlug ?? undefined,
      set_slug: props.setSlug ?? undefined,
      source_component: 'tcgplayer_card_action',
    })
  }

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <a
        ref={containerRef}
        href={link.href}
        target="_blank"
        rel="sponsored nofollow noopener noreferrer"
        onClick={onClick}
        data-affiliate="1"
        data-placement="card_primary_tcgplayer"
        data-component="TcgplayerCardAction"
        data-page-type="card"
        data-card-slug={props.cardSlug ?? undefined}
        data-set-slug={props.setSlug ?? undefined}
        data-intent={link.isExact ? 'exact' : 'search'}
        aria-label={`${link.label}, opens in a new tab`}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            8,
          padding:        '10px 18px',
          fontSize:       13,
          fontWeight:     800,
          color:          'var(--primary)',
          background:     'transparent',
          border:         '1px solid var(--primary)',
          borderRadius:   999,
          textDecoration: 'none',
          whiteSpace:     'nowrap',
          fontFamily:     "'Figtree', sans-serif",
        }}
      >
        <span aria-hidden="true">🏷️</span>
        {link.label}
      </a>
    </div>
  )
}
