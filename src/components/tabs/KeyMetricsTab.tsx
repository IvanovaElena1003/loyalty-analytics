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

function isSpendingRow(row: RawRow): boolean {
  if (String(row.CrossIsBought ?? '').trim() !== 'Да') return false
  if (!isNull(row.ChargedToIncreasedKV) && toNum(row.ChargedToIncreasedKV) !== 0) return true
  if (!isNull(row.FinalPrice)) {
    const fp = toNum(row.FinalPrice)
    const pp = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
    if (fp !== pp) return true
  }
  return false
}

function calcSpend(row: RawRow): number {
  const pp  = !isNull(row.PolicyPrice) ? toNum(row.PolicyPrice) : BASE_PRICE
  const fp  = toNum(row.FinalPrice)
  const kv  = toNum(row.ChargedToIncreasedKV)
  const hasKV       = !isNull(row.ChargedToIncreasedKV) && kv !== 0
  const hasDiscount = !isNull(row.FinalPrice) && fp !== pp
  return (hasKV ? kv : 0) + (hasDiscount ? pp - fp : 0)
}

const fmtN = (v: number) => Math.round(v).toLocaleString('ru-RU')

// ─── Компонент ────────────────────────────────────────────────────────────────
export default function KeyMetricsTab({ rawRows }: Props) {

  const { threeOrMore, oneOrTwo, neverSpent } = useMemo(() => {
    type PartnerData = {
      renId: string
      fullName: string
      role: string
      anyRow: RawRow
      spendRows: RawRow[]
      totalSpend: number
    }

    // Шаг 0: партнёры, у которых хоть раз было начисление за ВСЮ историю
    const everAccrued = new Set<string>()
    for (const row of rawRows) {
      if (String(row.State ?? '') !== 'PolicyIssued') continue
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId) continue
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNull(row.LoyaltyPointsInLK) && lp > 0) everAccrued.add(renId)
    }

    const rows2026 = rawRows.filter(r => parseYear(r.CreateDate) === 2026)
    const partnerMap = new Map<string, PartnerData>()

    // Шаг 1: все партнёры из 2026
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

    // Шаг 2: считаем события списания 2026
    for (const row of rows2026) {
      if (!isSpendingRow(row)) continue
      const renId = String(row['RenId'] ?? '').trim()
      const p = partnerMap.get(renId)
      if (!p) continue
      p.spendRows.push(row)
      p.totalSpend += calcSpend(row)
    }

    const all = Array.from(partnerMap.values())
    const threeOrMore = all
      .filter(p => p.spendRows.length >= 3)
      .sort((a, b) => b.spendRows.length - a.spendRows.length)

    const oneOrTwo = all
      .filter(p => p.spendRows.length >= 1 && p.spendRows.length < 3)
      .sort((a, b) => b.spendRows.length - a.spendRows.length)

    // Группа C: 0 списаний в 2026, но хоть раз начисляли за всю историю
    const neverSpent = all
      .filter(p => p.spendRows.length === 0 && everAccrued.has(p.renId))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))

    return { threeOrMore, oneOrTwo, neverSpent }
  }, [rawRows])

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

  function SummaryTable({ data }: { data: typeof threeOrMore }) {
    if (data.length === 0) return (
      <p className="text-sm text-gray-400 italic px-4 py-3">Нет данных</p>
    )
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
            {data.map(p => (
              <tr key={p.renId} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2">
                  <span className="font-medium text-gray-800">{p.fullName}</span>
                  <span className="block text-xs text-gray-400">{p.renId}</span>
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">{p.role}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-800">
                  {p.spendRows.length > 0 ? p.spendRows.length : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-indigo-600 font-medium">
                  {p.totalSpend > 0 ? fmtN(p.totalSpend) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const totalEventsA = threeOrMore.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendA  = threeOrMore.reduce((s, p) => s + p.totalSpend, 0)
  const totalEventsB = oneOrTwo.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendB  = oneOrTwo.reduce((s, p) => s + p.totalSpend, 0)

  return (
    <div className="space-y-6">

      {/* Пояснение */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>Дашборд: Партнёры по частоте списания Рен-бонусов в 2026 году.</strong>{' '}
        Критерий списания: <code className="bg-blue-100 px-1 rounded">CrossIsBought = Да</code> и
        (ChargedToIncreasedKV ≠ 0 <em>или</em> FinalPrice ≠ PolicyPrice). Каждая такая строка = 1 событие.
        Группа «Списали 0 раз» — только партнёры, у которых за всю историю было хотя бы одно начисление.
      </div>

      {/* ── Три группы ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* Группа A: ≥ 3 списания */}
        <div className="bg-white rounded-xl border border-green-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-green-50 border-b border-green-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-green-800 text-base">✅ Списали 3+ раз</h3>
              <p className="text-xs text-green-600 mt-0.5">Активные пользователи (2026)</p>
            </div>
            <button
              onClick={() => handleDownload(threeOrMore, 'spent_3plus_2026.xlsx')}
              disabled={threeOrMore.length === 0}
              className="shrink-0 text-xs bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 border-b border-gray-100 bg-green-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-green-700">{fmtN(threeOrMore.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsA)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Сумма, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendA)}</p>
            </div>
          </div>
          <SummaryTable data={threeOrMore} />
        </div>

        {/* Группа B: 1–2 списания */}
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-amber-800 text-base">⚠️ Списали 1–2 раза</h3>
              <p className="text-xs text-amber-600 mt-0.5">Низкая активность (2026)</p>
            </div>
            <button
              onClick={() => handleDownload(oneOrTwo, 'spent_1_2_2026.xlsx')}
              disabled={oneOrTwo.length === 0}
              className="shrink-0 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 border-b border-gray-100 bg-amber-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-amber-700">{fmtN(oneOrTwo.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsB)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Сумма, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendB)}</p>
            </div>
          </div>
          <SummaryTable data={oneOrTwo} />
        </div>

        {/* Группа C: 0 списаний, но с историей начислений */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-700 text-base">🔴 Списали 0 раз</h3>
              <p className="text-xs text-slate-500 mt-0.5">Есть начисления за всю историю, но не списывали в 2026</p>
            </div>
            <button
              onClick={() => handleDownload(neverSpent, 'spent_0_with_accruals_2026.xlsx')}
              disabled={neverSpent.length === 0}
              className="shrink-0 text-xs bg-slate-500 text-white hover:bg-slate-600 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 border-b border-gray-100 bg-slate-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-slate-600">{fmtN(neverSpent.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Списаний в 2026</p>
              <p className="text-3xl font-bold text-gray-400">0</p>
            </div>
          </div>
          <SummaryTable data={neverSpent} />
        </div>

      </div>

      <p className="text-xs text-gray-400 px-1">
        Excel-выгрузка: одна строка на партнёра со всеми идентификационными полями из исходника
        + Кол-во_списаний_2026 и Сумма_РБ_2026.
      </p>
    </div>
  )
}
