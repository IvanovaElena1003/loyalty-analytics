import { useMemo } from 'react'
import type { RawRow } from '../../types'
import { downloadXlsx } from '../../utils/engagement'

interface Props { rawRows: RawRow[] }

const BASE_PRICE = 2490

// ─── Утилиты ─────────────────────────────────────────────────────────────────
function isNull(v: unknown): boolean {
  return v == null || v === '' || v === '[NULL]'
}
function toNum(v: unknown): number {
  if (isNull(v)) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}
function parseYear(v: unknown): number | null {
  if (v == null) return null
  let d: Date | null = null
  if (v instanceof Date)       d = v
  else if (typeof v === 'number' && v > 0) d = new Date((v - 25569) * 86400000)
  else if (typeof v === 'string') {
    const n = Number(v)
    if (!isNaN(n) && n > 0) d = new Date((n - 25569) * 86400000)
    else { d = new Date(v) }
  }
  if (!d || isNaN(d.getTime())) return null
  return d.getUTCFullYear()
}

/** Является ли строка событием списания Рен-бонусов (КВ или скидка в КК от бесполисных) */
function isSpendingRow(row: RawRow): boolean {
  if (String(row.CrossIsBought ?? '').trim() !== 'Да') return false
  // Повышенное КВ
  if (!isNull(row.ChargedToIncreasedKV) && toNum(row.ChargedToIncreasedKV) !== 0) return true
  // Скидка (FinalPrice ≠ PolicyPrice)
  if (!isNull(row.FinalPrice)) {
    const fp = toNum(row.FinalPrice)
    const pp = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
    if (fp !== pp) return true
  }
  return false
}

/** Сумма списания по строке */
function calcSpend(row: RawRow): number {
  const pp  = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
  const fp  = toNum(row.FinalPrice)
  const kv  = toNum(row.ChargedToIncreasedKV)
  const hasKV      = !isNull(row.ChargedToIncreasedKV) && kv !== 0
  const hasDiscount = !isNull(row.FinalPrice) && fp !== pp
  return (hasKV ? kv : 0) + (hasDiscount ? pp - fp : 0)
}

// ─── Форматирование ───────────────────────────────────────────────────────────
const fmtN = (v: number) => Math.round(v).toLocaleString('ru-RU')

// ─── Компонент ────────────────────────────────────────────────────────────────
export default function KeyMetricsTab({ rawRows }: Props) {

  const { threeOrMore, lessThanThree } = useMemo(() => {
    type PartnerData = {
      renId: string
      fullName: string
      role: string
      anyRow: RawRow        // любая строка 2026 — для статичных полей в xlsx
      spendRows: RawRow[]   // строки-списания 2026
      totalSpend: number
    }
    const partnerMap = new Map<string, PartnerData>()

    const rows2026 = rawRows.filter(r => parseYear(r.CreateDate) === 2026)

    // Проход 1: регистрируем всех партнёров из 2026 и их первую строку
    for (const row of rows2026) {
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId) continue
      if (!partnerMap.has(renId)) {
        partnerMap.set(renId, {
          renId,
          fullName: String(row['FullName'] ?? row['AgentName'] ?? '').trim() || '—',
          role:     String(row['Role'] ?? '').trim() || '—',
          anyRow:   row,
          spendRows: [],
          totalSpend: 0,
        })
      }
      const p = partnerMap.get(renId)!
      if ((!p.fullName || p.fullName === '—') && row['FullName']) {
        p.fullName = String(row['FullName']).trim()
      }
    }

    // Проход 2: считаем события списания
    for (const row of rows2026) {
      if (!isSpendingRow(row)) continue
      const renId = String(row['RenId'] ?? '').trim()
      const p = partnerMap.get(renId)
      if (!p) continue
      p.spendRows.push(row)
      p.totalSpend += calcSpend(row)
    }

    const all = Array.from(partnerMap.values())
    const threeOrMore   = all.filter(p => p.spendRows.length >= 3).sort((a, b) => b.spendRows.length - a.spendRows.length)
    // Группа B: 1-2 списания и 0 списаний; сортируем: сначала 1-2 (по убыванию), потом 0
    const lessThanThree = all
      .filter(p => p.spendRows.length < 3)
      .sort((a, b) => b.spendRows.length - a.spendRows.length)

    return { threeOrMore, lessThanThree }
  }, [rawRows])

  // Поля уровня полиса — исключаем из партнёрской сводки
  const POLICY_LEVEL_FIELDS = new Set([
    'CreateDate', 'State', 'CrossIsBought', 'FinalPrice', 'PolicyPrice',
    'ChargedToIncreasedKV', 'LoyaltyPointsInLK', 'LoyaltyPointsScoring',
    'AvailableForUsePoints', 'QuotationNumber', '2490',
  ])

  function buildPartnerRow(p: typeof threeOrMore[number]): Record<string, unknown> {
    const base = p.anyRow as Record<string, unknown>
    const out: Record<string, unknown> = {}
    out['RenId'] = p.renId
    out['ФИО']   = p.fullName
    out['Роль']  = p.role
    for (const [k, v] of Object.entries(base)) {
      if (POLICY_LEVEL_FIELDS.has(k)) continue
      if (k === 'RenId' || k === 'FullName' || k === 'Role') continue
      out[k] = v
    }
    out['Кол-во_списаний_2026'] = p.spendRows.length
    out['Сумма_РБ_2026']        = Math.round(p.totalSpend)
    return out
  }

  function handleDownload(group: typeof threeOrMore, filename: string) {
    downloadXlsx(group.map(p => buildPartnerRow(p)), filename)
  }

  function SummaryTable({ data, showZeroSeparator = false }: { data: typeof threeOrMore; showZeroSeparator?: boolean }) {
    if (data.length === 0) return (
      <p className="text-sm text-gray-400 italic px-4 py-3">Нет данных</p>
    )
    let separatorInserted = false
    return (
      <div className="overflow-auto" style={{ maxHeight: '360px' }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="px-4 py-2 text-left">ФИО / RenId</th>
              <th className="px-4 py-2 text-left">Роль</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Списаний, шт.</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Сумма РБ</th>
            </tr>
          </thead>
          <tbody>
            {data.map(p => {
              const isZero = p.spendRows.length === 0
              const showSep = showZeroSeparator && isZero && !separatorInserted
              if (showSep) separatorInserted = true
              return (
                <>
                  {showSep && (
                    <tr key={`sep-${p.renId}`}>
                      <td colSpan={4} className="px-4 py-2 bg-gray-50 border-t border-b border-gray-200">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          Ни разу не списали
                        </span>
                      </td>
                    </tr>
                  )}
                  <tr key={p.renId} className={`border-t border-gray-100 hover:bg-gray-50 transition-colors ${isZero ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-gray-800">{p.fullName}</span>
                      <span className="block text-xs text-gray-400">{p.renId}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{p.role}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-800">
                      {p.spendRows.length}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-indigo-600 font-medium">
                      {p.totalSpend > 0 ? fmtN(p.totalSpend) : '—'}
                    </td>
                  </tr>
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const totalEventsA = threeOrMore.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendA  = threeOrMore.reduce((s, p) => s + p.totalSpend, 0)
  const totalEventsB = lessThanThree.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendB  = lessThanThree.reduce((s, p) => s + p.totalSpend, 0)
  const neverSpent   = lessThanThree.filter(p => p.spendRows.length === 0).length

  return (
    <div className="space-y-6">

      {/* Пояснение */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>Дашборд: Партнёры по частоте списания Рен-бонусов в 2026 году.</strong>{' '}
        Учитываются строки с <code className="bg-blue-100 px-1 rounded">CrossIsBought = Да</code> и
        наличием списания (ChargedToIncreasedKV ≠ 0 <em>или</em> FinalPrice ≠ PolicyPrice).
        Каждая такая строка = 1 событие списания. В группу «менее 3 раз» также включены
        партнёры, у которых не было ни одного списания в 2026 году.
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── Группа A: ≥ 3 списания ─────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-green-200 overflow-hidden shadow-sm">
          {/* Шапка */}
          <div className="px-5 py-4 bg-green-50 border-b border-green-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-green-800 text-base">
                ✅ Списали 3 и более раз
              </h3>
              <p className="text-xs text-green-600 mt-0.5">
                Активные пользователи программы (2026 год)
              </p>
            </div>
            <button
              onClick={() => handleDownload(threeOrMore, 'spent_3plus_2026.xlsx')}
              disabled={threeOrMore.length === 0}
              className="shrink-0 text-xs bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 px-4 py-1.5 rounded-full transition-colors font-medium"
            >
              ↓ xlsx
            </button>
          </div>

          {/* KPI */}
          <div className="px-5 py-4 flex gap-6 border-b border-gray-100 bg-green-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-green-700">{fmtN(threeOrMore.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий списания</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsA)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Сумма списаний, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendA)}</p>
            </div>
          </div>

          {/* Таблица */}
          <SummaryTable data={threeOrMore} />
        </div>

        {/* ── Группа B: < 3 списания ──────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden shadow-sm">
          {/* Шапка */}
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-amber-800 text-base">
                ⚠️ Списали менее 3 раз
              </h3>
              <p className="text-xs text-amber-600 mt-0.5">
                Низкая активность — потенциал для роста (2026 год)
              </p>
            </div>
            <button
              onClick={() => handleDownload(lessThanThree, 'spent_less3_2026.xlsx')}
              disabled={lessThanThree.length === 0}
              className="shrink-0 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 px-4 py-1.5 rounded-full transition-colors font-medium"
            >
              ↓ xlsx
            </button>
          </div>

          {/* KPI */}
          <div className="px-5 py-4 flex flex-wrap gap-6 border-b border-gray-100 bg-amber-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-amber-700">{fmtN(lessThanThree.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">из них не списали</p>
              <p className="text-3xl font-bold text-red-500">{fmtN(neverSpent)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий списания</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsB)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Сумма списаний, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendB)}</p>
            </div>
          </div>

          {/* Таблица */}
          <SummaryTable data={lessThanThree} showZeroSeparator />
        </div>

      </div>

      <p className="text-xs text-gray-400 px-1">
        Excel-выгрузка содержит строки исходника, соответствующие критерию,
        со всеми полями как в загруженном файле.
      </p>
    </div>
  )
}
