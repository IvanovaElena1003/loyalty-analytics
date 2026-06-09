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
const CUTOFF = new Date(2026, 2, 1) // March 1, 2026 local time

// Отсечка для Секции 4: CreateDate ≤ 25.02.2026
// Используем < Feb 26 (exclusive) = ≤ Feb 25 (inclusive) в локальном времени
const AVAIL_CUTOFF = new Date(2026, 1, 26)

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

// ─── Секция 0: двойное списание (FinalPrice ≠ PolicyPrice И ChargedToIncreasedKV ≠ 0) ──
const BASE_PRICE = 2490

function isDoubleSpend(row: RawRow): boolean {
  const policyPrice = !isNullVal(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
  const fp  = toNum(row.FinalPrice)
  const kv  = toNum(row.ChargedToIncreasedKV)
  return !isNullVal(row.FinalPrice) && fp !== policyPrice &&
         !isNullVal(row.ChargedToIncreasedKV) && kv !== 0
}

// ─── Секция 2: все 10 ценовых колонок = 0 ───────────────────────────────────
// Задачи 2+3: исключаем строки где 2490 = 0 или AvailableForUsePoints = 0
function allZero(row: RawRow): boolean {
  // Исключаем строки, где поле 2490 имеет реальное значение = 0
  if (!isNullVal(row['2490']) && toNum(row['2490']) === 0) return false
  // Исключаем строки, где AvailableForUsePoints имеет реальное значение = 0
  if (!isNullVal(row['AvailableForUsePoints']) && toNum(row['AvailableForUsePoints']) === 0) return false
  return ZERO_COLS.every(col => toNum(row[col]) === 0)
}

// ─── Секция 3: поле 2490 = 0 ────────────────────────────────────────────────
function is2490Zero(row: RawRow): boolean {
  return toNum(row['2490']) === 0
}

// ─── Секция 4: AvailableForUsePoints > LoyaltyPointsInLK ────────────────────
function isAvailExcess(row: RawRow): boolean {
  const avail = toNum(row['AvailableForUsePoints'])
  const lk    = toNum(row['LoyaltyPointsInLK'])
  return avail > lk
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

// ─── Построение матрицы State × Month ────────────────────────────────────────
// matchFn  — условие для «аномальных» строк
// scopeFn  — ограничивает набор строк для знаменателя доли (по умолчанию все строки)
type MatrixData = {
  states: string[]
  months: { key: string; label: string }[]
  totalByStateMonth: Map<string, Map<string, number>>
  totalByState: Map<string, number>
  totalByMonth: Map<string, number>
  grandTotalAll: number
  matchByStateMonth: Map<string, Map<string, RawRow[]>>
  matchByState: Map<string, RawRow[]>
  matchByMonth: Map<string, RawRow[]>
  matchAllRows: RawRow[]
}

function buildMatrix(
  rawRows: RawRow[],
  matchFn: (row: RawRow) => boolean,
  scopeFn: (row: RawRow) => boolean = () => true,
): MatrixData {
  const totalByStateMonth = new Map<string, Map<string, number>>()
  const totalByState      = new Map<string, number>()
  const totalByMonth      = new Map<string, number>()
  let grandTotalAll = 0
  const monthLabels = new Map<string, string>()
  const stateSet    = new Set<string>()

  for (const row of rawRows) {
    if (!scopeFn(row)) continue
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

  const matchByStateMonth = new Map<string, Map<string, RawRow[]>>()
  const matchByState      = new Map<string, RawRow[]>()
  const matchByMonth      = new Map<string, RawRow[]>()
  const matchAllRows: RawRow[] = []

  for (const row of rawRows) {
    if (!scopeFn(row)) continue
    if (!matchFn(row)) continue
    const date = parseDate(row.CreateDate)
    if (!date) continue
    const key   = mKey(date)
    const state = String(row.State ?? 'Unknown')

    if (!matchByStateMonth.has(state)) matchByStateMonth.set(state, new Map())
    const sm2 = matchByStateMonth.get(state)!
    if (!sm2.has(key)) sm2.set(key, [])
    sm2.get(key)!.push(row)

    if (!matchByState.has(state)) matchByState.set(state, [])
    matchByState.get(state)!.push(row)
    if (!matchByMonth.has(key)) matchByMonth.set(key, [])
    matchByMonth.get(key)!.push(row)
    matchAllRows.push(row)
  }

  const states = Array.from(stateSet).sort((a, b) => {
    if (a === 'PolicyIssued') return -1
    if (b === 'PolicyIssued') return 1
    return a.localeCompare(b)
  })
  const months = Array.from(monthLabels.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, label]) => ({ key, label }))

  return {
    states, months,
    totalByStateMonth, totalByState, totalByMonth, grandTotalAll,
    matchByStateMonth, matchByState, matchByMonth, matchAllRows,
  }
}

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

  // ── Секция 0: двойное списание ──────────────────────────────────────────
  const doubleSpendData = useMemo(() => {
    const byMonth = new Map<string, { label: string; rows: RawRow[] }>()

    for (const row of rawRows) {
      if (!isDoubleSpend(row)) continue
      const date = parseDate(row.CreateDate)
      if (!date) continue
      const key = mKey(date)
      if (!byMonth.has(key)) byMonth.set(key, { label: mLabel(date), rows: [] })
      byMonth.get(key)!.rows.push(row)
    }

    const months = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, ...v }))

    const allRows = months.flatMap(m => m.rows)
    return { months, allRows }
  }, [rawRows])

  // ── Секция 2: все нули в ценовых колонках (без 2490=0 и без AvailableForUsePoints=0) ──
  const zeroData = useMemo(() => {
    const d = buildMatrix(rawRows, allZero)
    const foundCols = rawRows.length > 0
      ? ZERO_COLS.filter(col => rawRows.some(r => r[col] !== undefined))
      : []
    return { ...d, foundCols }
  }, [rawRows])

  // ── Секция 3: строки где 2490 = 0 ──────────────────────────────────────
  const price2490Data = useMemo(() => buildMatrix(rawRows, is2490Zero), [rawRows])

  // ── Секция 4: AvailableForUsePoints > LoyaltyPointsInLK (CreateDate ≤ 25.02.2026) ──
  const availExcessData = useMemo(() => {
    return buildMatrix(
      rawRows,
      isAvailExcess,
      (row) => {
        const d = parseDate(row.CreateDate)
        return d !== null && d < AVAIL_CUTOFF
      },
    )
  }, [rawRows])

  return (
    <div className="space-y-8">

      {/* ── Секция 0: двойное списание ── */}
      <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
        <div className="px-5 py-4 bg-red-50 border-b border-red-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-bold text-red-800 text-base">
              Строки с двойным списанием: FinalPrice ≠ 2490 И ChargedToIncreasedKV ≠ 0
            </h2>
            <p className="text-xs text-red-600 mt-1">
              Одна строка попала в обе категории одновременно — и скидка КВ, и повышенное КВ.
              Нажмите на число для скачивания xlsx с QuotationNumber и деталями.
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className={`text-3xl font-bold tabular-nums ${doubleSpendData.allRows.length > 0 ? 'text-red-600' : 'text-gray-300'}`}>
              {fmtN(doubleSpendData.allRows.length)}
            </div>
            <div className="text-xs text-red-400">строк всего</div>
          </div>
        </div>

        {doubleSpendData.allRows.length === 0 ? (
          <div className="px-5 py-6 text-center text-green-600 text-sm font-medium">
            Пересечений не найдено — данные корректны.
          </div>
        ) : (
          <>
            {/* Разбивка по месяцам */}
            <div className="border-b border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left">Месяц</th>
                    <th className="px-4 py-2 text-right">Строк</th>
                    <th className="px-4 py-2 text-center">Скачать</th>
                  </tr>
                </thead>
                <tbody>
                  {doubleSpendData.months.map(m => (
                    <tr key={m.key} className="border-t border-gray-100 hover:bg-red-50/30">
                      <td className="px-4 py-2 text-gray-700">{m.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        <button
                          onClick={() => downloadXlsx(m.rows, `double_spend_${m.key}.xlsx`)}
                          className="text-red-600 font-semibold hover:underline inline-flex items-center gap-1"
                        >
                          {fmtN(m.rows.length)}
                          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-normal">↓ xlsx</span>
                        </button>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => downloadXlsx(m.rows, `double_spend_${m.key}.xlsx`)}
                          className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1 rounded-full"
                        >
                          ↓ xlsx
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-red-200 bg-red-50 font-semibold">
                    <td className="px-4 py-2 text-red-800">ИТОГО</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <button
                        onClick={() => downloadXlsx(doubleSpendData.allRows, 'double_spend_all.xlsx')}
                        className="text-red-700 hover:underline inline-flex items-center gap-1"
                      >
                        {fmtN(doubleSpendData.allRows.length)}
                        <span className="text-[10px] bg-red-200 text-red-700 px-1.5 py-0.5 rounded-full font-normal">↓ xlsx</span>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => downloadXlsx(doubleSpendData.allRows, 'double_spend_all.xlsx')}
                        className="text-xs bg-red-200 text-red-800 hover:bg-red-300 px-3 py-1 rounded-full"
                      >
                        ↓ все xlsx
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Таблица строк — QuotationNumber + детали */}
            <div className="overflow-auto" style={{ maxHeight: '420px' }}>
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left whitespace-nowrap">QuotationNumber</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">CreateDate</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">State</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">FinalPrice</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">Скидка (2490−FP)</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">ChargedToIncreasedKV</th>
                  </tr>
                </thead>
                <tbody>
                  {doubleSpendData.allRows.map((row, i) => {
                    const fp        = toNum(row.FinalPrice)
                    const kv        = toNum(row.ChargedToIncreasedKV)
                    const discount  = BASE_PRICE - fp
                    const date      = parseDate(row.CreateDate)
                    const dateStr   = date ? date.toLocaleDateString('ru-RU') : '—'
                    const qn        = String(row.QuotationNumber ?? row['QuotationNumber'] ?? '—')
                    return (
                      <tr key={i} className="border-t border-gray-100 hover:bg-red-50/40">
                        <td className="px-3 py-2 font-mono text-xs text-gray-800">{qn}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{dateStr}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{String(row.State ?? '—')}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{fmtN(fp)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-purple-600">
                          {discount > 0 ? `−${fmtN(discount)}` : fmtN(discount)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-blue-600">{fmtN(kv)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

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

      {/* ── Секция 2: все ценовые колонки = 0 (без строк 2490=0 и AvailableForUsePoints=0) ── */}
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
            Исключены строки, где <code className="bg-purple-100 px-1 rounded text-[11px]">2490 = 0</code> или{' '}
            <code className="bg-purple-100 px-1 rounded text-[11px]">AvailableForUsePoints = 0</code>.{' '}
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

        {zeroData.matchAllRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Нет строк, где все 10 ценовых колонок = 0 (с учётом исключений)
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
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
                  const stateMatchByMonth = zeroData.matchByStateMonth.get(state)
                  const stateMatchAll     = zeroData.matchByState.get(state) ?? []
                  const stateTotalAll     = zeroData.totalByState.get(state) ?? 0

                  return (
                    <tr key={state} className="border-t border-gray-100 hover:bg-purple-50/30 transition-colors">
                      <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-gray-700 whitespace-nowrap">
                        {state}
                      </td>
                      {zeroData.months.map(m => {
                        const rows  = stateMatchByMonth?.get(m.key) ?? []
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
                      <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-100">
                        {stateMatchAll.length > 0 ? (
                          <button
                            onClick={() => downloadXlsx(stateMatchAll, `zeros_${state}_all.xlsx`)}
                            className="inline-flex flex-col items-center gap-0.5 group"
                          >
                            <span className="font-semibold text-blue-700 group-hover:underline tabular-nums">
                              {fmtN(stateMatchAll.length)}
                            </span>
                            <span className="text-[10px] text-blue-400 tabular-nums">
                              {fmtPct(stateMatchAll.length, stateTotalAll)}
                            </span>
                          </button>
                        ) : <span className="text-gray-200">—</span>}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-purple-300 bg-purple-50 font-semibold">
                  <td className="sticky left-0 bg-purple-50 px-4 py-2.5 text-purple-800">
                    ИТОГО (все статусы)
                  </td>
                  {zeroData.months.map(m => {
                    const rows  = zeroData.matchByMonth.get(m.key) ?? []
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
                  <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-200">
                    {zeroData.matchAllRows.length > 0 ? (
                      <button
                        onClick={() => downloadXlsx(zeroData.matchAllRows, 'zeros_all.xlsx')}
                        className="inline-flex flex-col items-center gap-0.5 group"
                      >
                        <span className="text-gray-800 group-hover:underline tabular-nums">
                          {fmtN(zeroData.matchAllRows.length)}
                        </span>
                        <span className="text-[10px] text-gray-500 tabular-nums">
                          {fmtPct(zeroData.matchAllRows.length, zeroData.grandTotalAll)}
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

      {/* ── Секция 3: строки где 2490 = 0 ── */}
      <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
        <div className="px-5 py-4 bg-amber-50 border-b border-amber-200">
          <h2 className="font-bold text-amber-800 text-base">
            Котировки, где поле 2490 = 0
          </h2>
          <p className="text-xs text-amber-700 mt-1 leading-relaxed">
            Строки, где значение поля <code className="bg-amber-100 px-1 rounded text-[11px]">2490</code> равно 0.
            По вертикали — статусы (State), по горизонтали — месяцы.
            Каждая ячейка: <strong>кол-во</strong> таких строк и <strong>доля</strong> от всех котировок в этом статусе/месяце.
            Нажмите на ячейку для скачивания.
          </p>
        </div>

        {price2490Data.matchAllRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Нет строк, где поле 2490 = 0
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200 min-w-[160px]">
                    Статус (State)
                  </th>
                  {price2490Data.months.map(m => (
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
                {price2490Data.states.map(state => {
                  const stateMatchByMonth = price2490Data.matchByStateMonth.get(state)
                  const stateMatchAll     = price2490Data.matchByState.get(state) ?? []
                  const stateTotalAll     = price2490Data.totalByState.get(state) ?? 0

                  return (
                    <tr key={state} className="border-t border-gray-100 hover:bg-amber-50/30 transition-colors">
                      <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-gray-700 whitespace-nowrap">
                        {state}
                      </td>
                      {price2490Data.months.map(m => {
                        const rows  = stateMatchByMonth?.get(m.key) ?? []
                        const total = price2490Data.totalByStateMonth.get(state)?.get(m.key) ?? 0
                        if (rows.length === 0) return (
                          <td key={m.key} className="px-3 py-2.5 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        return (
                          <td key={m.key} className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => downloadXlsx(rows, `p2490_${state}_${m.key}.xlsx`)}
                              className="inline-flex flex-col items-center gap-0.5 group"
                              title={`Скачать ${fmtN(rows.length)} строк`}
                            >
                              <span className="font-semibold text-amber-700 group-hover:underline tabular-nums">
                                {fmtN(rows.length)}
                              </span>
                              <span className="text-[10px] text-amber-500 tabular-nums">
                                {fmtPct(rows.length, total)}
                              </span>
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-100">
                        {stateMatchAll.length > 0 ? (
                          <button
                            onClick={() => downloadXlsx(stateMatchAll, `p2490_${state}_all.xlsx`)}
                            className="inline-flex flex-col items-center gap-0.5 group"
                          >
                            <span className="font-semibold text-blue-700 group-hover:underline tabular-nums">
                              {fmtN(stateMatchAll.length)}
                            </span>
                            <span className="text-[10px] text-blue-400 tabular-nums">
                              {fmtPct(stateMatchAll.length, stateTotalAll)}
                            </span>
                          </button>
                        ) : <span className="text-gray-200">—</span>}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-amber-300 bg-amber-50 font-semibold">
                  <td className="sticky left-0 bg-amber-50 px-4 py-2.5 text-amber-800">
                    ИТОГО (все статусы)
                  </td>
                  {price2490Data.months.map(m => {
                    const rows  = price2490Data.matchByMonth.get(m.key) ?? []
                    const total = price2490Data.totalByMonth.get(m.key) ?? 0
                    return (
                      <td key={m.key} className="px-3 py-2.5 text-center">
                        {rows.length > 0 ? (
                          <button
                            onClick={() => downloadXlsx(rows, `p2490_all_${m.key}.xlsx`)}
                            className="inline-flex flex-col items-center gap-0.5 group"
                          >
                            <span className="text-amber-800 group-hover:underline tabular-nums">
                              {fmtN(rows.length)}
                            </span>
                            <span className="text-[10px] text-amber-600 tabular-nums">
                              {fmtPct(rows.length, total)}
                            </span>
                          </button>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-200">
                    {price2490Data.matchAllRows.length > 0 ? (
                      <button
                        onClick={() => downloadXlsx(price2490Data.matchAllRows, 'p2490_all.xlsx')}
                        className="inline-flex flex-col items-center gap-0.5 group"
                      >
                        <span className="text-gray-800 group-hover:underline tabular-nums">
                          {fmtN(price2490Data.matchAllRows.length)}
                        </span>
                        <span className="text-[10px] text-gray-500 tabular-nums">
                          {fmtPct(price2490Data.matchAllRows.length, price2490Data.grandTotalAll)}
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

      {/* ── Секция 4: AvailableForUsePoints > LoyaltyPointsInLK (CreateDate ≤ 25.02.2026) ── */}
      <div className="bg-white rounded-xl border border-teal-200 overflow-hidden">
        <div className="px-5 py-4 bg-teal-50 border-b border-teal-200">
          <h2 className="font-bold text-teal-800 text-base">
            AvailableForUsePoints &gt; LoyaltyPointsInLK (CreateDate ≤ 25.02.2026)
          </h2>
          <p className="text-xs text-teal-700 mt-1 leading-relaxed">
            Среди строк с <code className="bg-teal-100 px-1 rounded text-[11px]">CreateDate ≤ 25 февраля 2026</code> —
            найдены строки, где{' '}
            <code className="bg-teal-100 px-1 rounded text-[11px]">AvailableForUsePoints</code> &gt;{' '}
            <code className="bg-teal-100 px-1 rounded text-[11px]">LoyaltyPointsInLK</code>.
            По вертикали — статусы (State), по горизонтали — месяцы.
            Каждая ячейка: <strong>кол-во</strong> таких строк и <strong>доля</strong> от всех строк в этом
            статусе/месяце с датой ≤ 25.02.2026.
            Нажмите на ячейку для скачивания.
          </p>
        </div>

        {availExcessData.grandTotalAll === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Нет строк с CreateDate ≤ 25.02.2026
          </div>
        ) : availExcessData.matchAllRows.length === 0 ? (
          <div className="p-8 text-center text-green-600 text-sm font-medium">
            Среди строк с CreateDate ≤ 25.02.2026 не найдено случаев AvailableForUsePoints &gt; LoyaltyPointsInLK
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200 min-w-[160px]">
                    Статус (State)
                  </th>
                  {availExcessData.months.map(m => (
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
                {availExcessData.states.map(state => {
                  const stateMatchByMonth = availExcessData.matchByStateMonth.get(state)
                  const stateMatchAll     = availExcessData.matchByState.get(state) ?? []
                  const stateTotalAll     = availExcessData.totalByState.get(state) ?? 0

                  return (
                    <tr key={state} className="border-t border-gray-100 hover:bg-teal-50/30 transition-colors">
                      <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-gray-700 whitespace-nowrap">
                        {state}
                      </td>
                      {availExcessData.months.map(m => {
                        const rows  = stateMatchByMonth?.get(m.key) ?? []
                        const total = availExcessData.totalByStateMonth.get(state)?.get(m.key) ?? 0
                        if (rows.length === 0) return (
                          <td key={m.key} className="px-3 py-2.5 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        return (
                          <td key={m.key} className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => downloadXlsx(rows, `avail_excess_${state}_${m.key}.xlsx`)}
                              className="inline-flex flex-col items-center gap-0.5 group"
                              title={`Скачать ${fmtN(rows.length)} строк`}
                            >
                              <span className="font-semibold text-teal-700 group-hover:underline tabular-nums">
                                {fmtN(rows.length)}
                              </span>
                              <span className="text-[10px] text-teal-500 tabular-nums">
                                {fmtPct(rows.length, total)}
                              </span>
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-100">
                        {stateMatchAll.length > 0 ? (
                          <button
                            onClick={() => downloadXlsx(stateMatchAll, `avail_excess_${state}_all.xlsx`)}
                            className="inline-flex flex-col items-center gap-0.5 group"
                          >
                            <span className="font-semibold text-blue-700 group-hover:underline tabular-nums">
                              {fmtN(stateMatchAll.length)}
                            </span>
                            <span className="text-[10px] text-blue-400 tabular-nums">
                              {fmtPct(stateMatchAll.length, stateTotalAll)}
                            </span>
                          </button>
                        ) : <span className="text-gray-200">—</span>}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-teal-300 bg-teal-50 font-semibold">
                  <td className="sticky left-0 bg-teal-50 px-4 py-2.5 text-teal-800">
                    ИТОГО (все статусы)
                  </td>
                  {availExcessData.months.map(m => {
                    const rows  = availExcessData.matchByMonth.get(m.key) ?? []
                    const total = availExcessData.totalByMonth.get(m.key) ?? 0
                    return (
                      <td key={m.key} className="px-3 py-2.5 text-center">
                        {rows.length > 0 ? (
                          <button
                            onClick={() => downloadXlsx(rows, `avail_excess_all_${m.key}.xlsx`)}
                            className="inline-flex flex-col items-center gap-0.5 group"
                          >
                            <span className="text-teal-800 group-hover:underline tabular-nums">
                              {fmtN(rows.length)}
                            </span>
                            <span className="text-[10px] text-teal-600 tabular-nums">
                              {fmtPct(rows.length, total)}
                            </span>
                          </button>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-center border-l-2 border-l-blue-200">
                    {availExcessData.matchAllRows.length > 0 ? (
                      <button
                        onClick={() => downloadXlsx(availExcessData.matchAllRows, 'avail_excess_all.xlsx')}
                        className="inline-flex flex-col items-center gap-0.5 group"
                      >
                        <span className="text-gray-800 group-hover:underline tabular-nums">
                          {fmtN(availExcessData.matchAllRows.length)}
                        </span>
                        <span className="text-[10px] text-gray-500 tabular-nums">
                          {fmtPct(availExcessData.matchAllRows.length, availExcessData.grandTotalAll)}
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
