import { useMemo } from 'react'
import * as XLSX from 'xlsx'
import type { RawRow } from '../../types'

// ─── Колонки для проверки «все нули» (Секция 2) ──────────────────────────────
const ZERO_COLS = [
  '2300', '2100', '1700', '1300', '1000',
  'IncreasedKV 1490', 'IncreasedKV 1190', 'IncreasedKV 790',
  'IncreasedKV 390', 'IncreasedKV 190',
]

// Строки с 01.03.2026 для Секции 1
const CUTOFF = new Date(2026, 2, 1) // March 1, 2026

// ─── Вспомогательные функции ─────────────────────────────────────────────────
function isNullVal(v: unknown): boolean {
  return v == null || v === '[NULL]' || v === ''
}

function toNum(v: unknown): number {
  if (isNullVal(v)) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function parseDate(v: unknown): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date((v - 25569) * 86400000)
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
  return null
}

function mKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mLabel(d: Date) {
  return d
    .toLocaleString('ru-RU', { month: 'short', year: 'numeric' })
    .replace(/^./, c => c.toUpperCase())
}

// ─── Секция 1: аномалия LoyaltyPointsScoring vs LoyaltyPointsInLK ───────────
function anomalyNote(row: RawRow): string | null {
  if (isNullVal(row.LoyaltyPointsScoring) && isNullVal(row.LoyaltyPointsInLK)) return null
  const sc = toNum(row.LoyaltyPointsScoring)
  const lk = toNum(row.LoyaltyPointsInLK)
  const expected = Math.floor(sc)
  const diff = Math.abs(lk - expected)
  if (diff > 0.5) {
    return `Scoring=${sc}, InLK=${lk}, ожидалось=${expected}, расхождение=${diff.toFixed(2)}`
  }
  return null
}

// ─── Секция 2: все 10 ценовых колонок = 0 ───────────────────────────────────
function allZero(row: RawRow): boolean {
  return ZERO_COLS.every(col => toNum(row[col]) === 0)
}

// ─── Excel download ──────────────────────────────────────────────────────────
function downloadXlsx(rows: RawRow[], filename: string) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows as Record<string, unknown>[])
  XLSX.utils.book_append_sheet(wb, ws, 'Строки')
  XLSX.writeFile(wb, filename)
}

function downloadAnomalyRows(rows: RawRow[], notes: Map<RawRow, string>, filename: string) {
  const data = rows.map(r => ({
    ...(r as Record<string, unknown>),
    __Аномалия: notes.get(r) ?? '',
  }))
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, 'Аномалии')
  XLSX.writeFile(wb, filename)
}

// ─── Форматирование ──────────────────────────────────────────────────────────
const fmtN = (n: number) => n.toLocaleString('ru-RU')
const fmtPct = (n: number, d: number) =>
  d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—'

// ─── Props ───────────────────────────────────────────────────────────────────
interface Props { rawRows: RawRow[] }

export default function AnomaliesTab({ rawRows }: Props) {

  // ── Секция 1: LoyaltyPointsScoring vs LoyaltyPointsInLK ─────────────────
  const loyaltyData = useMemo(() => {
    const noteMap = new Map<RawRow, string>()

    const byMonth = new Map<string, {
      label: string
      total: RawRow[]
      anomaly: RawRow[]
    }>()

    for (const row of rawRows) {
      const date = parseDate(row.CreateDate)
      if (!date || date < CUTOFF) continue

      const key = mKey(date)
      if (!byMonth.has(key)) byMonth.set(key, { label: mLabel(date), total: [], anomaly: [] })
      const bucket = byMonth.get(key)!
      bucket.total.push(row)

      const note = anomalyNote(row)
      if (note) {
        bucket.anomaly.push(row)
        noteMap.set(row, note)
      }
    }

    const months = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, ...v }))

    const totalAll = months.reduce((s, m) => s + m.total.length, 0)
    const allAnomalyRows = months.flatMap(m => m.anomaly)

    return { months, totalAll, allAnomalyRows, noteMap }
  }, [rawRows])

  // ── Секция 2: все нули в ценовых колонках (State × Month) ───────────────
  const zeroData = useMemo(() => {
    // Сначала считаем ОБЩЕЕ кол-во строк по (state, month) — для знаменателя доли
    const totalByStateMonth = new Map<string, Map<string, number>>() // state → monthKey → count
    const totalByState      = new Map<string, number>()              // state → total
    const totalByMonth      = new Map<string, number>()              // monthKey → total
    let grandTotalAll = 0

    const monthLabels = new Map<string, string>() // monthKey → label
    const stateSet    = new Set<string>()

    for (const row of rawRows) {
      const date = parseDate(row.CreateDate)
      if (!date) continue
      const key   = mKey(date)
      const state = String(row.State ?? 'Unknown')
      stateSet.add(state)
      if (!monthLabels.has(key)) monthLabels.set(key, mLabel(date))

      if (!totalByStateMonth.has(state)) totalByStateMonth.set(state, new Map())
      const sm = totalByStateMonth.get(state)!
      sm.set(key, (sm.get(key) ?? 0) + 1)

      totalByState.set(state, (totalByState.get(state) ?? 0) + 1)
      totalByMonth.set(key,   (totalByMonth.get(key)   ?? 0) + 1)
      grandTotalAll++
    }

    // Строки где все нули — по (state, month)
    const zeroByStateMonth = new Map<string, Map<string, RawRow[]>>() // state → monthKey → rows
    const zeroByState      = new Map<string, RawRow[]>()              // state → rows
    const zeroByMonth      = new Map<string, RawRow[]>()              // monthKey → rows
    let   zeroAllRows: RawRow[] = []

    for (const row of rawRows) {
      if (!allZero(row)) continue
      const date = parseDate(row.CreateDate)
      if (!date) continue
      const key   = mKey(date)
      const state = String(row.State ?? 'Unknown')

      if (!zeroByStateMonth.has(state)) zeroByStateMonth.set(state, new Map())
      const sm = zeroByStateMonth.get(state)!
      if (!sm.has(key)) sm.set(key, [])
      sm.get(key)!.push(row)

      if (!zeroByState.has(state)) zeroByState.set(state, [])
      zeroByState.get(state)!.push(row)

      if (!zeroByMonth.has(key)) zeroByMonth.set(key, [])
      zeroByMonth.get(key)!.push(row)

      zeroAllRows.push(row)
    }

    // Упорядоченные списки
    const states = Array.from(stateSet).sort((a, b) => {
      if (a === 'PolicyIssued') return -1
      if (b === 'PolicyIssued') return 1
      return a.localeCompare(b)
    })
    const months = Array.from(monthLabels.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, label]) => ({ key, label }))

    // Проверяем, нашлись ли ценовые колонки в данных
    const foundCols = rawRows.length > 0
      ? ZERO_COLS.filter(col => rawRows.some(r => r[col] !== undefined))
      : []

    return {
      states, months,
      totalByStateMonth, totalByState, totalByMonth, grandTotalAll,
      zeroByStateMonth, zeroByState, zeroByMonth, zeroAllRows,
      foundCols,
    }
  }, [rawRows])

  return (
    <div className="space-y-8">

      {/* ── Секция 1 ── */}
      <div className="bg-white rounded-xl border border-orange-200 overflow-hidden">
        <div className="px-5 py-4 bg-orange-50 border-b border-orange-200">
          <h2 className="font-bold text-orange-800 text-base">
            Аномалии: LoyaltyPointsScoring vs LoyaltyPointsInLK
          </h2>
          <p className="text-xs text-orange-600 mt-1">
            Строки с <strong>CreateDate ≥ 01.03.2026</strong>, где{' '}
            <code className="bg-orange-100 px-1 rounded">LoyaltyPointsInLK ≠ floor(LoyaltyPointsScoring)</code>.
            Ожидаемое поведение: InLK = целая часть Scoring (дробная обрезается).
            Нажмите на число аномалий — скачается xlsx со столбцом «Аномалия».
          </p>
        </div>

        {loyaltyData.months.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Нет строк с CreateDate ≥ 01.03.2026
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <tr>
                <th className="px-4 py-2.5 text-left">Месяц</th>
                <th className="px-4 py-2.5 text-right">Строк всего</th>
                <th className="px-4 py-2.5 text-right">Аномалий</th>
                <th className="px-4 py-2.5 text-right">% аномалий</th>
              </tr>
            </thead>
            <tbody>
              {loyaltyData.months.map(m => {
                const hasAnom = m.anomaly.length > 0
                return (
                  <tr key={m.key} className="border-t border-gray-100 hover:bg-orange-50/30 transition-colors">
                    <td className="px-4 py-2.5 text-gray-700">{m.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {fmtN(m.total.length)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {hasAnom ? (
                        <button
                          onClick={() => downloadAnomalyRows(m.anomaly, loyaltyData.noteMap, `anomaly_loyalty_${m.key}.xlsx`)}
                          className="font-semibold text-red-600 hover:text-red-800 hover:underline inline-flex items-center gap-1"
                          title="Скачать строки с аномалией"
                        >
                          {fmtN(m.anomaly.length)}
                          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-normal">↓ xlsx</span>
                        </button>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {fmtPct(m.anomaly.length, m.total.length)}
                    </td>
                  </tr>
                )
              })}

              <tr className="border-t-2 border-orange-300 bg-orange-50 font-semibold">
                <td className="px-4 py-2.5 text-orange-800">ИТОГО</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtN(loyaltyData.totalAll)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {loyaltyData.allAnomalyRows.length > 0 ? (
                    <button
                      onClick={() => downloadAnomalyRows(loyaltyData.allAnomalyRows, loyaltyData.noteMap, 'anomaly_loyalty_all.xlsx')}
                      className="text-red-600 hover:text-red-800 hover:underline inline-flex items-center gap-1"
                    >
                      {fmtN(loyaltyData.allAnomalyRows.length)}
                      <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-normal">↓ xlsx</span>
                    </button>
                  ) : <span className="text-gray-400">0</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-orange-700">
                  {fmtPct(loyaltyData.allAnomalyRows.length, loyaltyData.totalAll)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── Секция 2 ── */}
      <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
        <div className="px-5 py-4 bg-purple-50 border-b border-purple-200">
          <h2 className="font-bold text-purple-800 text-base">
            Котировки, где все ценовые колонки = 0
          </h2>
          <p className="text-xs text-purple-600 mt-1 leading-relaxed">
            Строки, где одновременно:{' '}
            {ZERO_COLS.map((c, i) => (
              <span key={c}>
                <code className="bg-purple-100 px-1 rounded text-[11px]">{c}</code>
                {i < ZERO_COLS.length - 1 ? ', ' : ''}
              </span>
            ))}
            {' '}— все = 0.{' '}
            По вертикали — статусы (State), по горизонтали — месяцы.
            Каждая ячейка: <strong>кол-во</strong> таких строк и <strong>доля</strong> от всех котировок в этом статусе/месяце.
            Нажмите на ячейку для скачивания.
          </p>
          {zeroData.foundCols.length < ZERO_COLS.length && rawRows.length > 0 && (
            <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Внимание: в данных найдено {zeroData.foundCols.length} из {ZERO_COLS.length} ожидаемых колонок.
              {zeroData.foundCols.length > 0 && <> Найдены: {zeroData.foundCols.map(c => <code key={c} className="bg-amber-100 px-1 rounded mx-0.5">{c}</code>)}.</>}
              {' '}Отсутствующие колонки считаются равными 0.
            </p>
          )}
        </div>

        {zeroData.zeroAllRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Нет строк, где все 10 ценовых колонок = 0
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                {/* Строка месяцев */}
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200 min-w-[160px]">
                    Статус (State)
                  </th>
                  {zeroData.months.map(m => (
                    <th
                      key={m.key}
                      className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200 whitespace-nowrap min-w-[110px]"
                    >
                      {m.label}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-700 uppercase tracking-wide border-b-2 border-gray-200 border-l-2 border-l-blue-200 min-w-[110px]">
                    ИТОГО
                  </th>
                </tr>
              </thead>
              <tbody>
                {zeroData.states.map(state => {
                  const stateZeroByMonth = zeroData.zeroByStateMonth.get(state)
                  const stateZeroAll     = zeroData.zeroByState.get(state) ?? []
                  const stateTotalAll    = zeroData.totalByState.get(state) ?? 0

                  return (
                    <tr key={state} className="border-t border-gray-100 hover:bg-purple-50/30 transition-colors">
                      {/* Статус */}
                      <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-gray-700 whitespace-nowrap">
                        {state}
                      </td>

                      {/* Ячейки по месяцам */}
                      {zeroData.months.map(m => {
                        const rows  = stateZeroByMonth?.get(m.key) ?? []
                        const total = zeroData.totalByStateMonth.get(state)?.get(m.key) ?? 0
                        if (rows.length === 0) return (
                          <td key={m.key} className="px-3 py-2.5 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        return (
                          <td key={m.key} className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => downloadXlsx(rows, `zeros_${state}_${m.key}.xlsx`)}
                              className="inline-flex flex-col items-center gap-0.5 group"
                              title={`Скачать ${fmtN(rows.length)} строк`}
                            >
                              <span className="font-semibold text-purple-700 group-hover:underline tabular-nums">
                                {fmtN(rows.length)}
                              </span>
                              <span className="text-[10px] text-purple-400 tabular-nums">
                                {fmtPct(rows.length, total)}
                              </span>
                            </button>
                          </td>
                        )
                      })}

                      {/* ИТОГО по статусу */}
                      <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-100">
                        {stateZeroAll.length > 0 ? (
                          <button
                            onClick={() => downloadXlsx(stateZeroAll, `zeros_${state}_all.xlsx`)}
                            className="inline-flex flex-col items-center gap-0.5 group"
                          >
                            <span className="font-semibold text-blue-700 group-hover:underline tabular-nums">
                              {fmtN(stateZeroAll.length)}
                            </span>
                            <span className="text-[10px] text-blue-400 tabular-nums">
                              {fmtPct(stateZeroAll.length, stateTotalAll)}
                            </span>
                          </button>
                        ) : <span className="text-gray-200">—</span>}
                      </td>
                    </tr>
                  )
                })}

                {/* ИТОГО по всем статусам */}
                <tr className="border-t-2 border-purple-300 bg-purple-50 font-semibold">
                  <td className="sticky left-0 bg-purple-50 px-4 py-2.5 text-purple-800">
                    ИТОГО (все статусы)
                  </td>
                  {zeroData.months.map(m => {
                    const rows  = zeroData.zeroByMonth.get(m.key) ?? []
                    const total = zeroData.totalByMonth.get(m.key) ?? 0
                    return (
                      <td key={m.key} className="px-3 py-2.5 text-center">
                        {rows.length > 0 ? (
                          <button
                            onClick={() => downloadXlsx(rows, `zeros_all_${m.key}.xlsx`)}
                            className="inline-flex flex-col items-center gap-0.5 group"
                          >
                            <span className="text-purple-800 group-hover:underline tabular-nums">
                              {fmtN(rows.length)}
                            </span>
                            <span className="text-[10px] text-purple-500 tabular-nums">
                              {fmtPct(rows.length, total)}
                            </span>
                          </button>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    )
                  })}
                  {/* Угловая ячейка ИТОГО × ИТОГО */}
                  <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-200">
                    {zeroData.zeroAllRows.length > 0 ? (
                      <button
                        onClick={() => downloadXlsx(zeroData.zeroAllRows, 'zeros_all.xlsx')}
                        className="inline-flex flex-col items-center gap-0.5 group"
                      >
                        <span className="text-gray-800 group-hover:underline tabular-nums">
                          {fmtN(zeroData.zeroAllRows.length)}
                        </span>
                        <span className="text-[10px] text-gray-500 tabular-nums">
                          {fmtPct(zeroData.zeroAllRows.length, zeroData.grandTotalAll)}
                        </span>
                      </button>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
