import { useMemo, useState } from 'react'
import type { RawRow } from '../../types'
import { downloadXlsx } from '../../utils/engagement'

interface Props { rawRows: RawRow[] }

const BASE_PRICE = 2490

const ALL_ALLOWED_ROLES = [
  'Агент', 'Субагент', 'Директор партнера',
  'Продавец внутри партнера', 'Куратор внутри партнера',
]

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

function parseDate(v: unknown): Date | null {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number' && v > 0) return new Date((v - 25569) * 86400000)
  if (typeof v === 'string') {
    const n = Number(v)
    if (!isNaN(n) && n > 0) return new Date((n - 25569) * 86400000)
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

const fmtN    = (v: number) => Math.round(v).toLocaleString('ru-RU')
const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtPct  = (num: number, den: number) =>
  den > 0 ? `${Math.round((num / den) * 100)}%` : '—'

// ─── Компонент ────────────────────────────────────────────────────────────────
export default function KeyMetricsTab({ rawRows }: Props) {

  const ALLOWED_ROLES = new Set(ALL_ALLOWED_ROLES)

  const { tenOrMore, threeToNine, oneOrTwo, neverSpent } = useMemo(() => {
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

    // Шаг 1: партнёры из 2026 с разрешёнными ролями
    for (const row of rows2026) {
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId) continue
      const role = String(row['Role'] ?? '').trim()
      if (!ALLOWED_ROLES.has(role)) continue
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

    // Шаг 2: считаем события списания 2026 (partnerMap уже отфильтрован по ролям)
    for (const row of rows2026) {
      if (!isSpendingRow(row)) continue
      const renId = String(row['RenId'] ?? '').trim()
      const p = partnerMap.get(renId)
      if (!p) continue  // не в разрешённых ролях — пропускаем
      p.spendRows.push(row)
      p.totalSpend += calcSpend(row)
    }

    const all = Array.from(partnerMap.values())
    const tenOrMore = all
      .filter(p => p.spendRows.length >= 10)
      .sort((a, b) => b.spendRows.length - a.spendRows.length)

    const threeToNine = all
      .filter(p => p.spendRows.length >= 3 && p.spendRows.length <= 9)
      .sort((a, b) => b.spendRows.length - a.spendRows.length)

    const oneOrTwo = all
      .filter(p => p.spendRows.length >= 1 && p.spendRows.length < 3)
      .sort((a, b) => b.spendRows.length - a.spendRows.length)

    // Группа C: 0 списаний в 2026, но хоть раз начисляли за всю историю
    const neverSpent = all
      .filter(p => p.spendRows.length === 0 && everAccrued.has(p.renId))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))

    return { tenOrMore, threeToNine, oneOrTwo, neverSpent }
  }, [rawRows])


  // ── Топ «копят, но не тратят» ─────────────────────────────────────────────
  const underutilizers = useMemo(() => {
    type UStats = {
      renId: string
      fullName: string
      role: string
      anyRow: RawRow
      totalAccrual: number   // сумма LP за всю историю
      accrualCount: number   // кол-во событий начисления
      totalSpend: number     // сумма списаний за всю историю
      spendCount: number
      lastAccrualDate: Date | null
    }
    const map = new Map<string, UStats>()

    for (const row of rawRows) {
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId) continue

      if (!map.has(renId)) {
        map.set(renId, {
          renId,
          fullName: String(row['FullName'] ?? row['AgentName'] ?? '').trim() || '—',
          role:     String(row['Role'] ?? '').trim() || '—',
          anyRow:   row,
          totalAccrual: 0, accrualCount: 0,
          totalSpend:   0, spendCount:   0,
          lastAccrualDate: null,
        })
      }
      const s = map.get(renId)!
      if ((!s.fullName || s.fullName === '—') && row['FullName']) s.fullName = String(row['FullName']).trim()

      // начисление
      if (String(row.State ?? '') === 'PolicyIssued') {
        const lp = toNum(row.LoyaltyPointsInLK)
        if (!isNull(row.LoyaltyPointsInLK) && lp > 0) {
          s.totalAccrual += lp
          s.accrualCount++
          const d = parseDate(row.CreateDate)
          if (d && (!s.lastAccrualDate || d > s.lastAccrualDate)) s.lastAccrualDate = d
        }
      }

      // списание
      if (isSpendingRow(row)) {
        s.totalSpend += calcSpend(row)
        s.spendCount++
      }
    }

    return Array.from(map.values())
      .filter(s =>
        s.totalAccrual > 0 &&
        s.role.trim() !== 'Продавец' &&
        (s.totalSpend / s.totalAccrual) <= 0.05   // утилизация ≤ 5%
      )
      .sort((a, b) => (b.totalAccrual - b.totalSpend) - (a.totalAccrual - a.totalSpend))
  }, [rawRows])

  // Контактные поля — ищем в первой строке данных
  const contactFields = useMemo(() => {
    if (rawRows.length === 0) return []
    const firstRow = rawRows[0] as Record<string, unknown>
    const CONTACT_PATTERNS = /phone|email|телефон|мобил|почт|контакт|contact/i
    return Object.keys(firstRow).filter(k => CONTACT_PATTERNS.test(k))
  }, [rawRows])

  const POLICY_LEVEL_FIELDS = new Set([
    'CreateDate', 'State', 'CrossIsBought', 'FinalPrice', 'PolicyPrice',
    'ChargedToIncreasedKV', 'LoyaltyPointsInLK', 'LoyaltyPointsScoring',
    'AvailableForUsePoints', 'QuotationNumber', '2490',
  ])

  function buildPartnerRow(p: typeof tenOrMore[number]): Record<string, unknown> {
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

  function handleDownload(group: typeof tenOrMore, filename: string) {
    downloadXlsx(group.map(p => buildPartnerRow(p)), filename)
  }

  function SummaryTable({ data }: { data: typeof tenOrMore }) {
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

  const totalEventsTen   = tenOrMore.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendTen    = tenOrMore.reduce((s, p) => s + p.totalSpend, 0)
  const totalEventsThree = threeToNine.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendThree  = threeToNine.reduce((s, p) => s + p.totalSpend, 0)
  const totalEventsB     = oneOrTwo.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendB      = oneOrTwo.reduce((s, p) => s + p.totalSpend, 0)

  return (
    <div className="space-y-6">

      {/* Сводный дашборд */}
      <SummaryDashboard rawRows={rawRows} />

      {/* Пояснение */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>Дашборд: Партнёры по частоте списания Рен-бонусов в 2026 году.</strong>{' '}
        Критерий списания: <code className="bg-blue-100 px-1 rounded">CrossIsBought = Да</code> и
        (ChargedToIncreasedKV ≠ 0 <em>или</em> FinalPrice ≠ PolicyPrice). Каждая такая строка = 1 событие.
        Группа «Списали 0 раз» — только партнёры, у которых за всю историю было хотя бы одно начисление.
      </div>

      {/* ── Четыре группы ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Группа 10+: супер-активные */}
        <div className="bg-white rounded-xl border border-emerald-300 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-emerald-800 text-base">🏆 Списали 10+ раз</h3>
              <p className="text-xs text-emerald-600 mt-0.5">Супер-активные пользователи (2026)</p>
            </div>
            <button
              onClick={() => handleDownload(tenOrMore, 'spent_10plus_2026.xlsx')}
              disabled={tenOrMore.length === 0}
              className="shrink-0 text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 border-b border-gray-100 bg-emerald-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-emerald-700">{fmtN(tenOrMore.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsTen)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Сумма, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendTen)}</p>
            </div>
          </div>
          <SummaryTable data={tenOrMore} />
        </div>

        {/* Группа 3–9: активные */}
        <div className="bg-white rounded-xl border border-green-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-green-50 border-b border-green-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-green-800 text-base">✅ Списали 3–9 раз</h3>
              <p className="text-xs text-green-600 mt-0.5">Активные пользователи (2026)</p>
            </div>
            <button
              onClick={() => handleDownload(threeToNine, 'spent_3_9_2026.xlsx')}
              disabled={threeToNine.length === 0}
              className="shrink-0 text-xs bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 border-b border-gray-100 bg-green-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-green-700">{fmtN(threeToNine.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsThree)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Сумма, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendThree)}</p>
            </div>
          </div>
          <SummaryTable data={threeToNine} />
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

      {/* ── Топ: копят, но не тратят ──────────────────────────────────── */}
      <UnderutilizersBlock
        data={underutilizers}
        contactFields={contactFields}
        onDownload={(rows) => {
          const out = rows.map(s => {
            const base = s.anyRow as Record<string, unknown>
            const r: Record<string, unknown> = {
              RenId: s.renId, ФИО: s.fullName, Роль: s.role,
            }
            for (const cf of contactFields) r[cf] = base[cf] ?? '—'
            r['Накоплено_РБ_всего']     = Math.round(s.totalAccrual)
            r['Событий_начисления']      = s.accrualCount
            r['Списано_РБ_всего']        = Math.round(s.totalSpend)
            r['Утилизация_%']            = s.totalAccrual > 0 ? Math.round((s.totalSpend / s.totalAccrual) * 100) : 0
            r['Последнее_начисление']    = fmtDate(s.lastAccrualDate)
            return r
          })
          downloadXlsx(out, 'underutilizers_top.xlsx')
        }}
      />

    </div>
  )
}

// ── Сводный дашборд ─────────────────────────────────────────────────────────
type GStats = { partners: Set<string>; osago25: number; kasko25: number; cross25: number; osago26: number; kasko26: number; cross26: number }

function SummaryDashboard({ rawRows }: { rawRows: RawRow[] }) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)

  const fmtPct2 = (num: number, den: number) =>
    den > 0 ? (num / den * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—'

  const G = useMemo(() => {
    const roleSet = new Set(selectedRoles)
    const EXCL = new Set(['PolicyAnnulled', 'PolicyTerminated'])

    const everAccrued = new Set<string>()
    for (const row of rawRows) {
      if (String(row.State ?? '') !== 'PolicyIssued') continue
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId || !roleSet.has(String(row['Role'] ?? '').trim())) continue
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNull(row.LoyaltyPointsInLK) && lp > 0) everAccrued.add(renId)
    }

    const spendCnt = new Map<string, number>()
    const partners2026 = new Set<string>()
    for (const row of rawRows) {
      if (parseYear(row.CreateDate) !== 2026) continue
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId || !roleSet.has(String(row['Role'] ?? '').trim())) continue
      partners2026.add(renId)
      if (isSpendingRow(row)) spendCnt.set(renId, (spendCnt.get(renId) ?? 0) + 1)
    }

    function grp(renId: string): 'ten' | 'three' | 'oneTwo' | 'zero' | 'noBal' | null {
      if (!partners2026.has(renId)) return null
      const c = spendCnt.get(renId) ?? 0
      if (c >= 10) return 'ten'
      if (c >= 3)  return 'three'
      if (c >= 1)  return 'oneTwo'
      return everAccrued.has(renId) ? 'zero' : 'noBal'
    }

    const mk = (): GStats => ({ partners: new Set(), osago25: 0, kasko25: 0, cross25: 0, osago26: 0, kasko26: 0, cross26: 0 })
    const result: Record<string, GStats> = { ten: mk(), three: mk(), oneTwo: mk(), zero: mk(), noBal: mk() }

    for (const renId of partners2026) {
      const g = grp(renId)
      if (g) result[g].partners.add(renId)
    }

    for (const row of rawRows) {
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId || !roleSet.has(String(row['Role'] ?? '').trim())) continue
      const g = grp(renId)
      if (!g) continue
      const yr = parseYear(row.CreateDate)
      if (yr !== 2025 && yr !== 2026) continue
      const state = String(row.State ?? '')
      if (EXCL.has(state)) continue
      const isIssued = state === 'PolicyIssued'
      const isCross  = String(row.CrossIsBought ?? '').trim() === 'Да'
      const st = result[g]
      if (yr === 2026) {
        if (isIssued)            st.osago26++
        if (isIssued && isCross) st.kasko26++
        if (isCross)             st.cross26++
      } else {
        if (isIssued)            st.osago25++
        if (isIssued && isCross) st.kasko25++
        if (isCross)             st.cross25++
      }
    }

    return result
  }, [rawRows, selectedRoles])

  const tableRows: { key: string; label: string; color: string }[] = [
    { key: 'noBal',  label: 'Не было начислений за все время', color: 'text-gray-500' },
    { key: 'zero',   label: '0 раз списали в 2026',             color: 'text-slate-600' },
    { key: 'oneTwo', label: '1–2 раза списали в 2026',          color: 'text-amber-700' },
    { key: 'three',  label: '3–9 раз списали в 2026',           color: 'text-green-700' },
    { key: 'ten',    label: '10+ раз списали в 2026',            color: 'text-emerald-700' },
  ]

  const total = {
    partners: tableRows.reduce((s, r) => s + G[r.key].partners.size, 0),
    osago25:  tableRows.reduce((s, r) => s + G[r.key].osago25, 0),
    kasko25:  tableRows.reduce((s, r) => s + G[r.key].kasko25, 0),
    osago26:  tableRows.reduce((s, r) => s + G[r.key].osago26, 0),
    kasko26:  tableRows.reduce((s, r) => s + G[r.key].kasko26, 0),
  }

  function toggleRole(role: string) {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }

  return (
    <div className="bg-white rounded-xl border border-blue-200 overflow-hidden shadow-sm">
      <div className="px-5 py-4 bg-blue-50 border-b border-blue-100 space-y-3">
        <h3 className="font-bold text-blue-800 text-base">Агенты 2026: сводка по группам списания</h3>

        {/* Фильтр по роли */}
        <div>
          <p className="text-xs font-semibold text-blue-700 mb-1.5">Фильтр по роли:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_ALLOWED_ROLES.map(role => (
              <label key={role} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(role)}
                  onChange={() => toggleRole(role)}
                  className="w-3.5 h-3.5 accent-blue-600"
                />
                <span className={selectedRoles.includes(role) ? 'text-blue-800 font-medium' : 'text-blue-300'}>
                  {role}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="text-xs text-blue-700 space-y-1.5">
          <p><strong>«Списали»</strong> — партнёр, у которого в 2026 г. есть хотя бы одна строка с CrossIsBought = Да <em>и</em> (ChargedToIncreasedKV ≠ 0 <em>или</em> FinalPrice ≠ PolicyPrice). Каждая такая строка = 1 событие списания Рен-бонусов в Каско от бесполисных.</p>
          <p><strong>Не было начислений за все время</strong> — партнёры выбранных ролей, у которых за всю историю нет ни одного начисления Рен-бонусов (нет строк с State = PolicyIssued и LoyaltyPointsInLK &gt; 0).</p>
          <p><strong>0 раз списали в 2026</strong> — есть начисления Рен-бонусов за всю историю, но в 2026 году ни одного события списания.</p>
          <p><strong>1–2 / 3–9 / 10+ раз в 2026</strong> — количество событий списания в 2026 году.</p>
          <p><strong>ОСАГО, шт.</strong> — оформленные полисы ОСАГО ФЛ (State = PolicyIssued) партнёров группы в 2026 г.</p>
          <p><strong>Каско от бесполисных, шт.</strong> — из полисов ОСАГО этих же партнёров дополнительно куплен Каско от бесполисных (CrossIsBought = Да).</p>
          <p><strong>Конверсия Бесполис</strong> — доля полисов ОСАГО, по которым куплен Каско от бесполисных: Каско / ОСАГО × 100%.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left">Использование Рен-бонусов</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Кол-во партнёров</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Доля</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">ОСАГО, шт.</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Каско от бесполисных, шт.</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Конверсия Бесполис 2025</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Конверсия Бесполис 2026</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ key, label, color }) => {
              const g = G[key]
              const cnt = g.partners.size
              return (
                <tr key={key} className="border-t border-gray-100 hover:bg-blue-50/30 transition-colors">
                  <td className={`px-4 py-2.5 font-medium ${color}`}>{label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">{fmtN(cnt)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{fmtPct2(cnt, total.partners)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtN(g.osago26)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmtN(g.kasko26)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-600">{fmtPct2(g.kasko25, g.osago25)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-700 font-semibold">{fmtPct2(g.kasko26, g.osago26)}</td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2.5 text-gray-800">Общий итог</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{fmtN(total.partners)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">100,00%</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{fmtN(total.osago26)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmtN(total.kasko26)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-blue-600">{fmtPct2(total.kasko25, total.osago25)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-blue-700">{fmtPct2(total.kasko26, total.osago26)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Компонент «Копят, но не тратят» ────────────────────────────────────────
type UEntry = {
  renId: string; fullName: string; role: string; anyRow: RawRow
  totalAccrual: number; accrualCount: number
  totalSpend: number; spendCount: number
  lastAccrualDate: Date | null
}

function UnderutilizersBlock({
  data, contactFields, onDownload,
}: {
  data: UEntry[]
  contactFields: string[]
  onDownload: (rows: UEntry[]) => void
}) {
  const TOP = 15
  const top = data.slice(0, TOP)
  if (top.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-purple-200 overflow-hidden shadow-sm">

      {/* Шапка */}
      <div className="px-5 py-4 bg-purple-50 border-b border-purple-200 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-purple-800 text-base">
            💡 Топ-{TOP}: копят, но не используют баллы
          </h3>
          <p className="text-xs text-purple-500 mt-0.5">
            Ранжированы по неиспользованному остатку РБ (накоплено − списано) за всю историю.
            Потенциальные клиенты для активации программы.
          </p>
        </div>
        <button
          onClick={() => onDownload(data)}
          className="shrink-0 text-xs bg-purple-600 text-white hover:bg-purple-700 px-3 py-1.5 rounded-full transition-colors font-medium"
        >
          ↓ xlsx (все)
        </button>
      </div>

      {/* Таблица */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="px-4 py-2 text-left whitespace-nowrap">#</th>
              <th className="px-4 py-2 text-left whitespace-nowrap">ФИО / RenId</th>
              <th className="px-4 py-2 text-left whitespace-nowrap">Роль</th>
              {contactFields.map(cf => (
                <th key={cf} className="px-4 py-2 text-left whitespace-nowrap">{cf}</th>
              ))}
              <th className="px-4 py-2 text-right whitespace-nowrap">Накоплено, РБ</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Начислений</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Списано, РБ</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Утилизация</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Посл. начисление</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s, i) => {
              const base = s.anyRow as Record<string, unknown>
              const unused = s.totalAccrual - s.totalSpend
              const isZeroSpend = s.spendCount === 0
              return (
                <tr key={s.renId} className="border-t border-gray-100 hover:bg-purple-50/30 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400 font-medium">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-gray-800">{s.fullName}</span>
                    <span className="block text-xs text-gray-400">{s.renId}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{s.role}</td>
                  {contactFields.map(cf => (
                    <td key={cf} className="px-4 py-2.5 text-xs text-gray-700 whitespace-nowrap">
                      {String(base[cf] ?? '—')}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">
                    {fmtN(s.totalAccrual)}
                    <span className="block text-[10px] text-purple-400 font-normal">
                      не исп.: {fmtN(unused)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {s.accrualCount}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">
                    {s.totalSpend > 0 ? fmtN(s.totalSpend) : (
                      <span className="text-red-400 font-medium">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={`font-semibold ${isZeroSpend ? 'text-red-500' : 'text-amber-600'}`}>
                      {fmtPct(s.totalSpend, s.totalAccrual)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500 whitespace-nowrap">
                    {fmtDate(s.lastAccrualDate)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 bg-purple-50/50 border-t border-purple-100 text-xs text-purple-400">
        Показаны топ-{TOP} из {data.length} партнёров с начислениями. Кнопка «xlsx» выгружает всех.
      </div>
    </div>
  )
}
