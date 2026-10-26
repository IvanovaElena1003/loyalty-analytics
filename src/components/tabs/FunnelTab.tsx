import { Fragment, useState, useMemo } from 'react'
import type { AggregateResult, MonthMetrics } from '../../types'
import {
  pct,
  aggregateFunnelPeriods,
  type FunnelGranularity,
} from '../../utils/aggregate'
import CrossCompositionChart from '../charts/CrossCompositionChart'

// ─── Column spec ──────────────────────────────────────────────────────────────
interface ColSpec {
  key: string
  header: string
  subLabel?: string       // "1–16 апр" for partial months
  metrics: MonthMetrics
  prev?: MonthMetrics     // previous column — for trend arrows
  isTotal: boolean
  isYearSummary: boolean
}

// ─── Row definitions ──────────────────────────────────────────────────────────
type RowKind = 'section' | 'data' | 'sub' | 'sep'
interface RowDef {
  kind: RowKind
  label: string
  getPct?: (m: MonthMetrics) => number | null
  getCount?: (m: MonthMetrics) => number
  getBig?: (m: MonthMetrics) => number
  higherIsBetter?: boolean  // undefined → no trend arrow
  hl?: 'blue' | 'green' | 'amber'
  decimals?: number          // знаков после запятой в % (по умолчанию 0)
  highlight?: boolean        // ключевая строка — выделяется визуально
}

const ROWS: RowDef[] = [
  { kind: 'section', label: 'Котировки ОСАГО ФЛ' },
  { kind: 'data', label: 'Котировок ВСЕГО',      getCount: m => m.total_quotes, hl: 'blue' },
  { kind: 'sub',  label: '— без Рен-бонусов',   getCount: m => m.quotes_no_bonus,   getPct: m => pct(m.quotes_no_bonus,   m.total_quotes), higherIsBetter: false },
  { kind: 'sub',  label: '— с Рен-бонусами',    getCount: m => m.quotes_with_bonus, getPct: m => pct(m.quotes_with_bonus, m.total_quotes), hl: 'blue', higherIsBetter: true },
  { kind: 'sep', label: '' },

  { kind: 'section', label: 'Оформление ОСАГО ФЛ' },
  { kind: 'data',  label: 'Оформлено ВСЕГО',    getCount: m => m.issued_total,    getPct: m => m.conversion,                              hl: 'blue',  higherIsBetter: true },
  { kind: 'sub',   label: '— без Рен-бонусов',  getCount: m => m.issued_no_bonus,  getPct: m => pct(m.issued_no_bonus,  m.issued_total),   higherIsBetter: false },
  { kind: 'sub',   label: '— с Рен-бонусами',   getCount: m => m.issued_with_bonus, getPct: m => pct(m.issued_with_bonus, m.issued_total), hl: 'green', higherIsBetter: true },
  { kind: 'sep', label: '' },

  { kind: 'section', label: 'Кросс-Каско от бесполисных' },
  { kind: 'data', label: 'Оформлен Кросс-Каско ВСЕГО', getCount: m => m.cross_total, getPct: m => m.conv_cross, hl: 'blue', higherIsBetter: true, decimals: 1, highlight: true },
  { kind: 'sep', label: '' },

  { kind: 'section', label: 'Из чего состоит Кросс-Каско' },
  { kind: 'sub', label: '% Базовый «Каско от бесполисных»', getCount: m => m.cross_base,     getPct: m => pct(m.cross_base,     m.cross_total), higherIsBetter: false },
  { kind: 'sub', label: '% Скидка (Рен-бонусы)',            getCount: m => m.cross_discount,  getPct: m => pct(m.cross_discount,  m.cross_total), hl: 'amber', higherIsBetter: true },
  { kind: 'sub', label: '% Повышенное КВ',                  getCount: m => m.cross_incr_kv,   getPct: m => pct(m.cross_incr_kv,   m.cross_total), hl: 'green', higherIsBetter: true },
  { kind: 'sep', label: '' },

  { kind: 'section', label: 'Рен-бонусы' },
  { kind: 'data', label: 'Кол-во начислений (событий)',      getCount: m => m.accrual_count },
  { kind: 'data', label: 'Всего начислено бонусов',          getBig: m => m.bonus_accrued },
  { kind: 'data', label: 'Всего списано бонусов',            getBig: m => m.bonus_spent_total, getPct: m => pct(m.bonus_spent_total, m.bonus_accrued) },
  { kind: 'sub',  label: '— в скидку Кросс-Каско',          getBig: m => m.bonus_spent_discount, getPct: m => pct(m.bonus_spent_discount, m.bonus_spent_total) },
  { kind: 'sub',  label: '— в повышенное КВ Кросс-Каско',   getBig: m => m.bonus_spent_kv,       getPct: m => pct(m.bonus_spent_kv,       m.bonus_spent_total) },
]

/** Верхняя воронка: до блока «Из чего состоит Кросс-Каско» */
const ROWS_FUNNEL_MAIN = ROWS.slice(0, ROWS.findIndex(r => r.kind === 'section' && r.label === 'Из чего состоит Кросс-Каско'))

const idxCrossComposition = ROWS.findIndex(r => r.kind === 'section' && r.label === 'Из чего состоит Кросс-Каско')
const idxBonuses = ROWS.findIndex(r => r.kind === 'section' && r.label === 'Рен-бонусы')

/** Состав кросса (таблица + график) */
const ROWS_CROSS_COMPOSITION = ROWS.slice(idxCrossComposition, idxBonuses)

/** Рен-бонусы — отдельный блок ниже */
const ROWS_BONUSES = ROWS.slice(idxBonuses)

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtN = (v: number) => v.toLocaleString('ru-RU')
const fmtBig = (v: number) =>
  v >= 1_000_000 ? (v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн'
  : v >= 1_000   ? (v / 1_000).toLocaleString('ru-RU',     { maximumFractionDigits: 1 }) + ' тыс'
  : fmtN(v)


function partialLabel(m: MonthMetrics): string | undefined {
  if (!m.min_date || !m.max_date) return undefined
  const mn = new Date(m.min_date + 'T12:00:00')
  const mx = new Date(m.max_date + 'T12:00:00')
  const lastDay = new Date(mn.getFullYear(), mn.getMonth() + 1, 0).getDate()
  if (mn.getDate() === 1 && mx.getDate() === lastDay) return undefined
  const moRu = mx.toLocaleString('ru-RU', { month: 'short' })
  return `${mn.getDate()}–${mx.getDate()} ${moRu}`
}

// ─── Main component ───────────────────────────────────────────────────────────
const GRANULARITY_LABEL: Record<FunnelGranularity, string> = {
  month: 'Месяцы',
  week: 'Недели',
  day: 'Дни',
}

function monthOptionLabel(sortKey: string): string {
  const [y, mo] = sortKey.split('-').map(Number)
  const d = new Date(y, mo - 1, 1)
  return d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
}

export default function FunnelTab({ result }: { result: AggregateResult }) {
  const { months: monthsAll, rawRows } = result

  const [granularity, setGranularity] = useState<FunnelGranularity>('month')
  const monthKeys = useMemo(
    () => monthsAll.map(m => m.sortKey),
    [monthsAll],
  )
  const [scopeMonth, setScopeMonth] = useState<string>(() => monthKeys[monthKeys.length - 1] ?? '')

  const periods = useMemo(() => {
    if (granularity === 'month') {
      return monthsAll
    }
    const scope = scopeMonth || monthKeys[monthKeys.length - 1]
    return aggregateFunnelPeriods(rawRows, granularity, scope).periods
  }, [granularity, monthsAll, rawRows, scopeMonth, monthKeys])

  // Build visible column list (месяцы всегда по отдельности, без свёртки «год»)
  const cols = useMemo<ColSpec[]>(() => {
    const out: ColSpec[] = []
    let prev: MonthMetrics | undefined

    if (granularity === 'month') {
      for (const m of periods) {
        out.push({
          key: m.sortKey,
          header: m.label,
          subLabel: partialLabel(m),
          metrics: m,
          prev,
          isTotal: false,
          isYearSummary: false,
        })
        prev = m
      }
    } else {
      for (const m of periods) {
        const sub = granularity === 'week' && m.min_date && m.max_date && m.min_date !== m.max_date
          ? `${m.min_date.slice(8)}–${m.max_date.slice(8)}.${m.max_date.slice(5, 7)}`
          : undefined
        out.push({
          key: m.sortKey,
          header: m.label,
          subLabel: sub,
          metrics: m,
          prev,
          isTotal: false,
          isYearSummary: false,
        })
        prev = m
      }
    }

    return out
  }, [granularity, periods])

  const chartMonths = useMemo(
    () => cols.map(c => c.metrics),
    [cols],
  )

  // ─── cell background helpers ──────────────────────────────────────────────
  function stickyBg(col: ColSpec) {
    return col.isYearSummary ? 'bg-[var(--bg-brand-primary-00)]' : 'bg-[var(--bg-bg-secondary)]'
  }
  function dataBg(col: ColSpec) {
    return col.isYearSummary ? 'bg-[var(--bg-brand-primary-00)]/40' : ''
  }
  function colBorder(col: ColSpec) {
    return col.isYearSummary ? 'border-l border-[var(--stroke-divider)]' : ''
  }

  function renderFunnelTable(tableRows: RowDef[], maxHeight?: string) {
    return (
      <div className="overflow-auto" style={{ maxHeight: maxHeight ?? undefined }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[272px] border-b border-gray-200">
                Метрика
              </th>
              {cols.map(col => (
                <th key={col.key} colSpan={2}
                  className={`sticky top-0 z-20 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide border-b border-gray-200 whitespace-nowrap ${stickyBg(col)} ${colBorder(col)}`}>
                  <div className={col.isYearSummary ? 'ren-text-brand' : 'ren-text-secondary'}>
                    {col.header}
                  </div>
                  {col.subLabel && (
                    <div className="text-[9px] font-normal normal-case text-orange-500 mt-0.5">
                      {col.subLabel}
                    </div>
                  )}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky top-[40px] left-0 z-30 bg-gray-50 border-b-2 border-gray-200" />
              {cols.map(col => (
                <Fragment key={col.key}>
                  <th
                    className={`sticky top-[40px] z-20 px-3 py-1.5 text-right text-[10px] font-medium text-gray-400 w-20 border-b-2 border-gray-200 ${stickyBg(col)}`}>
                    кол-во
                  </th>
                  <th
                    className={`sticky top-[40px] z-20 px-2 py-1.5 text-center text-[10px] font-medium text-gray-400 w-16 border-b-2 border-gray-200 ${stickyBg(col)} ${colBorder(col)}`}>
                    %
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, ri) => {
              if (row.kind === 'sep') return (
                <tr key={`sp${ri}`}>
                  <td colSpan={1 + cols.length * 2} className="h-px bg-gray-200" />
                </tr>
              )

              if (row.kind === 'section') return (
                <tr key={`sc${ri}`} className="border-t-2 border-yellow-200">
                  <td className="sticky left-0 z-10 bg-yellow-50 px-4 py-2 text-xs font-bold text-yellow-800 uppercase tracking-wider">
                    {row.label}
                  </td>
                  {cols.map(col => (
                    <Fragment key={col.key}>
                      <td className={`bg-yellow-50 ${colBorder(col)}`} />
                      <td className={`bg-yellow-50 ${colBorder(col)}`} />
                    </Fragment>
                  ))}
                </tr>
              )

              const isIndent = row.kind === 'sub'
              const isTotalRow = row.kind === 'data'
              const isHighlight = !!row.highlight
              const pctCls = 'ren-text-brand font-semibold'

              return (
                <tr key={`dr${ri}`} className={`group transition-colors
                  ${isHighlight
                    ? 'border-t-2 border-b-2 border-amber-300 bg-amber-50/50 hover:bg-amber-50/80'
                    : 'border-t border-gray-100 hover:bg-gray-50/80'}`}>
                  <td
                    className={`sticky left-0 z-10 transition-colors px-4 py-2.5
                      ${isHighlight
                        ? 'bg-amber-50 group-hover:bg-amber-50/90 text-amber-900 font-bold'
                        : 'bg-white group-hover:bg-gray-50/80 text-gray-700'}
                      ${isIndent ? 'pl-8 text-xs text-gray-500' : 'font-medium'}
                      ${isTotalRow && !isHighlight ? 'font-medium' : ''}`}>
                    {row.label}
                  </td>

                  {cols.map(col => {
                    const m = col.metrics
                    const cnt = row.getCount ? row.getCount(m) : null
                    const big = row.getBig ? row.getBig(m) : null
                    const pctVal = row.getPct ? row.getPct(m) : null

                    const bg = isHighlight ? 'bg-amber-50/40' : isTotalRow ? stickyBg(col) : dataBg(col)
                    const bl = colBorder(col)
                    const fw = isHighlight ? 'font-semibold' : ''

                    return (
                      <Fragment key={col.key}>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-gray-700 ${bg} ${fw}`}>
                          {big != null ? fmtBig(big)
                            : cnt != null ? fmtN(cnt)
                              : <span className="text-gray-300">—</span>}
                        </td>
                        <td className={`px-2 py-2.5 text-center tabular-nums ${bg} ${bl}`}>
                          {pctVal != null ? (
                            <span className={pctCls}>
                              {row.decimals === 1 ? pctVal.toFixed(1) : Math.round(pctVal)}%
                            </span>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-6">
    <div className="ren-card">

      {/* ── Granularity + scope ───────────────────────────────────────────── */}
      <div className="ren-card__header border-b border-[var(--stroke-divider)] px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs ren-text-secondary font-medium shrink-0">Шаг:</span>
        <div className="ren-segmented">
          {(['month', 'week', 'day'] as FunnelGranularity[]).map(g => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`ren-segmented__btn text-xs ${granularity === g ? 'ren-segmented__btn--active' : ''}`}
            >
              {GRANULARITY_LABEL[g]}
            </button>
          ))}
        </div>

        {granularity !== 'month' && (
          <>
            <span className="text-xs ren-text-secondary font-medium shrink-0">Месяц:</span>
            <select
              className="ren-select text-xs py-1.5"
              value={scopeMonth || monthKeys[monthKeys.length - 1]}
              onChange={e => setScopeMonth(e.target.value)}
            >
              {[...monthKeys].reverse().map(k => (
                <option key={k} value={k}>{monthOptionLabel(k)}</option>
              ))}
            </select>
            <span className="text-[11px] ren-text-secondary">
              {granularity === 'day'
                ? 'Колонки = календарные дни выбранного месяца.'
                : 'Колонки = недели (пн–вс) выбранного месяца.'}
            </span>
          </>
        )}

      </div>

      {renderFunnelTable(ROWS_FUNNEL_MAIN, 'calc(100vh - 200px)')}
    </div>

    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)]">
        <h3 className="ren-card__title text-sm">
          Из чего состоит Кросс-Каско
          {granularity !== 'month' && scopeMonth ? ` · ${monthOptionLabel(scopeMonth)}` : ''}
        </h3>
      </div>
      {renderFunnelTable(ROWS_CROSS_COMPOSITION)}
      <div className="ren-card__body border-t border-[var(--stroke-divider)]">
        <h3 className="ren-card__title text-sm mb-4">
          Состав Кросс-Каско
          {granularity === 'month' ? ' по месяцам' : granularity === 'week' ? ' по неделям' : ' по дням'}
          {granularity !== 'month' && scopeMonth ? ` (${monthOptionLabel(scopeMonth)})` : ''}
        </h3>
        <CrossCompositionChart months={chartMonths} />
      </div>
    </div>

    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)]">
        <h3 className="ren-card__title text-sm">Рен-бонусы</h3>
      </div>
      {renderFunnelTable(ROWS_BONUSES)}
    </div>
    </div>
  )
}
