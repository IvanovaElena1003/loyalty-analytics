import type { RawRow } from '../types'
import type { AgentFilters } from './agentNetwork'
import { enrichRawRows, filterEnrichedRows } from './agentNetwork'
import { isExcludedLoyaltyRole, partnerWalletKey } from './partnerWallet'

const ISSUED = 'PolicyIssued'
const MIN_OSAGO_ACTIVE = 3

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

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isSpendingRow(row: RawRow): boolean {
  if (String(row.CrossIsBought ?? '').trim() !== 'Да') return false
  const pp = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : 2490
  const fp = toNum(row.FinalPrice)
  const kv = toNum(row.ChargedToIncreasedKV)
  if (!isNull(row.ChargedToIncreasedKV) && kv !== 0) return true
  if (!isNull(row.FinalPrice) && fp !== pp) return true
  return false
}

function lastCompleteMonths(ref: Date, n: number): string[] {
  const out: string[] = []
  const y = ref.getFullYear()
  const m = ref.getMonth()
  for (let i = 1; i <= n; i++) {
    const d = new Date(y, m - i, 1)
    out.push(ym(d))
  }
  return out.reverse()
}

function inRange(d: Date, from: Date, to: Date): boolean {
  return d >= from && d <= to
}

export interface MonthPartnerMetric {
  ym: string
  label: string
  withAccrual: number
  activePartners: number
  accrualSharePct: number | null
  withSpend: number
  withAccrualEver: number
  spendShareOfAccrualsPct: number | null
}

export interface LoyaltyPartnerBoardMetrics {
  periodLabel: string
  fullPeriod: {
    accrualPartners: number
    activePartners: number
    accrualSharePct: number | null
    spendPartners: number
    accrualBaseForSpend: number
    spendSharePct: number | null
    totalsNote: string
  }
  last3Months: MonthPartnerMetric[]
  activeSource: 'agent_network' | 'osago_min3'
}

function monthLabel(ym: string): string {
  const [y, mo] = ym.split('-').map(Number)
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  return `${names[mo - 1]} ${y}`
}

function activeFromAgentNetwork(agentRows: RawRow[], filters: AgentFilters): Set<string> {
  const enriched = filterEnrichedRows(
    agentRows.map(r => ({ ...r, CashbookId: r['subj_id'] } as RawRow)),
    filters,
  )
  const s = new Set<string>()
  for (const r of enriched) {
    const id = String(r['subj_id'] ?? r.CashbookId ?? '').trim()
    if (id) s.add(id)
  }
  return s
}

function activeFromOsago(rows: RawRow[], from: Date, to: Date): Set<string> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
  if (String(row.State ?? '') !== ISSUED) continue
    const d = parseDate(row.CreateDate)
    if (!d || !inRange(d, from, to)) continue
    const w = partnerWalletKey(row)
    if (!w) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const s = new Set<string>()
  for (const [w, c] of counts) if (c >= MIN_OSAGO_ACTIVE) s.add(w)
  return s
}

function walletsWithAccrualIn(rows: RawRow[], from: Date, to: Date): Set<string> {
  const s = new Set<string>()
  for (const row of rows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
    if (String(row.State ?? '') !== ISSUED) continue
    const d = parseDate(row.CreateDate)
    if (!d || !inRange(d, from, to)) continue
    const lp = toNum(row.LoyaltyPointsInLK)
    if (isNull(row.LoyaltyPointsInLK) || lp <= 0) continue
    const w = partnerWalletKey(row)
    if (w) s.add(w)
  }
  return s
}

function walletsWithSpendIn(rows: RawRow[], from: Date, to: Date): Set<string> {
  const s = new Set<string>()
  for (const row of rows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
    if (!isSpendingRow(row)) continue
    const d = parseDate(row.CreateDate)
    if (!d || !inRange(d, from, to)) continue
    const w = partnerWalletKey(row)
    if (w) s.add(w)
  }
  return s
}

function walletsEverAccruedBefore(rows: RawRow[], endInclusive: Date): Set<string> {
  const s = new Set<string>()
  for (const row of rows) {
    if (isExcludedLoyaltyRole(row.Role)) continue
    if (String(row.State ?? '') !== ISSUED) continue
    const d = parseDate(row.CreateDate)
    if (!d || d > endInclusive) continue
    const lp = toNum(row.LoyaltyPointsInLK)
    if (isNull(row.LoyaltyPointsInLK) || lp <= 0) continue
    const w = partnerWalletKey(row)
    if (w) s.add(w)
  }
  return s
}

export function computeLoyaltyPartnerBoardMetrics(
  osagoRows: RawRow[],
  filters: AgentFilters,
  agentRows?: RawRow[],
  refDate?: Date | null,
): LoyaltyPartnerBoardMetrics {
  const enriched = filterEnrichedRows(enrichRawRows(osagoRows, agentRows), filters)

  let ref = refDate ?? null
  if (!ref) {
    for (const row of enriched) {
      const d = parseDate(row.CreateDate)
      if (d && (!ref || d > ref)) ref = d
    }
  }
  ref = ref ?? new Date()

  const yearEnd = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999)
  const yearStart = new Date(yearEnd)
  yearStart.setFullYear(yearStart.getFullYear() - 1)
  yearStart.setDate(yearStart.getDate() + 1)

  const agentActiveYear =
    agentRows && agentRows.length > 0
      ? activeFromAgentNetwork(agentRows, filters)
      : null
  const activeYear =
    agentActiveYear && agentActiveYear.size > 0
      ? agentActiveYear
      : activeFromOsago(enriched, yearStart, yearEnd)

  const accrualYear = walletsWithAccrualIn(enriched, yearStart, yearEnd)
  const spendYear = walletsWithSpendIn(enriched, yearStart, yearEnd)

  const months = lastCompleteMonths(ref, 3)
  const monthMetrics: MonthPartnerMetric[] = []

  for (const monthYm of months) {
    const [y, mo] = monthYm.split('-').map(Number)
    const mStart = new Date(y, mo - 1, 1)
    const mEnd = new Date(y, mo, 0, 23, 59, 59, 999)

    const activeMonth =
      agentActiveYear && agentActiveYear.size > 0
        ? agentActiveYear
        : activeFromOsago(enriched, mStart, mEnd)

    const accMonth = walletsWithAccrualIn(enriched, mStart, mEnd)
    const spendMonth = walletsWithSpendIn(enriched, mStart, mEnd)
    const everAcc = walletsEverAccruedBefore(enriched, mEnd)

    monthMetrics.push({
      ym: monthYm,
      label: monthLabel(monthYm),
      withAccrual: accMonth.size,
      activePartners: activeMonth.size,
      accrualSharePct:
        activeMonth.size > 0 ? (accMonth.size / activeMonth.size) * 100 : null,
      withSpend: spendMonth.size,
      withAccrualEver: everAcc.size,
      spendShareOfAccrualsPct:
        everAcc.size > 0 ? (spendMonth.size / everAcc.size) * 100 : null,
    })
  }

  return {
    periodLabel: `за 12 мес до ${yearEnd.toLocaleDateString('ru-RU')}`,
    fullPeriod: {
      accrualPartners: accrualYear.size,
      activePartners: activeYear.size,
      accrualSharePct:
        activeYear.size > 0 ? (accrualYear.size / activeYear.size) * 100 : null,
      spendPartners: spendYear.size,
      accrualBaseForSpend: accrualYear.size,
      spendSharePct:
        accrualYear.size > 0 ? (spendYear.size / accrualYear.size) * 100 : null,
      totalsNote:
        'Партнёр = кешбук (HeadPartnerCB или CashbookId). Исключены только Seller / Продавец; субучётки партнёра внутри головы.',
    },
    last3Months: monthMetrics,
    activeSource:
      agentActiveYear && agentActiveYear.size > 0 ? 'agent_network' : 'osago_min3',
  }
}