import { useState, useMemo } from 'react'
import type { AggregateResult, MonthMetrics } from '../../types'
import type { RawRow } from '../../types'
import { AgentFilterBar } from '../AgentFilterBar'
import {
  EMPTY_AGENT_FILTERS,
  enrichRawRows,
  filterEnrichedRows,
  type AgentFilters,
} from '../../utils/agentNetwork'
import { aggregate } from '../../utils/aggregate'

interface Props {
  result: AggregateResult
  agentRows?: RawRow[]
  lockedCurator?: string
}

// ─── Локальные хелперы ────────────────────────────────────────────────────────
function isNullVal(v: unknown): boolean {
  return v == null || v === '[NULL]' || v === ''
}
function toNum(v: unknown): number {
  if (isNullVal(v)) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}
const EXCLUDED_DIST = new Set(['PolicyAnnulled', 'PolicyTerminated'])
const BASE_PRICE_DIST = 2490

function getMonthKey(v: unknown): string | null {
  let d: Date | null = null
  if (v instanceof Date)          d = isNaN(v.getTime()) ? null : v
  else if (typeof v === 'number') d = new Date((v - 25569) * 86400000)
  else if (typeof v === 'string') { const x = new Date(v); d = isNaN(x.getTime()) ? null : x }
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Извлечение данных: per-policy ───────────────────────────────────────────
function extractDistValues(rows: RawRow[], monthKey: string | null) {
  const accrualValues: number[] = []
  let accrualZeroCount = 0
  const spendingValues: number[] = []
  let spendingZeroCount = 0

  for (const row of rows) {
    const state = String(row.State ?? '')
    if (EXCLUDED_DIST.has(state)) continue
    if (monthKey !== null && getMonthKey(row.CreateDate) !== monthKey) continue

    if (state === 'PolicyIssued') {
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNullVal(row.LoyaltyPointsInLK) && lp > 0) {
        accrualValues.push(lp)
      } else {
        accrualZeroCount++
      }

      if (String(row.CrossIsBought ?? '') === 'Да') {
        const policyPrice = !isNullVal(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE_DIST
        const fp  = toNum(row.FinalPrice)
        const kv  = toNum(row.ChargedToIncreasedKV)
        const hasKV       = !isNullVal(row.ChargedToIncreasedKV) && kv !== 0
        const hasDiscount = !isNullVal(row.FinalPrice) && fp !== policyPrice
        const spend = (hasKV ? kv : 0) + (hasDiscount ? policyPrice - fp : 0)
        if (spend > 0) spendingValues.push(spend)
        else spendingZeroCount++
      }
    }
  }

  return { accrualValues, accrualZeroCount, spendingValues, spendingZeroCount }
}

/** Ср. доступный остаток (AvailableForUsePoints) на партнёра RenId — снимок в выборке. */
function extractPartnerCurrentBalanceAvgs(rows: RawRow[], monthKey: string | null) {
  const balance = new Map<string, number>()
  const accrualPartners = new Set<string>()
  const allPartners = new Set<string>()

  for (const row of rows) {
    const state = String(row.State ?? '')
    if (EXCLUDED_DIST.has(state)) continue
    if (monthKey !== null && getMonthKey(row.CreateDate) !== monthKey) continue

    const renId = String(row['RenId'] ?? '').trim()
    if (!renId) continue
    allPartners.add(renId)

    if (state === 'PolicyIssued') {
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNullVal(row.LoyaltyPointsInLK) && lp > 0) accrualPartners.add(renId)
    }

    const av = toNum(row['AvailableForUsePoints'])
    if (!isNullVal(row['AvailableForUsePoints'])) {
      balance.set(renId, Math.max(balance.get(renId) ?? 0, av))
    }
  }

  function meanAmong(ids: Set<string>, positiveOnly: boolean): number {
    const list = positiveOnly
      ? [...ids].filter(id => (balance.get(id) ?? 0) > 0)
      : [...ids]
    if (list.length === 0) return 0
    let sum = 0
    for (const id of list) sum += balance.get(id) ?? 0
    return sum / list.length
  }

  const withPositiveBalance = [...allPartners].filter(id => (balance.get(id) ?? 0) > 0).length

  return {
    meanAll: meanAmong(allPartners, false),
    meanPositiveOnly: meanAmong(allPartners, true),
    allPartnersCount: allPartners.size,
    positiveBalanceCount: withPositiveBalance,
    accrualPartnersCount: accrualPartners.size,
  }
}

/** Для партнёров, у которых есть хотя бы одно начисление — их данные по списаниям */
function extractAccrualPartnerSpending(rows: RawRow[], monthKey: string | null) {
  // 1. Собираем партнёров с начислениями
  const accrualPartners = new Set<string>()
  for (const row of rows) {
    if (String(row.State ?? '') !== 'PolicyIssued') continue
    if (monthKey !== null && getMonthKey(row.CreateDate) !== monthKey) continue
    const renId = String(row['RenId'] ?? '').trim()
    if (!renId) continue
    const lp = toNum(row.LoyaltyPointsInLK)
    if (!isNullVal(row.LoyaltyPointsInLK) && lp > 0) accrualPartners.add(renId)
  }

  // 2. Считаем списания только для этих партнёров
  const partnerAmount = new Map<string, number>()
  const partnerEvents = new Map<string, number>()
  for (const renId of accrualPartners) { partnerAmount.set(renId, 0); partnerEvents.set(renId, 0) }

  for (const row of rows) {
    const state = String(row.State ?? '')
    if (EXCLUDED_DIST.has(state)) continue
    if (String(row.CrossIsBought ?? '') !== 'Да') continue
    if (monthKey !== null && getMonthKey(row.CreateDate) !== monthKey) continue
    const renId = String(row['RenId'] ?? '').trim()
    if (!renId || !accrualPartners.has(renId)) continue
    const policyPrice = !isNullVal(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE_DIST
    const fp  = toNum(row.FinalPrice)
    const kv  = toNum(row.ChargedToIncreasedKV)
    const hasKV       = !isNullVal(row.ChargedToIncreasedKV) && kv !== 0
    const hasDiscount = !isNullVal(row.FinalPrice) && fp !== policyPrice
    const spend = (hasKV ? kv : 0) + (hasDiscount ? policyPrice - fp : 0)
    if (spend > 0) {
      partnerAmount.set(renId, (partnerAmount.get(renId) ?? 0) + spend)
      partnerEvents.set(renId, (partnerEvents.get(renId) ?? 0) + 1)
    }
  }

  const values: number[] = []
  let zeroCount = 0
  let totalEvents = 0
  for (const [renId, amount] of partnerAmount.entries()) {
    if (amount > 0) values.push(amount)
    else zeroCount++
    totalEvents += partnerEvents.get(renId) ?? 0
  }
  const totalRb = values.reduce((s, v) => s + v, 0)
  const spentAtLeastOnce = values.length

  return {
    values,
    zeroCount,
    accrualPartnersCount: accrualPartners.size,
    spentAtLeastOnce,
    totalEvents,
    totalRb,
  }
}

// ─── Тип распределения ───────────────────────────────────────────────────────
interface DistBucket { from: number; to: number; count: number; pct: number; name: string; sum: number }
interface LocalDistData {
  nonZeroCount: number
  zeroCount: number
  total: number
  mean: number     // среднее среди ненулевых
  meanAll: number  // среднее среди всех (включая нули)
  std: number
  buckets: DistBucket[]
}

/** Граница бина: нормальные σ-точки, но ближе к «красивым» целым с 0 на конце. */
function snapCutPoint(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0
  if (x < 2000) return Math.round(x / 10) * 10
  if (x < 20_000) return Math.round(x / 100) * 100
  return Math.round(x / 1000) * 1000
}

function bucketName(from: number, to: number, mean: number, std: number): string {
  if (to  !== Infinity && to  <= Math.max(0, mean - std)) return 'Значительно ниже среднего'
  if (to  !== Infinity && to  <= mean)                     return 'Ниже среднего'
  if (from >= mean + std)                                  return 'Значительно выше среднего'
  if (from >= mean)                                        return 'Выше среднего'
  return 'Около среднего'
}

/**
 * keepEmptyNames — имена бакетов, которые остаются даже при count = 0
 * maxBucketPct   — если бакет занимает > X% от total, он разбивается на два по медиане значений внутри
 */
function computeDist(
  values: number[],
  zeroCount: number,
  keepEmptyNames: string[] = [],
  maxBucketPct = 100,
): LocalDistData {
  const total = values.length + zeroCount
  if (values.length === 0) {
    return { nonZeroCount: 0, zeroCount, total, mean: 0, meanAll: 0, std: 0, buckets: [] }
  }

  const mean     = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const std      = Math.sqrt(variance)
  const meanAll  = total > 0 ? (mean * values.length) / total : 0

  const rawPts = [
    Math.max(0, mean - 2 * std),
    Math.max(0, mean - std),
    mean,
    mean + std,
    mean + 2 * std,
  ].map(snapCutPoint)

  const pts: number[] = [0]
  for (const p of rawPts) {
    const minStep = p < 2000 ? 10 : p < 20_000 ? 100 : 1000
    const next = Math.max(p, pts[pts.length - 1] + minStep)
    if (next > pts[pts.length - 1]) pts.push(next)
  }

  // Авто-сплит: если бакет > maxBucketPct% от total, делим его на две части по медиане
  if (maxBucketPct < 100 && total > 0) {
    const threshold = maxBucketPct / 100
    const extraPts: number[] = []

    // Конечные диапазоны (pts[i] – pts[i+1])
    for (let i = 0; i < pts.length - 1; i++) {
      const from = pts[i], to = pts[i + 1]
      const inBucket = values.filter(v => v > from && v <= to)
      if (inBucket.length / total > threshold) {
        const sorted = [...inBucket].sort((a, b) => a - b)
        const med = sorted[Math.floor((sorted.length - 1) / 2)]
        if (med > from + 0.5 && med < to - 0.5) extraPts.push(med)
      }
    }
    // Открытый диапазон (pts[last] – ∞)
    const lastPt = pts[pts.length - 1]
    const inLast = values.filter(v => v > lastPt)
    if (inLast.length / total > threshold) {
      const sorted = [...inLast].sort((a, b) => a - b)
      const med = sorted[Math.floor((sorted.length - 1) / 2)]
      if (med > lastPt + 0.5) extraPts.push(med)
    }

    for (const p of extraPts) {
      if (!pts.some(x => Math.abs(x - p) < 0.5)) pts.push(p)
    }
    pts.sort((a, b) => a - b)
  }

  const ranges: { from: number; to: number }[] = []
  for (let i = 0; i < pts.length - 1; i++) ranges.push({ from: pts[i], to: pts[i + 1] })
  ranges.push({ from: pts[pts.length - 1], to: Infinity })

  const buckets: DistBucket[] = ranges
    .map(r => {
      const inRange = values.filter(v => v > r.from && (r.to === Infinity ? true : v <= r.to))
      const count   = inRange.length
      const sum     = inRange.reduce((s, v) => s + v, 0)
      return {
        from: r.from, to: r.to, count, sum,
        pct:  total > 0 ? (count / total) * 100 : 0,
        name: bucketName(r.from, r.to, mean, std),
      }
    })
    .filter(b => b.count > 0 || keepEmptyNames.includes(b.name))

  return { nonZeroCount: values.length, zeroCount, total, mean, meanAll, std, buckets }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtN   = (v: number) => Math.round(v).toLocaleString('ru-RU')
const fmtF   = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
const fmtAvg = (v: number) =>
  Number.isFinite(v)
    ? v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '—'
const fmtRbInt = (v: number) =>
  Number.isFinite(v) ? `${fmtN(Math.round(v))} РБ` : '—'
const fmtDec1 = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Компактно: 1,3К / 7,3М / 0,7М (≥100 тыс. — в миллионах). */
const fmtRbCompact = (v: number) => {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 100_000) return `${fmtDec1(v / 1_000_000)}М`
  if (abs >= 1_000) return `${fmtDec1(v / 1_000)}К`
  return `${fmtN(Math.round(v))} РБ`
}
const fmtPct1 = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'

function humanLabel(b: { from: number; to: number }, unit: string): string {
  const hi = b.to === Infinity ? Infinity : Math.round(b.to)
  if (b.from <= 0 && hi === Infinity) return `любые, ${unit}`
  if (b.from <= 0) return `до ${fmtN(hi)} ${unit}`
  if (hi === Infinity) return `от ${fmtN(Math.ceil(b.from))} ${unit}`
  return `${fmtN(Math.ceil(b.from))} – ${fmtN(hi)} ${unit}`
}

const BAR_COLORS = [
  'ren-bar-chart', 'ren-bar-chart--mid', 'ren-bar-chart--strong',
  'ren-bar-chart--strong', 'ren-bar-chart--mid', 'ren-bar-chart',
]

// ─── Один блок распределения ─────────────────────────────────────────────────
function DistBlock({
  title, subtitle, dist, unit,
  hideZeroChip, showMeanAll, meanNonZeroLabel, meanAllLabel,
  meanNonZeroOverride, meanAllOverride,
}: {
  title: string
  subtitle: string
  dist: LocalDistData
  unit: string
  hideZeroChip?: boolean
  showMeanAll?: boolean
  meanNonZeroLabel?: string
  meanAllLabel?: string
  meanNonZeroOverride?: number  // если задан — показываем вместо dist.mean
  meanAllOverride?: number      // если задан — показываем вместо dist.meanAll
}) {
  if (dist.total === 0) {
    return (
      <div className="ren-card ren-card__body text-center ren-text-secondary text-sm">
        Нет данных для «{title}»
      </div>
    )
  }

  const zeroPct  = dist.total > 0 ? (dist.zeroCount / dist.total) * 100 : 0
  const maxCount = Math.max(...dist.buckets.map(b => b.count), dist.zeroCount, 1)
  const meanLabel    = meanNonZeroLabel ?? 'Среднее (ненулевые)'
  const meanAllLabelResolved = meanAllLabel ?? 'Среднее (включая нулевые)'
  const meanNonZeroValue = meanNonZeroOverride !== undefined ? meanNonZeroOverride : dist.mean
  const meanAllValue     = meanAllOverride     !== undefined ? meanAllOverride     : dist.meanAll

  return (
    <div className="ren-card">
      <div className="ren-card__header">
        <h3 className="ren-card__title">{title}</h3>
        <p className="ren-card__subtitle">{subtitle}</p>
      </div>

      <div className="ren-card__body flex flex-wrap gap-6 border-b border-[var(--stroke-divider)] ren-bg-brand-soft">
        <div>
          <span className="text-xs ren-text-secondary">Всего событий</span>
          <p className="text-lg font-bold text-[var(--text-primary)]">{fmtN(dist.total)}</p>
        </div>
        {dist.nonZeroCount > 0 && (
          <>
            <div>
              <span className="text-xs ren-text-secondary">С ненулевым значением</span>
              <p className="text-lg font-bold ren-text-brand">{fmtN(dist.nonZeroCount)}</p>
            </div>
            <div>
              <span className="text-xs ren-text-secondary">{meanLabel}</span>
              <p className="text-lg font-bold ren-text-brand">{fmtN(Math.round(meanNonZeroValue))} {unit}</p>
            </div>
            {showMeanAll && (
              <div>
                <span className="text-xs ren-text-secondary">{meanAllLabelResolved}</span>
                <p className="text-lg font-bold ren-text-brand">{fmtN(Math.round(meanAllValue))} {unit}</p>
              </div>
            )}
          </>
        )}
        {/* п.1/п.2/п.3: плашка «Нулевое значение» скрыта через hideZeroChip */}
        {!hideZeroChip && dist.zeroCount > 0 && (
          <div>
            <span className="text-xs text-gray-500">Нулевое значение</span>
            <p className="text-lg font-bold text-amber-600">
              {fmtN(dist.zeroCount)}{' '}
              <span className="text-sm font-normal text-gray-500">({fmtF(zeroPct)}%)</span>
            </p>
          </div>
        )}
      </div>

      {/* Мини-гистограмма */}
      <div className="px-5 py-4 flex items-end gap-1.5" style={{ height: '112px' }}>
        {dist.zeroCount > 0 && (
          <div className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] text-amber-600 tabular-nums">{fmtN(dist.zeroCount)}</span>
            <div
              className="w-full rounded-t-sm bg-amber-200"
              style={{ height: `${Math.round((dist.zeroCount / maxCount) * 80)}px`, minHeight: '4px' }}
            />
          </div>
        )}
        {dist.buckets.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] text-gray-500 tabular-nums">{fmtN(b.count)}</span>
            <div
              className={`w-full rounded-t-sm ${BAR_COLORS[i % BAR_COLORS.length]}`}
              style={{ height: `${Math.round((b.count / maxCount) * 80)}px`, minHeight: '4px' }}
            />
          </div>
        ))}
      </div>

      {/* Таблица диапазонов
          п.4/п.7: «Доля» (бар) удалена, «% от итого» → «Доля», добавлена строка ИТОГО */}
      <div className="overflow-x-auto border-t border-[var(--stroke-divider)]">
        <table className="ren-table w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2 text-left">Диапазон</th>
              <th className="px-4 py-2 text-left text-gray-400 font-normal">Характеристика</th>
              <th className="px-4 py-2 text-right">Доля</th>
            </tr>
          </thead>
          <tbody>
            {/* Нулевая строка */}
            {dist.zeroCount > 0 && (
              <tr className="border-t border-gray-100 bg-amber-50/40 hover:bg-amber-50/70">
                <td className="px-4 py-2.5 font-medium text-amber-700">0 {unit}</td>
                <td className="px-4 py-2.5 text-xs text-gray-400">Нет Рен-бонусов / нулевое значение</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-amber-600 font-medium">{fmtF(zeroPct)}%</td>
              </tr>
            )}
            {/* Ненулевые диапазоны */}
            {dist.buckets.map((b, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">{humanLabel(b, unit)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-400">{b.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums ren-text-brand font-medium">{fmtF(b.pct)}%</td>
              </tr>
            ))}
            {/* ИТОГО строка (п.4/п.7) */}
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2.5 text-gray-800">ИТОГО</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Средние показатели Рен-бонусов ──────────────────────────────────────────
function AvgCard({
  title, value, value2, sub, detailLines,
}: {
  title: string
  value: string
  value2?: string
  sub?: string
  detailLines?: { label: string; value: string }[]
}) {
  return (
    <div className="ren-card ren-card__body flex flex-col gap-0.5">
      <p className="text-xs ren-text-brand font-medium uppercase tracking-wide leading-tight">{title}</p>
      <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5 tabular-nums">{value}</p>
      {value2 && <p className="text-sm font-semibold ren-text-secondary">{value2}</p>}
      {sub && <p className="text-xs ren-text-secondary mt-0.5 leading-snug">{sub}</p>}
      {detailLines && detailLines.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {detailLines.map((line) => (
            <p key={line.label} className="text-sm leading-snug">
              <span className="ren-text-secondary">{line.label}</span>{' '}
              <span className="font-bold ren-text-brand tabular-nums">{line.value}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function AvgBonusBlock({
  totals,
  months,
  balanceAvgs,
}: {
  totals: MonthMetrics
  months: MonthMetrics[]
  balanceAvgs: ReturnType<typeof extractPartnerCurrentBalanceAvgs>
}) {
  const n = months.length
  if (n === 0) return null

  const avgBalanceAllPartners = balanceAvgs.meanAll
  const avgBalancePositiveOnly = balanceAvgs.meanPositiveOnly
  const avgAccrualRub  = totals.bonus_accrued / n
  const avgSpendingRub = totals.bonus_spent_total / n
  const avgDiscountRb  = totals.bonus_spent_discount / n
  const avgKvRb        = totals.bonus_spent_kv  / n
  const spendShareOfAccrual =
    avgAccrualRub > 0 ? (avgSpendingRub / avgAccrualRub) * 100 : 0

  const tableRows = [
    {
      label: 'Баланс кошелька · все',
      total: balanceAvgs.allPartnersCount > 0 ? fmtRbCompact(avgBalanceAllPartners) : '—',
      avg: '—',
      snapshot: true,
    },
    {
      label: 'Баланс · остаток > 0',
      total: balanceAvgs.positiveBalanceCount > 0 ? fmtRbCompact(avgBalancePositiveOnly) : '—',
      avg: '—',
      snapshot: true,
    },
    {
      label: 'Начисления',
      total: fmtRbCompact(totals.bonus_accrued),
      avg: fmtRbCompact(avgAccrualRub),
      snapshot: false,
    },
    {
      label: 'Списания',
      total: fmtRbCompact(totals.bonus_spent_total),
      avg: fmtRbCompact(avgSpendingRub),
      snapshot: false,
    },
  ]

  return (
    <div className="ren-card">
      <div className="ren-card__header">
        <h3 className="ren-card__title text-sm uppercase tracking-wide">Средние показатели Рен-бонусов</h3>
        <p className="ren-card__subtitle">Среднее арифметическое по {n} месяцам наблюдений</p>
      </div>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <AvgCard
          title="Ср. баланс в кошельке"
          value={fmtRbCompact(avgBalanceAllPartners)}
          sub={`${fmtN(balanceAvgs.allPartnersCount)} партнёров · с нулями`}
        />
        <AvgCard
          title="Ср. баланс в кошельке"
          value={fmtRbCompact(avgBalancePositiveOnly)}
          sub={`${fmtN(balanceAvgs.positiveBalanceCount)} · остаток > 0`}
        />
        <AvgCard
          title="Ср. начислений / мес."
          value={fmtRbCompact(avgAccrualRub)}
          sub="за месяц"
        />
        <AvgCard
          title="Ср. списаний итого / мес."
          value={fmtRbCompact(avgSpendingRub)}
          value2={`${fmtPct1(spendShareOfAccrual)}% от начислений`}
          detailLines={[
            { label: 'Скидка КВ', value: fmtRbCompact(avgDiscountRb) },
            { label: 'Повыш. КВ', value: fmtRbCompact(avgKvRb) },
          ]}
        />
      </div>
      <div className="border-t border-[var(--stroke-divider)] overflow-x-auto">
        <table className="ren-table w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2 text-left">Показатель</th>
              <th className="px-4 py-2 text-right">Итого</th>
              <th className="px-4 py-2 text-right">Ср. / мес.</th>
            </tr>
          </thead>
          <tbody className="text-[var(--text-primary)]">
            {tableRows.map((r, i) => (
              <tr key={i} className="border-t border-[var(--stroke-divider)]">
                <td className="px-4 py-2.5">{r.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{r.total}</td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums ${
                    r.snapshot ? 'text-[var(--text-tertiary)]' : 'ren-text-brand font-semibold'
                  }`}
                >
                  {r.avg}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Блок: начисляющие партнёры → их списания ────────────────────────────────
type AccrualSpendingData = ReturnType<typeof extractAccrualPartnerSpending>

function AccrualSpendingBlock({ data }: { data: AccrualSpendingData }) {
  if (data.accrualPartnersCount === 0) return null
  const spentPct = (data.spentAtLeastOnce / data.accrualPartnersCount) * 100
  const neverPct = ((data.accrualPartnersCount - data.spentAtLeastOnce) / data.accrualPartnersCount) * 100
  const meanAmongSpent = data.spentAtLeastOnce > 0 ? data.totalRb / data.spentAtLeastOnce : 0
  const meanAmongAll   = data.accrualPartnersCount > 0 ? data.totalRb / data.accrualPartnersCount : 0

  return (
    <div className="space-y-3">
      {/* Сводка по воронке */}
      <div className="ren-card">
        <div className="ren-card__header">
          <h3 className="ren-card__title text-sm uppercase tracking-wide">
            Из начисляющих партнёров — кто списывал?
          </h3>
          <p className="ren-card__subtitle">
            База: партнёры, у которых есть хотя бы одно начисление (State = PolicyIssued, LoyaltyPointsInLK &gt; 0)
          </p>
        </div>
        <div className="ren-card__body flex flex-wrap gap-6">
          <div>
            <p className="text-xs ren-text-secondary">Партнёров с начислениями</p>
            <p className="text-3xl font-bold ren-text-brand">{fmtN(data.accrualPartnersCount)}</p>
          </div>
          <div>
            <p className="text-xs ren-text-secondary">Из них списали хоть раз</p>
            <p className="text-3xl font-bold ren-text-brand">{fmtN(data.spentAtLeastOnce)}</p>
            <p className="text-xs ren-text-secondary mt-0.5">{fmtF(spentPct)}% от начисляющих</p>
          </div>
          <div>
            <p className="text-xs ren-text-secondary">Ни разу не списали</p>
            <p className="text-3xl font-bold text-[var(--text-secondary)]">{fmtN(data.accrualPartnersCount - data.spentAtLeastOnce)}</p>
            <p className="text-xs ren-text-secondary mt-0.5">{fmtF(neverPct)}% от начисляющих</p>
          </div>
          <div>
            <p className="text-xs ren-text-secondary">Событий списания, шт.</p>
            <p className="text-3xl font-bold text-[var(--text-primary)]">{fmtN(data.totalEvents)}</p>
          </div>
          <div>
            <p className="text-xs ren-text-secondary">Списали итого, РБ</p>
            <p className="text-3xl font-bold ren-text-brand">{fmtN(Math.round(data.totalRb))}</p>
          </div>
          <div>
            <p className="text-xs ren-text-secondary">Ср. списание на 1 (кто списывал)</p>
            <p className="text-3xl font-bold text-[var(--text-primary)]">{fmtN(Math.round(meanAmongSpent))}</p>
            <p className="text-xs ren-text-secondary mt-0.5">РБ</p>
          </div>
          <div>
            <p className="text-xs ren-text-secondary">Ср. списание на 1 (все начисляющие)</p>
            <p className="text-3xl font-bold ren-text-secondary">{fmtN(Math.round(meanAmongAll))}</p>
            <p className="text-xs ren-text-secondary mt-0.5">РБ</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────
export default function DistributionTab({ result, agentRows, lockedCurator }: Props) {
  const [agentFilters, setAgentFilters] = useState<AgentFilters>(() =>
    lockedCurator ? { ...EMPTY_AGENT_FILTERS, КУРАТОР: [lockedCurator] } : EMPTY_AGENT_FILTERS
  )
  const enrichedRows = useMemo(() => enrichRawRows(result.rawRows, agentRows), [result.rawRows, agentRows])
  const filteredRows = useMemo(
    () => filterEnrichedRows(enrichedRows, agentFilters),
    [enrichedRows, agentFilters],
  )
  const filteredAgg = useMemo(() => aggregate(filteredRows), [filteredRows])
  const { totals, months } = filteredAgg
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  const activeFilterCount = useMemo(
    () => Object.values(agentFilters).filter(a => a.length > 0).length,
    [agentFilters],
  )

  // Per-policy данные
  const distData = useMemo(
    () => extractDistValues(filteredRows, selectedMonth),
    [filteredRows, selectedMonth]
  )
  const accrualDist  = useMemo(
    () => computeDist(distData.accrualValues,  distData.accrualZeroCount),
    [distData]
  )
  // п.7: всегда показываем бакет «Выше среднего» + авто-сплит бакетов > 40%
  const spendingDist = useMemo(
    () => computeDist(distData.spendingValues, distData.spendingZeroCount),
    [distData]
  )

  const accrualSpendData = useMemo(
    () => extractAccrualPartnerSpending(filteredRows, selectedMonth),
    [filteredRows, selectedMonth]
  )

  const balanceAvgs = useMemo(
    () => extractPartnerCurrentBalanceAvgs(filteredRows, selectedMonth),
    [filteredRows, selectedMonth],
  )

  return (
    <div className="space-y-6">

      <AgentFilterBar
        enrichedRows={enrichedRows}
        filters={agentFilters}
        setFilters={setAgentFilters}
        lockedCurator={lockedCurator}
      />

      {activeFilterCount > 0 && (
        <div className="ren-card ren-card__body text-sm ren-text-secondary">
          Средние и распределения пересчитаны по выбранным фильтрам ({filteredRows.length.toLocaleString('ru-RU')} строк).
        </div>
      )}

      {/* Средние показатели Рен-бонусов — вверху */}
      <AvgBonusBlock totals={totals} months={months} balanceAvgs={balanceAvgs} />

      {/* Пояснение */}
      <div className="ren-card ren-card__body ren-bg-brand-soft ren-text-brand text-sm">
        <strong>Как читать таблицы распределения.</strong>&nbsp;
        Диапазоны строятся от 0 и выше вокруг среднего значения (±σ).
        Строки с нулевым значением выделены отдельно. Пустые срезы скрыты.
      </div>

      {/* Фильтр по периоду */}
      <div className="ren-card ren-card__body flex items-center gap-3">
        <span className="text-sm ren-text-brand font-medium shrink-0">Период:</span>
        <select
          value={selectedMonth ?? ''}
          onChange={e => setSelectedMonth(e.target.value || null)}
          className="ren-select text-sm"
        >
          <option value="">Все периоды</option>
          {months.map(m => (
            <option key={m.sortKey} value={m.sortKey}>{m.label}</option>
          ))}
        </select>
        {selectedMonth && (
          <button
            onClick={() => setSelectedMonth(null)}
            className="ren-link text-xs"
          >
            ✕ сбросить
          </button>
        )}
      </div>

      {/* ── В разрезе партнёров ── */}
      <div className="flex items-center gap-4">
        <div className="h-0.5 flex-1 bg-[var(--bg-brand-primary-01)]" />
        <span className="ren-section-marker">В разрезе партнёров</span>
        <div className="h-0.5 flex-1 bg-[var(--bg-brand-primary-01)]" />
      </div>

      <AccrualSpendingBlock data={accrualSpendData} />

      {/* ── В разрезе полисов ── */}
      <div className="flex items-center gap-4">
        <div className="h-0.5 flex-1 bg-[var(--bg-brand-primary-01)]" />
        <span className="ren-section-marker">В разрезе полисов</span>
        <div className="h-0.5 flex-1 bg-[var(--bg-brand-primary-01)]" />
      </div>

      {/* п.5: Распределение начислений по полису ОСАГО ФЛ */}
      <DistBlock
        title="Распределение поступивших Рен-бонусов в оформленных полисах ОСАГО ФЛ"
        subtitle="Оформленные полисы (State = PolicyIssued). Каждое событие = 1 полис. Значение = LoyaltyPointsInLK."
        dist={accrualDist}
        unit="Рен-бонусов"
        hideZeroChip
        showMeanAll
        meanNonZeroLabel="Среднее (не включая нулевые) по полису ОСАГО ФЛ"
        meanAllLabel="Среднее (включая нулевые) по полису ОСАГО ФЛ"
      />

      {/* п.9: Распределение списанных по полису Кросс-Каско */}
      <DistBlock
        title="Распределение списанных Рен-бонусов в оформленных полисах Кросс Каско от бесполисных"
        subtitle="Кросс-Каско куплен (CrossIsBought = Да). Каждое событие = 1 полис. Значение = суммарное списание по строке."
        dist={spendingDist}
        unit="Рен-бонусов"
        hideZeroChip
        meanNonZeroLabel="Среднее списание на полис Каско от бесполисных"
      />

    </div>
  )
}
