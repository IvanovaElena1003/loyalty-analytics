import type { RawRow } from '../types'
import type { AgentFilters } from './agentNetwork'
import { enrichRawRows, filterEnrichedRows } from './agentNetwork'

const EXCLUDED = new Set(['PolicyAnnulled', 'PolicyTerminated'])
const BASE_PRICE = 2490
const ISSUED = 'PolicyIssued'
const NO_REGION = 'Без филиала'

export interface SliderQuoteRow {
  PolicyNumber?: unknown
  CreateDate?: unknown
  spend?: unknown
  CashbookId?: unknown
}

export interface LoyaltyBalanceTotals {
  accOsago: number
  accKasko: number
  spendCrossDiscount: number
  spendCrossKv: number
  spendKasko: number
  spendOsagoSlider: number
  accTotal: number
  spendTotal: number
  utilPct: number | null
}

export interface LoyaltyBalanceByRegion extends LoyaltyBalanceTotals {
  region: string
}

function isNull(v: unknown): boolean {
  return v == null || v === '[NULL]' || v === ''
}

function toNum(v: unknown): number {
  if (isNull(v)) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function monthKeyFrom(value: unknown): string | null {
  let d: Date | null = null
  if (value instanceof Date) d = isNaN(value.getTime()) ? null : value
  else if (typeof value === 'number' && value > 0) d = new Date((value - 25569) * 86400000)
  else if (typeof value === 'string') {
    const x = new Date(value)
    d = isNaN(x.getTime()) ? null : x
  }
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function normRegion(row: RawRow): string {
  const f = String(row['ФИЛИАЛ'] ?? '').trim()
  return f || NO_REGION
}

function emptyBucket(): LoyaltyBalanceTotals {
  return {
    accOsago: 0,
    accKasko: 0,
    spendCrossDiscount: 0,
    spendCrossKv: 0,
    spendKasko: 0,
    spendOsagoSlider: 0,
    accTotal: 0,
    spendTotal: 0,
    utilPct: null,
  }
}

function finalize(b: LoyaltyBalanceTotals): LoyaltyBalanceTotals {
  b.accTotal = b.accOsago + b.accKasko
  b.spendTotal =
    b.spendCrossDiscount + b.spendCrossKv + b.spendKasko + b.spendOsagoSlider
  b.utilPct = b.accTotal > 0 ? (b.spendTotal / b.accTotal) * 100 : null
  return b
}

function addTo(a: LoyaltyBalanceTotals, b: Partial<LoyaltyBalanceTotals>) {
  a.accOsago += b.accOsago ?? 0
  a.accKasko += b.accKasko ?? 0
  a.spendCrossDiscount += b.spendCrossDiscount ?? 0
  a.spendCrossKv += b.spendCrossKv ?? 0
  a.spendKasko += b.spendKasko ?? 0
  a.spendOsagoSlider += b.spendOsagoSlider ?? 0
}

function passMonth(row: RawRow, monthKey: string | null): boolean {
  if (!monthKey) return true
  return monthKeyFrom(row.CreateDate) === monthKey
}

function rowPassesAgentFilters(row: RawRow, filters: AgentFilters): boolean {
  const active = Object.values(filters).some(v => v.length > 0)
  if (!active) return true
  return filterEnrichedRows([row], filters).length > 0
}

function synthAgentRow(cb: string, template?: RawRow): RawRow {
  if (template) return template
  return { CashbookId: cb } as unknown as RawRow
}

/** Начисления и списания ОСАГО + КАСКО + ползунок; разрез по филиалам; те же фильтры, что на «Распределении». */
export function computeLoyaltyBalances(
  osagoRows: RawRow[],
  kaskoRows: RawRow[],
  sliderQuotes: SliderQuoteRow[],
  filters: AgentFilters,
  monthKey: string | null,
  agentRows?: RawRow[],
): { totals: LoyaltyBalanceTotals; byRegion: LoyaltyBalanceByRegion[] } {
  const byRegion = new Map<string, LoyaltyBalanceTotals>()
  const total = emptyBucket()

  const bump = (region: string, part: Partial<LoyaltyBalanceTotals>) => {
    if (!byRegion.has(region)) byRegion.set(region, emptyBucket())
    addTo(byRegion.get(region)!, part)
    addTo(total, part)
  }

  for (const row of osagoRows) {
    const state = String(row.State ?? '')
    if (EXCLUDED.has(state)) continue
    if (!rowPassesAgentFilters(row, filters)) continue
    if (!passMonth(row, monthKey)) continue
    if (state !== ISSUED) continue

    const region = normRegion(row)
    const lp = toNum(row.LoyaltyPointsInLK)
    if (!isNull(row.LoyaltyPointsInLK) && lp > 0) {
      bump(region, { accOsago: lp })
    }

    if (String(row.CrossIsBought ?? '') === 'Да') {
      const pp = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
      const fp = toNum(row.FinalPrice)
      const kv = toNum(row.ChargedToIncreasedKV)
      if (!isNull(row.FinalPrice) && fp !== pp) {
        const disc = pp - fp
        if (disc > 0) bump(region, { spendCrossDiscount: disc })
      }
      if (!isNull(row.ChargedToIncreasedKV) && kv !== 0) {
        bump(region, { spendCrossKv: Math.abs(kv) })
      }
    }
  }

  for (const row of kaskoRows) {
    if (String(row.Role ?? '') === 'Seller') continue
    const state = String(row.State ?? '')
    if (EXCLUDED.has(state)) continue
    if (!rowPassesAgentFilters(row, filters)) continue
    if (!passMonth(row, monthKey)) continue
    if (state !== ISSUED) continue

    const region = normRegion(row)
    const lpo = toNum(row.LoyaltyPointsOut)
    const ov = toNum(row.OriginalValue)
    if (lpo > 0 && ov > 0) bump(region, { accKasko: ov * lpo })

    const spend = toNum(row.WalletBonuses) + toNum(row.ScoringBonuses)
    if (spend > 0) bump(region, { spendKasko: spend })
  }

  const cbTemplate = new Map<string, RawRow>()
  for (const row of osagoRows) {
    const cb = String(row.CashbookId ?? '').trim()
    if (cb && !cbTemplate.has(cb)) cbTemplate.set(cb, row)
  }
  for (const row of kaskoRows) {
    const cb = String(row.CashbookId ?? '').trim()
    if (cb && !cbTemplate.has(cb)) cbTemplate.set(cb, row)
  }

  for (const q of sliderQuotes) {
    if (monthKey) {
      const mk = monthKeyFrom(q.CreateDate)
      if (mk !== monthKey) continue
    }
    const spend = toNum(q.spend)
    if (spend <= 0) continue

    const cb = String(q.CashbookId ?? '').trim()
    const template = cb ? cbTemplate.get(cb) : undefined
    const agentRow = template
      ?? (cb && agentRows
        ? enrichRawRows([{ CashbookId: cb, HeadPartnerCB: cb } as unknown as RawRow], agentRows)[0]
        : synthAgentRow(cb))
    if (!rowPassesAgentFilters(agentRow, filters)) continue

    const region = normRegion(agentRow)
    bump(region, { spendOsagoSlider: spend })
  }

  finalize(total)

  const regions: LoyaltyBalanceByRegion[] = Array.from(byRegion.entries())
    .map(([region, b]) => ({ region, ...finalize({ ...b }) }))
    .filter(r => r.accTotal > 0 || r.spendTotal > 0)
    .sort((a, b) => b.spendTotal - a.spendTotal || b.accTotal - a.accTotal)

  return { totals: total, byRegion: regions }
}

export const fmtRub = (v: number) =>
  `${Math.round(v).toLocaleString('ru-RU')} ₽`

export const fmtPct = (v: number | null) =>
  v == null ? '—' : `${v.toFixed(1).replace('.', ',')}%`