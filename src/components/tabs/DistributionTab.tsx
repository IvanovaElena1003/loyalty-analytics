import { useState, useMemo } from 'react'
import type { AggregateResult, MonthMetrics } from '../../types'
import type { RawRow } from '../../types'

interface Props { result: AggregateResult }

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

// ─── Извлечение данных: per-partner (по партнёрам) ───────────────────────────
/** Суммарные начисленные Рен-бонусы по каждому партнёру (RenId) */
function extractPartnerAccrualValues(rows: RawRow[], monthKey: string | null) {
  const partnerTotals = new Map<string, number>()

  for (const row of rows) {
    if (String(row.State ?? '') !== 'PolicyIssued') continue
    if (monthKey !== null && getMonthKey(row.CreateDate) !== monthKey) continue
    const renId = String(row['RenId'] ?? '').trim()
    if (!renId) continue
    const lp = toNum(row.LoyaltyPointsInLK)
    partnerTotals.set(renId, (partnerTotals.get(renId) ?? 0) + (lp > 0 ? lp : 0))
  }

  const values: number[] = []
  let zeroCount = 0
  for (const total of partnerTotals.values()) {
    if (total > 0) values.push(total)
    else zeroCount++
  }
  return { values, zeroCount }
}

/** Суммарные списанные Рен-бонусы по каждому партнёру (RenId) */
function extractPartnerSpendingValues(rows: RawRow[], monthKey: string | null) {
  const partnerTotals = new Map<string, number>()

  for (const row of rows) {
    const state = String(row.State ?? '')
    if (EXCLUDED_DIST.has(state)) continue
    if (String(row.CrossIsBought ?? '') !== 'Да') continue
    if (monthKey !== null && getMonthKey(row.CreateDate) !== monthKey) continue
    const renId = String(row['RenId'] ?? '').trim()
    if (!renId) continue
    const policyPrice = !isNullVal(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE_DIST
    const fp  = toNum(row.FinalPrice)
    const kv  = toNum(row.ChargedToIncreasedKV)
    const hasKV       = !isNullVal(row.ChargedToIncreasedKV) && kv !== 0
    const hasDiscount = !isNullVal(row.FinalPrice) && fp !== policyPrice
    const spend = (hasKV ? kv : 0) + (hasDiscount ? policyPrice - fp : 0)
    partnerTotals.set(renId, (partnerTotals.get(renId) ?? 0) + spend)
  }

  const values: number[] = []
  let zeroCount = 0
  for (const total of partnerTotals.values()) {
    if (total > 0) values.push(total)
    else zeroCount++
  }
  return { values, zeroCount }
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

function bucketName(from: number, to: number, mean: number, std: number): string {
  if (to  !== Infinity && to  <= Math.max(0, mean - std)) return 'Значительно ниже среднего'
  if (to  !== Infinity && to  <= mean)                     return 'Ниже среднего'
  if (from >= mean + std)                                  return 'Значительно выше среднего'
  if (from >= mean)                                        return 'Выше среднего'
  return 'Около среднего'
}

/** keepEmptyNames — имена бакетов, которые остаются в таблице даже при count = 0 */
function computeDist(
  values: number[],
  zeroCount: number,
  keepEmptyNames: string[] = [],
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
  ]
  const pts: number[] = [0]
  for (const p of rawPts) {
    if (p > pts[pts.length - 1] + 0.5) pts.push(p)
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
const fmtAvg = (v: number) => Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—'

function humanLabel(b: { from: number; to: number }, unit: string): string {
  if (b.from <= 0 && b.to === Infinity) return `любые, ${unit}`
  if (b.from <= 0) return `до ${fmtN(Math.floor(b.to))} ${unit}`
  if (b.to === Infinity) return `от ${fmtN(Math.ceil(b.from))} ${unit}`
  return `${fmtN(Math.ceil(b.from))} – ${fmtN(Math.floor(b.to))} ${unit}`
}

const BAR_COLORS = [
  'bg-blue-200', 'bg-blue-300', 'bg-blue-500',
  'bg-blue-500', 'bg-blue-300', 'bg-blue-200',
]

// ─── Один блок распределения ─────────────────────────────────────────────────
function DistBlock({
  title, subtitle, dist, unit,
  hideZeroChip, showSumColumn, showMeanAll, meanNonZeroLabel, meanAllLabel,
}: {
  title: string
  subtitle: string
  dist: LocalDistData
  unit: string
  hideZeroChip?: boolean       // скрыть плашку «Нулевое значение»
  showSumColumn?: boolean      // колонка «Рен-бонусов» с суммой по диапазону
  showMeanAll?: boolean        // плашка «Среднее (включая нулевые)»
  meanNonZeroLabel?: string    // переопределить подпись среднего (ненулевые)
  meanAllLabel?: string        // переопределить подпись среднего (все, включая нули)
}) {
  if (dist.total === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
        Нет данных для «{title}»
      </div>
    )
  }

  const zeroPct  = dist.total > 0 ? (dist.zeroCount / dist.total) * 100 : 0
  const maxCount = Math.max(...dist.buckets.map(b => b.count), dist.zeroCount, 1)
  const meanLabel    = meanNonZeroLabel ?? 'Среднее (ненулевые)'
  const meanAllLabelResolved = meanAllLabel ?? 'Среднее (включая нулевые)'
  // Сумма всех значений (для ИТОГО строки)
  const totalBucketSum = dist.buckets.reduce((s, b) => s + b.sum, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Заголовок */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>

      {/* Параметры */}
      <div className="px-5 py-3 flex flex-wrap gap-6 border-b border-gray-100 bg-blue-50/40">
        <div>
          <span className="text-xs text-gray-500">Всего событий</span>
          <p className="text-lg font-bold text-gray-800">{fmtN(dist.total)}</p>
        </div>
        {dist.nonZeroCount > 0 && (
          <>
            <div>
              <span className="text-xs text-gray-500">С ненулевым значением</span>
              <p className="text-lg font-bold text-blue-700">{fmtN(dist.nonZeroCount)}</p>
            </div>
            {/* Среднее ненулевые — п.2/п.3: целое число + «Рен-бонусов» */}
            <div>
              <span className="text-xs text-gray-500">{meanLabel}</span>
              <p className="text-lg font-bold text-blue-700">{fmtN(Math.round(dist.mean))} {unit}</p>
            </div>
            {/* Среднее все (включая нули) — только для блоков с showMeanAll */}
            {showMeanAll && (
              <div>
                <span className="text-xs text-gray-500">{meanAllLabelResolved}</span>
                <p className="text-lg font-bold text-indigo-600">{fmtN(Math.round(dist.meanAll))} {unit}</p>
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
      <div className="overflow-x-auto border-t border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Диапазон</th>
              <th className="px-4 py-2 text-left text-gray-400 font-normal">Характеристика</th>
              <th className="px-4 py-2 text-right">Событий</th>
              <th className="px-4 py-2 text-right">Доля</th>
              {showSumColumn && <th className="px-4 py-2 text-right">Рен-бонусов</th>}
            </tr>
          </thead>
          <tbody>
            {/* Нулевая строка */}
            {dist.zeroCount > 0 && (
              <tr className="border-t border-gray-100 bg-amber-50/40 hover:bg-amber-50/70">
                <td className="px-4 py-2.5 font-medium text-amber-700">0 {unit}</td>
                <td className="px-4 py-2.5 text-xs text-gray-400">Нет Рен-бонусов / нулевое значение</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtN(dist.zeroCount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-amber-600 font-medium">{fmtF(zeroPct)}%</td>
                {showSumColumn && <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">0</td>}
              </tr>
            )}
            {/* Ненулевые диапазоны */}
            {dist.buckets.map((b, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">{humanLabel(b, unit)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-400">{b.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtN(b.count)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-blue-600 font-medium">{fmtF(b.pct)}%</td>
                {showSumColumn && (
                  <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600 font-medium">
                    {fmtN(b.sum)}
                  </td>
                )}
              </tr>
            ))}
            {/* ИТОГО строка (п.4/п.7) */}
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2.5 text-gray-800">ИТОГО</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtN(dist.total)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">100%</td>
              {showSumColumn && (
                <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">
                  {fmtN(totalBucketSum)}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Средние показатели Рен-бонусов ──────────────────────────────────────────
function AvgCard({ title, value, value2, sub }: {
  title: string; value: string; value2?: string; sub?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-rose-200 p-4 flex flex-col gap-0.5">
      <p className="text-xs text-rose-500 font-medium uppercase tracking-wide leading-tight">{title}</p>
      <p className="text-xl font-bold text-gray-800 mt-0.5">{value}</p>
      {value2 && <p className="text-base font-semibold text-gray-500">{value2}</p>}
      {sub && <p className="text-xs text-gray-400 mt-0.5 leading-snug">{sub}</p>}
    </div>
  )
}

function AvgBonusBlock({ totals, months }: { totals: MonthMetrics; months: MonthMetrics[] }) {
  const n = months.length
  if (n === 0) return null

  const avgBalanceWithBonus = totals.accrual_count > 0 ? totals.bonus_accrued / totals.accrual_count : 0
  const avgBalanceAll       = totals.issued_total  > 0 ? totals.bonus_accrued / totals.issued_total  : 0
  const avgAccrualPcs  = totals.accrual_count / n
  const avgAccrualRub  = totals.bonus_accrued / n
  const spendingEvents = totals.cross_total - totals.cross_base
  const avgSpendingPcs = spendingEvents / n
  const avgSpendingRub = totals.bonus_spent_total / n
  const avgDiscountPcs = totals.cross_discount / n
  const avgDiscountRb  = totals.bonus_spent_discount / n
  const avgKvPcs       = totals.cross_incr_kv   / n
  const avgKvRb        = totals.bonus_spent_kv  / n

  const tableRows = [
    {
      label: 'Баланс (партнёры с Рен-бонусами > 0)',
      total: totals.accrual_count > 0 ? `${fmtN(Math.round(avgBalanceWithBonus))} РБ` : '—',
      avg: `${fmtAvg(avgBalanceWithBonus)} РБ`,
    },
    {
      label: 'Баланс (все партнёры, вкл. баланс = 0)',
      total: totals.issued_total > 0 ? `${fmtN(Math.round(avgBalanceAll))} РБ` : '—',
      avg: `${fmtAvg(avgBalanceAll)} РБ`,
    },
    { label: 'Кол-во начислений, шт.',    total: fmtN(totals.accrual_count),                            avg: fmtAvg(avgAccrualPcs) },
    { label: 'Сумма начислений, РБ',      total: `${fmtN(Math.round(totals.bonus_accrued))} РБ`,        avg: `${fmtAvg(avgAccrualRub)} РБ` },
    { label: 'Кол-во списаний итого, шт.', total: fmtN(spendingEvents),                                  avg: fmtAvg(avgSpendingPcs) },
    { label: 'Сумма списаний итого, РБ',  total: `${fmtN(Math.round(totals.bonus_spent_total))} РБ`,    avg: `${fmtAvg(avgSpendingRub)} РБ` },
    { label: 'Кол-во списаний → скидка КВ',         total: fmtN(totals.cross_discount),                                  avg: fmtAvg(avgDiscountPcs) },
    { label: 'Сумма списаний → скидка КВ, РБ',      total: `${fmtN(Math.round(totals.bonus_spent_discount))} РБ`,       avg: `${fmtAvg(avgDiscountRb)} РБ` },
    { label: 'Кол-во списаний → повышенное КВ',      total: fmtN(totals.cross_incr_kv),                                  avg: fmtAvg(avgKvPcs) },
    { label: 'Сумма списаний → повышенное КВ, РБ',   total: `${fmtN(Math.round(totals.bonus_spent_kv))} РБ`,             avg: `${fmtAvg(avgKvRb)} РБ` },
  ]

  return (
    <div className="bg-white rounded-xl border border-rose-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-rose-100 bg-rose-50">
        <h3 className="text-sm font-bold text-rose-700 uppercase tracking-wide">Средние показатели Рен-бонусов</h3>
        <p className="text-xs text-rose-400 mt-0.5">Среднее арифметическое по {n} месяцам наблюдений</p>
      </div>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <AvgCard
          title="Ср. баланс (с бонусами)"
          value={`${fmtAvg(avgBalanceWithBonus)} РБ`}
          sub="Среди партнеров с балансом Рен-бонусов > 0"
        />
        <AvgCard
          title="Ср. баланс (все партнеры)"
          value={`${fmtAvg(avgBalanceAll)} РБ`}
          sub="Среди всех партнеров"
        />
        <AvgCard
          title="Ср. начислений / мес."
          value={`${fmtAvg(avgAccrualRub)} РБ`}
          value2={`${fmtAvg(avgAccrualPcs)} шт.`}
          sub="Событий начисления"
        />
        <AvgCard
          title="Ср. списаний итого / мес."
          value={`${fmtAvg(avgSpendingRub)} РБ`}
          value2={`${fmtAvg(avgSpendingPcs)} шт.`}
          sub="КВ или скидка"
        />
        <AvgCard
          title="Ср. списаний в скидку / мес."
          value={`${fmtAvg(avgDiscountRb)} РБ`}
          value2={`${fmtAvg(avgDiscountPcs)} шт.`}
          sub="Событий скидки КВ за месяц"
        />
        <AvgCard
          title="Ср. списаний в КВ / мес."
          value={`${fmtAvg(avgKvRb)} РБ`}
          value2={`${fmtAvg(avgKvPcs)} шт.`}
          sub="Событий повышенного КВ"
        />
      </div>
      <div className="border-t border-rose-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-rose-50 text-xs text-rose-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Показатель</th>
              <th className="px-4 py-2 text-right">Итого (за всё время)</th>
              <th className="px-4 py-2 text-right">Среднее в месяц</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {tableRows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5">{r.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{r.total}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-rose-600 font-semibold">{r.avg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────
export default function DistributionTab({ result }: Props) {
  const { rawRows, totals, months } = result
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  // Per-policy данные
  const distData = useMemo(
    () => extractDistValues(rawRows, selectedMonth),
    [rawRows, selectedMonth]
  )
  const accrualDist  = useMemo(
    () => computeDist(distData.accrualValues,  distData.accrualZeroCount),
    [distData]
  )
  // п.7: всегда показываем бакет «Выше среднего» (даже если пустой)
  const spendingDist = useMemo(
    () => computeDist(distData.spendingValues, distData.spendingZeroCount, ['Выше среднего']),
    [distData]
  )

  // Per-partner данные
  const partnerAccrualData = useMemo(
    () => extractPartnerAccrualValues(rawRows, selectedMonth),
    [rawRows, selectedMonth]
  )
  // п.6: всегда показываем бакет «Ниже среднего» (даже если пустой)
  const partnerAccrualDist = useMemo(
    () => computeDist(partnerAccrualData.values, partnerAccrualData.zeroCount, ['Ниже среднего']),
    [partnerAccrualData]
  )

  const partnerSpendingData = useMemo(
    () => extractPartnerSpendingValues(rawRows, selectedMonth),
    [rawRows, selectedMonth]
  )
  // п.6: всегда показываем бакет «Ниже среднего» (даже если пустой)
  const partnerSpendingDist = useMemo(
    () => computeDist(partnerSpendingData.values, partnerSpendingData.zeroCount, ['Ниже среднего']),
    [partnerSpendingData]
  )

  return (
    <div className="space-y-6">

      {/* Средние показатели Рен-бонусов — вверху */}
      <AvgBonusBlock totals={totals} months={months} />

      {/* Пояснение */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>Как читать таблицы распределения.</strong>&nbsp;
        Диапазоны строятся от 0 и выше вокруг среднего значения (±σ).
        Строки с нулевым значением выделены отдельно. Пустые срезы скрыты.
      </div>

      {/* Фильтр по периоду */}
      <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
        <span className="text-sm text-gray-600 font-medium shrink-0">Период:</span>
        <select
          value={selectedMonth ?? ''}
          onChange={e => setSelectedMonth(e.target.value || null)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">Все периоды</option>
          {months.map(m => (
            <option key={m.sortKey} value={m.sortKey}>{m.label}</option>
          ))}
        </select>
        {selectedMonth && (
          <button
            onClick={() => setSelectedMonth(null)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            ✕ сбросить
          </button>
        )}
      </div>

      {/* ── В разрезе партнёров ── */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">В разрезе партнёров</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* п.6 (был п.6 в чередовании): начисления в разрезе партнёров */}
      <DistBlock
        title="Накопленный баланс Рен-бонусов: в разрезе партнёров"
        subtitle="Каждое событие = 1 партнёр (RenId). Значение = суммарные начисленные Рен-бонусы (LoyaltyPointsInLK) по всем его оформленным полисам."
        dist={partnerAccrualDist}
        unit="Рен-бонусов"
        hideZeroChip
        showSumColumn
        showMeanAll
        meanNonZeroLabel="Средние накопления партнера (не включая нулевые)"
        meanAllLabel="Средние накопления партнера (включая нулевые)"
      />

      {/* п.8 (был п.8): списания в разрезе партнёров */}
      <DistBlock
        title="Суммарные списания Рен-бонусов: в разрезе партнёров"
        subtitle="Каждое событие = 1 партнёр (RenId). Значение = суммарные списанные Рен-бонусы по всем его полисам Кросс-Каско."
        dist={partnerSpendingDist}
        unit="Рен-бонусов"
        hideZeroChip
        showSumColumn
        meanNonZeroLabel="В среднем списал 1 партнёр"
      />

      {/* ── В разрезе полисов ── */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">В разрезе полисов</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* п.5: Распределение начислений по полису ОСАГО ФЛ */}
      <DistBlock
        title="Распределение поступивших Рен-бонусов в оформленных полисах ОСАГО ФЛ"
        subtitle="Оформленные полисы (State = PolicyIssued). Каждое событие = 1 полис. Значение = LoyaltyPointsInLK."
        dist={accrualDist}
        unit="Рен-бонусов"
        hideZeroChip
        showSumColumn
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
        showSumColumn
        meanNonZeroLabel="Среднее списание на полис Каско от бесполисных"
      />

    </div>
  )
}
