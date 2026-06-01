import * as XLSX from 'xlsx'
import type { RawRow, MonthMetrics, AggregateResult } from '../types'

const EXCLUDED_STATES = new Set(['PolicyAnnulled', 'PolicyTerminated'])
const BASE_PRICE = 2490

function parseDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date((value - 25569) * 86400000)
  if (typeof value === 'string') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function isNull(value: unknown): boolean {
  return value == null || value === '[NULL]' || value === ''
}

function toNumber(value: unknown): number {
  if (isNull(value)) return 0
  const n = Number(value)
  return isNaN(n) ? 0 : n
}

function hasBonus(value: unknown): boolean {
  return !isNull(value) && toNumber(value) !== 0
}

function monthLabel(date: Date): string {
  return date.toLocaleString('ru-RU', { month: 'short', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase())
}

function monthKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Use local date components (not UTC) to match the user's timezone
function toDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function pct(num: number, den: number): number | null {
  if (den === 0) return null
  return (num / den) * 100
}

function emptyBucket(label: string, sortKey: string): MonthMetrics {
  return {
    label, sortKey,
    min_date: '', max_date: '',
    total_quotes: 0, quotes_no_bonus: 0, quotes_with_bonus: 0, pct_quotes_bonus: null,
    issued_total: 0, issued_no_bonus: 0, issued_with_bonus: 0, conversion: null, pct_issued_bonus: null,
    cross_total: 0, cross_no_bonus: 0, cross_with_bonus: 0,
    conv_cross: null, conv_cross_nb: null, conv_cross_wb: null,
    cross_base: 0, cross_discount: 0, cross_incr_kv: 0,
    bonus_accrued: 0, bonus_spent_discount: 0, bonus_spent_kv: 0, bonus_spent_total: 0,
  }
}

function finalise(b: MonthMetrics): MonthMetrics {
  return {
    ...b,
    pct_quotes_bonus: pct(b.quotes_with_bonus, b.total_quotes),
    conversion: pct(b.issued_total, b.total_quotes),
    pct_issued_bonus: pct(b.issued_with_bonus, b.issued_total),
    conv_cross: pct(b.cross_total, b.issued_total),
    conv_cross_nb: pct(b.cross_no_bonus, b.issued_no_bonus),
    conv_cross_wb: pct(b.cross_with_bonus, b.issued_with_bonus),
    bonus_spent_total: b.bonus_spent_discount + b.bonus_spent_kv,
  }
}

/** Merge several MonthMetrics into one (for year-level summaries) */
export function mergeMetrics(months: MonthMetrics[], label: string, sortKey: string): MonthMetrics {
  const b = emptyBucket(label, sortKey)
  b.min_date = months[0]?.min_date ?? ''
  b.max_date = months[months.length - 1]?.max_date ?? ''
  for (const m of months) {
    b.total_quotes += m.total_quotes
    b.quotes_no_bonus += m.quotes_no_bonus
    b.quotes_with_bonus += m.quotes_with_bonus
    b.issued_total += m.issued_total
    b.issued_no_bonus += m.issued_no_bonus
    b.issued_with_bonus += m.issued_with_bonus
    b.cross_total += m.cross_total
    b.cross_no_bonus += m.cross_no_bonus
    b.cross_with_bonus += m.cross_with_bonus
    b.cross_base += m.cross_base
    b.cross_discount += m.cross_discount
    b.cross_incr_kv += m.cross_incr_kv
    b.bonus_accrued += m.bonus_accrued
    b.bonus_spent_discount += m.bonus_spent_discount
    b.bonus_spent_kv += m.bonus_spent_kv
  }
  return finalise(b)
}

export function parseWorkbook(data: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(data, { type: 'array', cellDates: true })
  const rows: RawRow[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    rows.push(...XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null }))
  }
  return rows
}

export function aggregate(rows: RawRow[]): AggregateResult {
  const buckets = new Map<string, MonthMetrics>()

  for (const row of rows) {
    const state = String(row.State ?? '')
    if (EXCLUDED_STATES.has(state)) continue

    const date = parseDate(row.CreateDate)
    if (!date) continue

    const key = monthKey(date)
    if (!buckets.has(key)) buckets.set(key, emptyBucket(monthLabel(date), key))
    const b = buckets.get(key)!

    // Track date range for partial-month detection
    const ds = toDateStr(date)
    if (!b.min_date || ds < b.min_date) b.min_date = ds
    if (!b.max_date || ds > b.max_date) b.max_date = ds

    const bonus = hasBonus(row.LoyaltyPointsInLK)
    const issued = state === 'PolicyIssued'
    const crossBought = String(row.CrossIsBought ?? '') === 'Да'

    // Block 1 — все котировки (любой статус, кроме исключённых)
    b.total_quotes++
    if (bonus) b.quotes_with_bonus++; else b.quotes_no_bonus++

    // Block 2 + 5 — только оформленные полисы (PolicyIssued)
    if (issued) {
      b.issued_total++
      if (bonus) b.issued_with_bonus++; else b.issued_no_bonus++

      // Block 5 — начислено бонусов (только PolicyIssued, поле LoyaltyPointsInLK)
      b.bonus_accrued += toNumber(row.LoyaltyPointsInLK)

      // Block 3 + 4 — Кросс-Каско (PolicyIssued + CrossIsBought)
      if (crossBought) {
        b.cross_total++
        if (bonus) b.cross_with_bonus++; else b.cross_no_bonus++

        const incrKV = toNumber(row.ChargedToIncreasedKV)
        const finalPrice = toNumber(row.FinalPrice)

        // Block 5 — списано бонусов (только PolicyIssued + CrossIsBought)
        if (!isNull(row.ChargedToIncreasedKV) && incrKV !== 0) {
          b.cross_incr_kv++
          b.bonus_spent_kv += incrKV
        } else if (!isNull(row.FinalPrice) && finalPrice !== BASE_PRICE) {
          b.cross_discount++
          b.bonus_spent_discount += (BASE_PRICE - finalPrice)
        } else {
          b.cross_base++
        }
      }
    }
  }

  const months = Array.from(buckets.values())
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(finalise)

  const tot = emptyBucket('Итого', '9999-99')
  for (const m of months) {
    tot.total_quotes += m.total_quotes
    tot.quotes_no_bonus += m.quotes_no_bonus
    tot.quotes_with_bonus += m.quotes_with_bonus
    tot.issued_total += m.issued_total
    tot.issued_no_bonus += m.issued_no_bonus
    tot.issued_with_bonus += m.issued_with_bonus
    tot.cross_total += m.cross_total
    tot.cross_no_bonus += m.cross_no_bonus
    tot.cross_with_bonus += m.cross_with_bonus
    tot.cross_base += m.cross_base
    tot.cross_discount += m.cross_discount
    tot.cross_incr_kv += m.cross_incr_kv
    tot.bonus_accrued += m.bonus_accrued
    tot.bonus_spent_discount += m.bonus_spent_discount
    tot.bonus_spent_kv += m.bonus_spent_kv
  }

  return { months, totals: finalise(tot) }
}
