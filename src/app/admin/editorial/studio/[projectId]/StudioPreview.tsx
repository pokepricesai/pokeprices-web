'use client'
// src/app/admin/editorial/studio/[projectId]/StudioPreview.tsx
//
// EIC Block 7 — approximate public rendering for the Studio preview.
// Deliberately mirrors the styles used by the real Insights article
// client, minus the schema/breadcrumb integrations that are only
// meaningful on the live page.

import React from 'react'
import type { StudioDocument } from '@/lib/studio/types'
import type { InsightBody, ExtendedParagraphSegment } from '@/lib/studio/adapter'

export function StudioPreview({ doc, body }: { doc: StudioDocument; body: InsightBody }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 24px 40px' }}>
      {doc.heroImage?.url && (
        <figure style={{ margin: 0 }}>
          <img src={doc.heroImage.url} alt={doc.heroImage.alt} style={{ width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 12 }} />
          {doc.heroImage.caption && <figcaption style={{ fontSize: 12, color: '#64748b', marginTop: 8, textAlign: 'center' as any }}>{doc.heroImage.caption}</figcaption>}
        </figure>
      )}

      <div style={{ marginTop: 24, marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' as any, color: '#64748b', marginBottom: 8 }}>
          {doc.themeLabel || doc.themeKey || 'Uncategorised'}
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 12px', color: '#0f172a', lineHeight: 1.2 }}>
          {doc.headline || <em style={{ color: '#94a3b8' }}>Headline goes here</em>}
        </h1>
        <p style={{ fontSize: 16, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
          {doc.intro || <em style={{ color: '#94a3b8' }}>Intro goes here</em>}
        </p>
      </div>

      <div>
        {body.blocks.length === 0 ? (
          <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>Body is empty.</p>
        ) : (
          body.blocks.map((b, i) => <PreviewBlock key={i} block={b} />)
        )}
      </div>
    </div>
  )
}

function PreviewBlock({ block }: { block: any }) {
  if (block.type === 'heading') {
    if (block.level === 3) {
      return <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, fontWeight: 800, color: '#0f172a', margin: '24px 0 10px', lineHeight: 1.3 }}>{block.text}</h3>
    }
    return <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '32px 0 12px', lineHeight: 1.3 }}>{block.text}</h2>
  }
  if (block.type === 'paragraph') {
    return (
      <p style={{ fontSize: 15, lineHeight: 1.8, color: '#0f172a', margin: '0 0 20px' }}>
        <Segments segs={block.content ?? []} />
      </p>
    )
  }
  if (block.type === 'list') {
    const items = block.items as Array<ExtendedParagraphSegment[]>
    return React.createElement(block.ordered ? 'ol' : 'ul',
      { style: { fontSize: 15, lineHeight: 1.8, color: '#0f172a', margin: '0 0 20px 20px' } as any },
      items.map((segs, i) => <li key={i} style={{ marginBottom: 4 }}><Segments segs={segs} /></li>),
    )
  }
  if (block.type === 'quote') {
    return (
      <blockquote style={{ margin: '20px 0 24px', padding: '12px 18px', borderLeft: '3px solid #0369a1', color: '#64748b', fontStyle: 'italic', fontSize: 15, lineHeight: 1.7 }}>
        <Segments segs={block.content ?? []} />
      </blockquote>
    )
  }
  if (block.type === 'hr') {
    return <hr style={{ border: 0, borderTop: '1px solid #e2e8f0', margin: '28px 0' }} />
  }
  if (block.type === 'image') {
    return (
      <figure style={{ margin: '20px 0 28px' }}>
        <img src={block.src} alt={block.alt ?? ''} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12 }} />
        {block.caption && <figcaption style={{ fontSize: 12, color: '#64748b', marginTop: 8, textAlign: 'center' as any }}>{block.caption}</figcaption>}
      </figure>
    )
  }
  if (block.type === 'data_block') {
    return <div style={{ margin: '20px 0 24px', padding: '10px 14px', background: '#f1f5f9', border: '1px dashed #cbd5e1', borderRadius: 8, fontSize: 12, color: '#64748b' }}>[{block.variant}] — data block placeholder (Block 8)</div>
  }
  return null
}

function Segments({ segs }: { segs: ExtendedParagraphSegment[] }) {
  return (
    <>
      {segs.map((s, i) => {
        let node: React.ReactNode = s.text
        if (s.italic) node = <em>{node}</em>
        if (s.bold)   node = <strong>{node}</strong>
        if (s.href) {
          const isInternal = s.href.startsWith('/') || s.href.includes('www.pokeprices.io')
          return (
            <a key={i} href={s.href} target={isInternal ? undefined : '_blank'} rel={isInternal ? undefined : 'noopener noreferrer'} style={{ color: '#0369a1', textDecoration: 'underline', fontWeight: 600 }}>
              {node}
            </a>
          )
        }
        return <React.Fragment key={i}>{node}</React.Fragment>
      })}
    </>
  )
}
