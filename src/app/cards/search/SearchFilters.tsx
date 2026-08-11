'use client'
// Block 5A-W-56A — Deep Card Search filter panel. Groups filters into
// logical sections (Card, Price, Movement, Date, Advanced). Prices
// are entered in GBP but stored in USD cents (via poundsToUsdCents)
// so the RPC gets the DB-native unit.

import { useState } from 'react'
import {
  poundsToUsdCents,
  usdCentsToPounds,
  type DeepCardSearchFilters,
  type Language,
} from '@/lib/deepSearch/filters'

interface Props {
  filters:     DeepCardSearchFilters
  onChange:    (patch: Partial<DeepCardSearchFilters>) => void
  onClearAll:  () => void
}

export default function SearchFilters({ filters, onChange, onClearAll }: Props) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '18px 18px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14,
      }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, margin: 0, color: 'var(--text)' }}>
          Filters
        </h2>
        <button onClick={onClearAll} style={clearBtn}>Clear</button>
      </div>

      <FilterGroup title="Card">
        <TextInput
          label="Pokémon (slug)"
          placeholder="pikachu"
          value={filters.pokemonSlug ?? ''}
          onChange={v => onChange({ pokemonSlug: v.trim().toLowerCase() || undefined })}
        />
        <TextInput
          label="Card name contains"
          placeholder="Charizard, Gold Star …"
          value={filters.cardName ?? ''}
          onChange={v => onChange({ cardName: v })}
        />
        <TextInput
          label="Set contains"
          placeholder="Base Set, Evolutions …"
          value={filters.setName ?? ''}
          onChange={v => onChange({ setName: v })}
        />
        <SelectRow<Language | ''>
          label="Language"
          value={(filters.language ?? '') as Language | ''}
          options={[
            { value: '',   label: 'All' },
            { value: 'en', label: 'English' },
            { value: 'jp', label: 'Japanese' },
          ]}
          onChange={v => onChange({ language: v === '' ? undefined : v })}
        />
      </FilterGroup>

      <FilterGroup title="Release year">
        <NumberRow
          label="From"
          placeholder="e.g. 1999"
          value={filters.releaseYearMin}
          onChange={v => onChange({ releaseYearMin: v })}
        />
        <NumberRow
          label="To"
          placeholder="e.g. 2009"
          value={filters.releaseYearMax}
          onChange={v => onChange({ releaseYearMax: v })}
        />
      </FilterGroup>

      <FilterGroup title="Price (£)">
        <PriceRow label="Raw"    min={filters.rawMin}    max={filters.rawMax}    onMin={v => onChange({ rawMin:   toCents(v) })} onMax={v => onChange({ rawMax:   toCents(v) })} />
        <PriceRow label="PSA 7"  min={filters.psa7Min}   max={filters.psa7Max}   onMin={v => onChange({ psa7Min:  toCents(v) })} onMax={v => onChange({ psa7Max:  toCents(v) })} />
        <PriceRow label="PSA 8"  min={filters.psa8Min}   max={filters.psa8Max}   onMin={v => onChange({ psa8Min:  toCents(v) })} onMax={v => onChange({ psa8Max:  toCents(v) })} />
        <PriceRow label="PSA 9"  min={filters.psa9Min}   max={filters.psa9Max}   onMin={v => onChange({ psa9Min:  toCents(v) })} onMax={v => onChange({ psa9Max:  toCents(v) })} />
        <PriceRow label="PSA 10" min={filters.psa10Min}  max={filters.psa10Max}  onMin={v => onChange({ psa10Min: toCents(v) })} onMax={v => onChange({ psa10Max: toCents(v) })} />
      </FilterGroup>

      <FilterGroup title="Price movement (%)">
        <PercentRow label="7 day"  min={filters.change7dMin}  max={filters.change7dMax}  onMin={v => onChange({ change7dMin:  v })} onMax={v => onChange({ change7dMax:  v })} />
        <PercentRow label="30 day" min={filters.change30dMin} max={filters.change30dMax} onMin={v => onChange({ change30dMin: v })} onMax={v => onChange({ change30dMax: v })} />
        <PercentRow label="90 day" min={filters.change90dMin} max={filters.change90dMax} onMin={v => onChange({ change90dMin: v })} onMax={v => onChange({ change90dMax: v })} />
      </FilterGroup>

      <FilterGroup title="Grading value" defaultOpen={false}>
        <NumberRow
          label="PSA 9 uplift (£) ≥"
          placeholder="e.g. 50"
          value={usdCentsToPounds(filters.psa9UpliftMin)}
          onChange={v => onChange({ psa9UpliftMin: toCents(v) })}
        />
        <NumberRow
          label="PSA 10 uplift (£) ≥"
          placeholder="e.g. 100"
          value={usdCentsToPounds(filters.psa10UpliftMin)}
          onChange={v => onChange({ psa10UpliftMin: toCents(v) })}
        />
        <NumberRow
          label="PSA 9 multiple ≥"
          placeholder="e.g. 4"
          value={filters.psa9MultipleMin}
          onChange={v => onChange({ psa9MultipleMin: v })}
        />
        <NumberRow
          label="PSA 10 multiple ≥"
          placeholder="e.g. 8"
          value={filters.psa10MultipleMin}
          onChange={v => onChange({ psa10MultipleMin: v })}
        />
        <p style={{
          fontSize: 11, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          margin: '8px 0 0', lineHeight: 1.5,
        }}>
          Discovery signals only. See the individual card page for the deterministic grading calculator.
        </p>
      </FilterGroup>
    </div>
  )
}

function toCents(gbp: number | undefined): number | undefined {
  return gbp == null ? undefined : poundsToUsdCents(gbp)
}

// ── Small primitives ──────────────────────────────────

function FilterGroup({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section style={{ marginBottom: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          all: 'unset', cursor: 'pointer',
          width: '100%',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 0', marginBottom: open ? 10 : 0,
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 1.4,
          textTransform: 'uppercase', color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
        }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
    </section>
  )
}

function TextInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label style={{ display: 'block', fontSize: 11, fontFamily: "'Figtree', sans-serif", color: 'var(--text-muted)' }}>
      <div style={{ marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  )
}

function NumberRow({ label, value, onChange, placeholder }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string
}) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <input
        type="number"
        placeholder={placeholder}
        value={value ?? ''}
        onChange={e => {
          const raw = e.target.value.trim()
          if (raw === '') return onChange(undefined)
          const n = Number(raw)
          onChange(Number.isFinite(n) ? n : undefined)
        }}
        style={{ ...inputStyle, width: 96 }}
      />
    </label>
  )
}

function PriceRow({ label, min, max, onMin, onMax }: {
  label: string
  min: number | undefined
  max: number | undefined
  onMin: (v: number | undefined) => void
  onMax: (v: number | undefined) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, fontFamily: "'Figtree', sans-serif", color: 'var(--text)', width: 60, flexShrink: 0 }}>{label}</span>
      <input
        type="number"
        placeholder="min"
        value={usdCentsToPounds(min) ?? ''}
        onChange={e => {
          const raw = e.target.value.trim()
          if (raw === '') return onMin(undefined)
          const n = Number(raw)
          onMin(Number.isFinite(n) ? n : undefined)
        }}
        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        aria-label={`${label} minimum`}
      />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</span>
      <input
        type="number"
        placeholder="max"
        value={usdCentsToPounds(max) ?? ''}
        onChange={e => {
          const raw = e.target.value.trim()
          if (raw === '') return onMax(undefined)
          const n = Number(raw)
          onMax(Number.isFinite(n) ? n : undefined)
        }}
        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        aria-label={`${label} maximum`}
      />
    </div>
  )
}

function PercentRow({ label, min, max, onMin, onMax }: {
  label: string
  min: number | undefined
  max: number | undefined
  onMin: (v: number | undefined) => void
  onMax: (v: number | undefined) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, fontFamily: "'Figtree', sans-serif", color: 'var(--text)', width: 60, flexShrink: 0 }}>{label}</span>
      <input
        type="number"
        placeholder="min %"
        value={min ?? ''}
        onChange={e => {
          const raw = e.target.value.trim()
          if (raw === '') return onMin(undefined)
          const n = Number(raw)
          onMin(Number.isFinite(n) ? n : undefined)
        }}
        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        aria-label={`${label} minimum %`}
      />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</span>
      <input
        type="number"
        placeholder="max %"
        value={max ?? ''}
        onChange={e => {
          const raw = e.target.value.trim()
          if (raw === '') return onMax(undefined)
          const n = Number(raw)
          onMax(Number.isFinite(n) ? n : undefined)
        }}
        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        aria-label={`${label} maximum %`}
      />
    </div>
  )
}

function SelectRow<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value as T)} style={{ ...inputStyle, width: 120, cursor: 'pointer' }}>
        {options.map(o => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
  outline: 'none', boxSizing: 'border-box', width: '100%',
}

const clearBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  background: 'none', border: 'none', cursor: 'pointer',
}
