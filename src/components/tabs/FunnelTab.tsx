import { Fragment, useState, useMemo } from 'react'
import type { AggregateResult, MonthMetrics } from '../../types'
import { pct, mergeMetrics } from '../../utils/aggregate'
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
  { kind: 'data',  label: 'Оформлен Кросс-Каско ВСЕГО', getCount: m => m.cross_total,      getPct: m => m.conv_cross,    hl: 'blue',  higherIsBetter: true, decimals: 1 },
  { kind: 'sub',   label: '— без Рен-бонусов',          getCount: m => m.cross_no_bonus,   getPct: m => m.conv_cross_nb, higherIsBetter: true, decimals: 1 },
  { kind: 'sub',   label: '— с Рен-бонусами',           getCount: m => m.cross_with_bonus, getPct: m => m.conv_cross_wb, hl: 'green', higherIsBetter: true, decimals: 1 },
  { kind: 'sep', label: '' },

  { kind: 'section', label: 'Из чего состоит Кросс-Каско' },
  { kind: 'sub', label: '% Базовый «Каско от бесполисных»', getCount: m => m.cross_base,     getPct: m => pct(m.cross_base,     m.cross_total), higherIsBetter: false },
  { kind: 'sub', label: '% Скидка (Рен-бонусы)',            getCount: m => m.cross_discount,  getPct: m => pct(m.cross_discount,  m.cross_total), hl: 'amber', higherIsBetter: true },
  { kind: 'sub', label: '% Повышенное КВ (NEW)',            getCount: m => m.cross_incr_kv,   getPct: m => pct(m.cross_incr_kv,   m.cross_total), hl: 'green', higherIsBetter: true },
  { kind: 'sep', label: '' },

  { kind: 'section', label: 'Рен-бонусы' },
  { kind: 'data', label: 'Всего начислено бонусов',         getCount: m => m.bonus_accrued },
  { kind: 'data', label: 'Всего списано бонусов',           getCount: m => m.bonus_spent_total, getPct: m => pct(m.bonus_spent_total, m.bonus_accrued) },
  { kind: 'sub',  label: '— в скидку Кросс-Каско',         getBig: m => m.bonus_spent_discount, getPct: m => pct(m.bonus_spent_discount, m.bonus_spent_total) },
  { kind: 'sub',  label: '— в повышенное КВ Кросс-Каско',  getBig: m => m.bonus_spent_kv,       getPct: m => pct(m.bonus_spent_kv,       m.bonus_spent_total) },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtN = (v: number) => v.toLocaleString('ru-RU')
const fmtBig = (v: number) =>
  v >= 1_000_000 ? (v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн'
  : v >= 1_000   ? (v / 1_000).toLocaleString('ru-RU',     { maximumFractionDigits: 1 }) + ' тыс'
  : fmtN(v)


function calcTrend(cur: number | null, prev: number | null, higher: boolean): 'better' | 'worse' | null {
  if (cur == null || prev == null) return null
  const d = cur - prev
  if (Math.abs(d) < 0.4) return null
  return (d > 0) === higher ? 'better' : 'worse'
}

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
export default function FunnelTab({ result }: { result: AggregateResult }) {
  const { months, totals } = result

  const years = useMemo(() =>
    [...new Set(months.map(m => m.sortKey.slice(0, 4)))].sort(), [months])

  const byYear = useMemo(() => {
    const map = new Map<string, MonthMetrics[]>()
    for (const m of months) {
      const yr = m.sortKey.slice(0, 4)
      if (!map.has(yr)) map.set(yr, [])
      map.get(yr)!.push(m)
    }
    return map
  }, [months])

  // 2025 starts collapsed by default
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(years.filter(y => y === '2025'))
  )

  const toggle = (yr: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(yr) ? n.delete(yr) : n.add(yr); return n })

  // Build visible column list
  const cols = useMemo<ColSpec[]>(() => {
    const out: ColSpec[] = []
    let prev: MonthMetrics | undefined
    for (const yr of years) {
      const yMonths = byYear.get(yr) ?? []
      if (collapsed.has(yr)) {
        const merged = mergeMetrics(yMonths, yr, yr + '-99')
        out.push({ key: `yr-${yr}`, header: yr, metrics: merged, prev, isTotal: false, isYearSummary: true })
        prev = merged
      } else {
        for (const m of yMonths) {
          out.push({ key: m.sortKey, header: m.label, subLabel: partialLabel(m), metrics: m, prev, isTotal: false, isYearSummary: false })
          prev = m
        }
      }
    }
    out.push({ key: 'total', header: 'Итого', metrics: totals, isTotal: true, isYearSummary: false })
    return out
  }, [years, byYear, collapsed, totals])

  // ─── cell background helpers ──────────────────────────────────────────────
  // stickyBg: для STICKY ячеек — всегда непрозрачный фон, чтобы не просвечивал контент
  function stickyBg(col: ColSpec) {
    return col.isTotal ? 'bg-blue-50' : col.isYearSummary ? 'bg-violet-50' : 'bg-gray-50'
  }
  // dataBg: для обычных (не sticky) ячеек данных — регулярные месяцы прозрачны (hover от <tr>)
  function dataBg(col: ColSpec) {
    return col.isTotal ? 'bg-blue-50' : col.isYearSummary ? 'bg-violet-50/40' : ''
  }
  function colBorder(col: ColSpec) {
    return col.isTotal ? 'border-l-2 border-blue-200' : col.isYearSummary ? 'border-l border-violet-200' : ''
  }

  return (
    <div className="space-y-6">
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

      {/* ── Year toggle bar ─────────────────────────────────────────────────── */}
      <div className="border-b border-gray-100 px-4 py-2.5 flex items-center gap-2 flex-wrap bg-gray-50 rounded-t-xl">
        <span className="text-xs text-gray-400 font-medium mr-1">Периоды:</span>
        {years.map(yr => {
          const isCollapsed = collapsed.has(yr)
          const count = byYear.get(yr)?.length ?? 0
          return (
            <button key={yr} onClick={() => toggle(yr)}
              title={isCollapsed ? `Развернуть ${yr}` : `Свернуть ${yr}`}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                isCollapsed
                  ? 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'
                  : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
              }`}>
              <span className="text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
              {yr} <span className="text-gray-400 font-normal">({count} мес.)</span>
            </button>
          )
        })}
      </div>

      {/* ── Table — единый контейнер прокрутки (x+y), thead sticky top:0 ── */}
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        <table className="w-full text-sm border-collapse">

          <thead>
            {/* Row 1: month / year / total headers */}
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[272px] border-b border-gray-200">
                Метрика
              </th>
              {cols.map(col => (
                <th key={col.key} colSpan={2}
                  className={`sticky top-0 z-20 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide border-b border-gray-200 whitespace-nowrap ${stickyBg(col)} ${colBorder(col)}`}>
                  <div className={col.isTotal ? 'text-blue-700' : col.isYearSummary ? 'text-violet-700' : 'text-gray-600'}>
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

            {/* Row 2: кол-во | % sub-headers */}
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
            {ROWS.map((row, ri) => {

              // ── Separator ──────────────────────────────────────────────────
              if (row.kind === 'sep') return (
                <tr key={`sp${ri}`}>
                  <td colSpan={1 + cols.length * 2} className="h-px bg-gray-200" />
                </tr>
              )

              // ── Section header ──────────────────────────────────────────────
              // Только sticky left-0 (горизонт.) — вертикальный sticky убран,
              // иначе заголовок секции перекрывает строки данных при прокрутке
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

              // ── Data row ───────────────────────────────────────────────────
              const isIndent = row.kind === 'sub'
              // 'data' rows = строки «ВСЕГО» — делаем sticky под заголовком секции
              const isTotalRow = row.kind === 'data'
              const pctCls = 'text-blue-700 font-semibold'

              return (
                <tr key={`dr${ri}`} className="group border-t border-gray-100 hover:bg-gray-50/80 transition-colors">

                  {/* Label — sticky left only (вертикальный sticky убран — он перекрывал sub-строки) */}
                  <td
                    className={`sticky left-0 z-10 bg-white group-hover:bg-gray-50/80 transition-colors px-4 py-2.5 text-gray-700
                      ${isIndent ? 'pl-8 text-xs text-gray-500' : 'font-medium'}
                      ${isTotalRow ? 'font-medium' : ''}`}>
                    {row.label}
                  </td>

                  {cols.map(col => {
                    const m = col.metrics
                    const cnt = row.getCount ? row.getCount(m) : null
                    const big = row.getBig   ? row.getBig(m)   : null
                    const pctVal = row.getPct ? row.getPct(m)  : null

                    const tr = (col.prev && row.higherIsBetter != null && pctVal != null)
                      ? calcTrend(pctVal, row.getPct!(col.prev), row.higherIsBetter)
                      : null

                    const bg = isTotalRow ? stickyBg(col) : dataBg(col)
                    const bl = colBorder(col)
                    const fw = col.isTotal ? 'font-semibold' : ''

                    return (
                      <Fragment key={col.key}>
                        {/* кол-во */}
                        <td className={`px-3 py-2.5 text-right tabular-nums text-gray-700 ${bg} ${fw}`}>
                          {big  != null ? fmtBig(big)
                           : cnt != null ? fmtN(cnt)
                           : <span className="text-gray-300">—</span>}
                        </td>

                        {/* % с трендом */}
                        <td className={`px-2 py-2.5 text-center tabular-nums ${bg} ${bl}`}>
                          {pctVal != null ? (
                            <span className="inline-flex items-center justify-center gap-0.5">
                              <span className={pctCls}>
                                {row.decimals === 1 ? pctVal.toFixed(1) : Math.round(pctVal)}%
                              </span>
                              {tr === 'better' && <span className="text-emerald-500 text-[11px] leading-none font-bold">↑</span>}
                              {tr === 'worse'  && <span className="text-red-500    text-[11px] leading-none font-bold">↓</span>}
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
    </div>

    {/* ── Состав Кросс-Каско по месяцам ───────────────────────────────── */}
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-600 mb-4">Состав Кросс-Каско по месяцам</h3>
      <CrossCompositionChart months={months} />
    </div>
    </div>
  )
}
