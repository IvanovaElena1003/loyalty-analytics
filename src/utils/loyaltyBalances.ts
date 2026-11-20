import type { RawRow } from '../types'
import type { AgentFilters } from './agentNetwork'
import { enrichRawRows, filterEnrichedRows } from './agentNetwork'
import { isExcludedLoyaltyRole } from './partnerWallet'

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

/** Дата первого события по механике в текущей выборке (после фильтров агентов, без фильтра месяца). */
export interface MechanicStartDates {
  accOsago: Date | null
  accKasko: Date | null
  spendCrossDiscount: Date | null
  spendCrossKv: Date | null
  spendKasko: Date | null
  spendOsagoSlider: Date | null
}

/** Дата запуска ползунка ОСАГО пролонгация (продуктовая). */
export const OSAGO_SLIDER_LAUNCH = new Date('2026-06-08T12:00:00')

export type MechanicKey =
  | 'accOsago'
  | 'accKasko'
  | 'spendCrossDiscount'
  | 'spendCrossKv'
  | 'spendKasko'
  | 'spendOsagoSlider'

export const MECHANIC_LABELS: Record<MechanicKey, string> = {
  accOsago: 'Начисление ОСАГО ФЛ',
  accKasko: 'Начисление КАСКО ФЛ',
  spendCrossDiscount: 'Списание в Скидку СП по Кросс Каско от бесполисных',
  spendCrossKv: 'Списание в повышенное КВ по Кросс Каско от бесполисных',
  spendKasko: 'Списание в КАСКО ФЛ',
  spendOsagoSlider: 'Списание в ОСАГО Пролонгация',
}

export const ACCRUAL_MECHANICS: MechanicKey[] = ['accOsago', 'accKasko']
export const SPEND_MECHANICS: MechanicKey[] = [
  'spendCrossDiscount',
  'spendCrossKv',
  'spendKasko',
  'spendOsagoSlider',
]

export type MechanicToggle = Record<MechanicKey, boolean>

export const ALL_MECHANICS_ON: MechanicToggle = {
  accOsago: true,
  accKasko: true,
  spendCrossDiscount: true,
  spendCrossKv: true,
  spendKasko: true,
  spendOsagoSlider: true,
}

export interface Top3RegionRow extends LoyaltyBalanceByRegion {
  rollup?: 'moscow' | 'spb' | 'regions'
  children?: LoyaltyBalanceByRegion[]
}

function isNull(v: unknown): boolean {
  return v == null || v === '[NULL]' || v === ''
}

function toNum(v: unknown): number {
  if (isNull(v)) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function parseDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === 'number' && value > 0) return new Date((value - 25569) * 86400000)
  if (typeof value === 'string') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function monthKeyFrom(value: unknown): string | null {
  const d = parseDate(value)
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function touchMin(current: Date | null, dt: Date | null): Date | null {
  if (!dt) return current
  if (!current || dt < current) return dt
  return current
}

function emptyStarts(): MechanicStartDates {
  return {
    accOsago: null,
    accKasko: null,
    spendCrossDiscount: null,
    spendCrossKv: null,
    spendKasko: null,
    spendOsagoSlider: null,
  }
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

function passYear(row: RawRow, yearKey: number | null): boolean {
  if (yearKey == null) return true
  const d = parseDate(row.CreateDate)
  return d != null && d.getFullYear() === yearKey
}

function passYearQuote(q: SliderQuoteRow, yearKey: number | null): boolean {
  if (yearKey == null) return true
  const d = parseDate(q.CreateDate)
  return d != null && d.getFullYear() === yearKey
}

function applyMechanicMask(b: LoyaltyBalanceTotals, mechanics: MechanicToggle): LoyaltyBalanceTotals {
  const out = { ...b }
  if (!mechanics.accOsago) out.accOsago = 0
  if (!mechanics.accKasko) out.accKasko = 0
  if (!mechanics.spendCrossDiscount) out.spendCrossDiscount = 0
  if (!mechanics.spendCrossKv) out.spendCrossKv = 0
  if (!mechanics.spendKasko) out.spendKasko = 0
  if (!mechanics.spendOsagoSlider) out.spendOsagoSlider = 0
  return finalize(out)
}

function isMoscow(region: string): boolean {
  const n = region.toLowerCase()
  return n === 'москва' || n.includes('москв')
}

function isSpb(region: string): boolean {
  const n = region.toLowerCase()
  return n.includes('петербург') || n.includes('санкт-петербург')
}

/** Москва, Санкт-Петербург, Регионы (остальные филиалы — в children). */
export function rollupRegionsTop3(byRegion: LoyaltyBalanceByRegion[]): Top3RegionRow[] {
  const moscow = emptyBucket()
  const spb = emptyBucket()
  const reg = emptyBucket()
  const children: LoyaltyBalanceByRegion[] = []

  for (const r of byRegion) {
    if (isMoscow(r.region)) {
      addTo(moscow, r)
    } else if (isSpb(r.region)) {
      addTo(spb, r)
    } else {
      children.push(r)
      addTo(reg, r)
    }
  }

  const mF = finalize(moscow)
  const sF = finalize(spb)
  const rF = finalize(reg)

  const rows: Top3RegionRow[] = []
  if (mF.accTotal > 0 || mF.spendTotal > 0) {
    rows.push({ region: 'Москва', rollup: 'moscow', ...mF })
  }
  if (sF.accTotal > 0 || sF.spendTotal > 0) {
    rows.push({ region: 'Санкт-Петербург', rollup: 'spb', ...sF })
  }
  if (children.length > 0) {
    rows.push({
      region: 'Регионы',
      rollup: 'regions',
      children: children.sort((a, b) => b.spendTotal - a.spendTotal),
      ...rF,
    })
  }
  return rows
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
  yearKey: number | null = null,
  mechanics: MechanicToggle = ALL_MECHANICS_ON,
): { totals: LoyaltyBalanceTotals; byRegion: LoyaltyBalanceByRegion[] } {
  const byRegion = new Map<string, LoyaltyBalanceTotals>()
  const total = emptyBucket()

  const bump = (region: string, part: Partial<LoyaltyBalanceTotals>) => {
    if (!byRegion.has(region)) byRegion.set(region, emptyBucket())
    addTo(byRegion.get(region)!, part)
    addTo(total, part)
  }

  for (const row of osagoRows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
    const state = String(row.State ?? '')
    if (EXCLUDED.has(state)) continue
    if (!rowPassesAgentFilters(row, filters)) continue
    if (!passMonth(row, monthKey)) continue
    if (!passYear(row, yearKey)) continue
    if (state !== ISSUED) continue

    const region = normRegion(row)
    const lp = toNum(row.LoyaltyPointsInLK)
    if (mechanics.accOsago && !isNull(row.LoyaltyPointsInLK) && lp > 0) {
      bump(region, { accOsago: lp })
    }

    if (String(row.CrossIsBought ?? '') === 'Да') {
      const pp = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
      const fp = toNum(row.FinalPrice)
      const kv = toNum(row.ChargedToIncreasedKV)
      if (!isNull(row.FinalPrice) && fp !== pp) {
        const disc = pp - fp
        if (disc > 0 && mechanics.spendCrossDiscount) bump(region, { spendCrossDiscount: disc })
      }
      if (!isNull(row.ChargedToIncreasedKV) && kv !== 0) {
        if (mechanics.spendCrossKv) bump(region, { spendCrossKv: Math.abs(kv) })
      }
    }
  }

  for (const row of kaskoRows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
    const state = String(row.State ?? '')
    if (EXCLUDED.has(state)) continue
    if (!rowPassesAgentFilters(row, filters)) continue
    if (!passMonth(row, monthKey)) continue
    if (!passYear(row, yearKey)) continue
    if (state !== ISSUED) continue

    const region = normRegion(row)
    const lpo = toNum(row.LoyaltyPointsOut)
    const ov = toNum(row.OriginalValue)
    if (mechanics.accKasko && lpo > 0 && ov > 0) bump(region, { accKasko: ov * lpo })

    const spend = toNum(row.WalletBonuses) + toNum(row.ScoringBonuses)
    if (mechanics.spendKasko && spend > 0) bump(region, { spendKasko: spend })
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
    if (!passYearQuote(q, yearKey)) continue
    const spend = toNum(q.spend)
    if (spend <= 0 || !mechanics.spendOsagoSlider) continue

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

  const maskedTotal = applyMechanicMask(total, mechanics)

  const regions: LoyaltyBalanceByRegion[] = Array.from(byRegion.entries())
    .map(([region, b]) => ({ region, ...applyMechanicMask(b, mechanics) }))
    .filter(r => r.accTotal > 0 || r.spendTotal > 0)
    .sort((a, b) => b.spendTotal - a.spendTotal || b.accTotal - a.accTotal)

  return { totals: maskedTotal, byRegion: regions }
}

export const fmtRub = (v: number) =>
  `${Math.round(v).toLocaleString('ru-RU')} ₽`

export const fmtPct = (v: number | null) =>
  v == null ? '—' : `${v.toFixed(1).replace('.', ',')}%`

export const fmtDateRu = (d: Date | null) =>
  d == null
    ? '—'
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

/** Первые даты по механикам (фильтр агентов да, месяц — нет). */
export function computeMechanicStarts(
  osagoRows: RawRow[],
  kaskoRows: RawRow[],
  _sliderQuotes: SliderQuoteRow[],
  filters: AgentFilters,
  _agentRows?: RawRow[],
): MechanicStartDates {
  const starts = emptyStarts()

  for (const row of osagoRows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
    const state = String(row.State ?? '')
    if (EXCLUDED.has(state)) continue
    if (!rowPassesAgentFilters(row, filters)) continue
    if (state !== ISSUED) continue
    const dt = parseDate(row.CreateDate)

    const lp = toNum(row.LoyaltyPointsInLK)
    if (!isNull(row.LoyaltyPointsInLK) && lp > 0) {
      starts.accOsago = touchMin(starts.accOsago, dt)
    }

    if (String(row.CrossIsBought ?? '') === 'Да') {
      const pp = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
      const fp = toNum(row.FinalPrice)
      const kv = toNum(row.ChargedToIncreasedKV)
      if (!isNull(row.FinalPrice) && fp !== pp) {
        const disc = pp - fp
        if (disc > 0) starts.spendCrossDiscount = touchMin(starts.spendCrossDiscount, dt)
      }
      if (!isNull(row.ChargedToIncreasedKV) && kv !== 0) {
        starts.spendCrossKv = touchMin(starts.spendCrossKv, dt)
      }
    }
  }

  for (const row of kaskoRows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
    const state = String(row.State ?? '')
    if (EXCLUDED.has(state)) continue
    if (!rowPassesAgentFilters(row, filters)) continue
    if (state !== ISSUED) continue
    const dt = parseDate(row.CreateDate)

    const lpo = toNum(row.LoyaltyPointsOut)
    const ov = toNum(row.OriginalValue)
    if (lpo > 0 && ov > 0) starts.accKasko = touchMin(starts.accKasko, dt)

    const spend = toNum(row.WalletBonuses) + toNum(row.ScoringBonuses)
    if (spend > 0) starts.spendKasko = touchMin(starts.spendKasko, dt)
  }

  starts.spendOsagoSlider = OSAGO_SLIDER_LAUNCH

  return starts
}