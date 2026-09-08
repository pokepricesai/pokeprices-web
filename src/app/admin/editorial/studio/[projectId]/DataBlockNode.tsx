'use client'
// src/app/admin/editorial/studio/[projectId]/DataBlockNode.tsx
//
// EIC Block 8 — TipTap node extension + React NodeView for data
// blocks inside Article Studio. Renders the same DataBlockRenderer
// the public article uses, wrapped in a small chrome bar so the
// editor can delete / duplicate / see the snapshot badge.

import React from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { DataBlockRenderer } from '@/components/insights/DataBlockRenderer'
import type { DataBlockVariant } from '@/lib/studio/dataBlocks/types'
import { DATA_BLOCK_REGISTRY } from '@/lib/studio/dataBlocks/registry'

/**
 * Custom TipTap block node that persists a data-block payload
 * directly in the doc tree. The adapter (src/lib/studio/adapter.ts)
 * already recognises this node type and passes it through to
 * insights body_json unchanged.
 */
export const DataBlockNode = Node.create({
  name: 'dataBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      variant: {
        default: 'stat_callout',
        parseHTML: el => el.getAttribute('data-variant') ?? 'stat_callout',
        renderHTML: attrs => ({ 'data-variant': attrs.variant }),
      },
      payload: {
        default: {},
        parseHTML: el => {
          try { return JSON.parse(el.getAttribute('data-payload') ?? '{}') } catch { return {} }
        },
        renderHTML: attrs => ({ 'data-payload': JSON.stringify(attrs.payload ?? {}) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-tiptap-node="dataBlock"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-tiptap-node': 'dataBlock' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataBlockNodeView, { className: 'pp-datablock-node' })
  },
})

function DataBlockNodeView(props: NodeViewProps) {
  const variant = String(props.node.attrs.variant ?? '') as DataBlockVariant
  const payload = props.node.attrs.payload
  const registryEntry = DATA_BLOCK_REGISTRY[variant]
  const mode = (payload && typeof payload === 'object' ? (payload as any).mode : null) ?? 'snapshot'

  const badge = mode === 'live' ? 'LIVE' : 'SNAPSHOT'
  const asOf  = payload && typeof payload === 'object' ? ((payload as any).provenance?.asOf ?? (payload as any).asOf ?? (payload as any).snapshot?.asOf ?? null) : null

  return (
    <NodeViewWrapper as="div" style={styles.wrap} contentEditable={false}>
      <div style={styles.chrome}>
        <div style={styles.label}>
          {registryEntry?.label ?? variant} <span style={mode === 'live' ? styles.badgeLive : styles.badgeSnap}>{badge}</span>
          {asOf && <span style={styles.asOf}> · as of {asOf}</span>}
        </div>
        <div style={styles.controls}>
          <button style={styles.btn} onClick={() => props.deleteNode()} title="Delete this block">Delete</button>
        </div>
      </div>
      <div style={styles.rendered}>
        <DataBlockRenderer variant={variant} payload={payload} />
      </div>
    </NodeViewWrapper>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap:    { margin: '10px 0', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white' },
  chrome:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontFamily: "'Figtree', sans-serif", fontSize: 11, color: '#64748b' },
  label:   { fontWeight: 700, letterSpacing: 0.4 },
  asOf:    { fontWeight: 400, marginLeft: 6 },
  badgeSnap:{ display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 10, background: '#e0f2fe', color: '#0369a1', fontSize: 9, fontWeight: 800 },
  badgeLive:{ display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 10, background: '#dcfce7', color: '#166534', fontSize: 9, fontWeight: 800 },
  controls:{ display: 'flex', gap: 4 },
  btn:     { border: 'none', background: 'transparent', color: '#dc2626', fontSize: 11, cursor: 'pointer', fontFamily: "'Figtree', sans-serif" },
  rendered:{ padding: 12 },
}
