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

    // Шаг 2: считаем события списания за всю историю
    for (const row of rawRows) {
      if (!isSpendingRow(row)) continue
      const renId = String(row['RenId'] ?? '').trim()
      const p = partnerMap.get(renId)
      if (!p) continue
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

    // Группа C: 0 списаний за всю историю, но хоть раз начисляли
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
      .sort((a, b) => {
        // Первичная: больше накоплений; вторичная: ниже утилизация
        if (b.totalAccrual !== a.totalAccrual) return b.totalAccrual - a.totalAccrual
        const uA = a.totalAccrual > 0 ? a.totalSpend / a.totalAccrual : 0
        const uB = b.totalAccrual > 0 ? b.totalSpend / b.totalAccrual : 0
        return uA - uB
      })
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
    out['Кол-во_списаний_всего'] = p.spendRows.length
    out['Сумма_РБ_всего']        = Math.round(p.totalSpend)
    return out
  }

  function handleDownload(group: typeof tenOrMore, filename: string) {
    downloadXlsx(group.map(p => buildPartnerRow(p)), filename)
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


      {/* ── Четыре группы ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Группа 10+: супер-активные */}
        <div className="bg-white rounded-xl border border-emerald-300 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-emerald-800 text-base">🏆 Списали 10+ раз</h3>
              <p className="text-xs text-emerald-600 mt-0.5">Супер-активные пользователи</p>
            </div>
            <button
              onClick={() => handleDownload(tenOrMore, 'spent_10plus_2026.xlsx')}
              disabled={tenOrMore.length === 0}
              className="shrink-0 text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 bg-emerald-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-emerald-700">{fmtN(tenOrMore.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsTen)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Списано, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendTen)}</p>
            </div>
          </div>
        </div>

        {/* Группа 3–9: активные */}
        <div className="bg-white rounded-xl border border-green-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-green-50 border-b border-green-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-green-800 text-base">✅ Списали 3–9 раз</h3>
              <p className="text-xs text-green-600 mt-0.5">Активные пользователи</p>
            </div>
            <button
              onClick={() => handleDownload(threeToNine, 'spent_3_9_2026.xlsx')}
              disabled={threeToNine.length === 0}
              className="shrink-0 text-xs bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 bg-green-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-green-700">{fmtN(threeToNine.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsThree)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Списано, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendThree)}</p>
            </div>
          </div>
        </div>

        {/* Группа B: 1–2 списания */}
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-amber-800 text-base">⚠️ Списали 1–2 раза</h3>
              <p className="text-xs text-amber-600 mt-0.5">Низкая активность</p>
            </div>
            <button
              onClick={() => handleDownload(oneOrTwo, 'spent_1_2_2026.xlsx')}
              disabled={oneOrTwo.length === 0}
              className="shrink-0 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 bg-amber-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-amber-700">{fmtN(oneOrTwo.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Событий</p>
              <p className="text-3xl font-bold text-gray-800">{fmtN(totalEventsB)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Списано, РБ</p>
              <p className="text-3xl font-bold text-indigo-700">{fmtN(totalSpendB)}</p>
            </div>
          </div>
        </div>

        {/* Группа C: 0 списаний, но с историей начислений */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-700 text-base">🔴 Списали 0 раз</h3>
              <p className="text-xs text-slate-500 mt-0.5">Есть начисления за всю историю, но ни разу не списывали</p>
            </div>
            <button
              onClick={() => handleDownload(neverSpent, 'spent_0_with_accruals_2026.xlsx')}
              disabled={neverSpent.length === 0}
              className="shrink-0 text-xs bg-slate-500 text-white hover:bg-slate-600 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-full transition-colors font-medium"
            >↓ xlsx</button>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5 bg-slate-50/30">
            <div>
              <p className="text-xs text-gray-500">Партнёров</p>
              <p className="text-3xl font-bold text-slate-600">{fmtN(neverSpent.length)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Списаний всего</p>
              <p className="text-3xl font-bold text-gray-400">0</p>
            </div>
          </div>
        </div>

      </div>

      <p className="text-xs text-gray-400 px-1">
        Excel-выгрузка: одна строка на партнёра со всеми идентификационными полями из исходника
        + Кол-во_списаний_2026 и Сумма_РБ_2026.
      </p>

      {/* ── Динамика по месяцам ───────────────────────────────────────── */}
      <EngagementTrend rawRows={rawRows} />

      {/* ── Топ: копят, но не тратят ──────────────────────────────────── */}
      <UnderutilizersBlock
        data={underutilizers}
        contactFields={contactFields}
        onDownload={(rows) => {
          // Группируем по HeadPartnerCB, внутри группы — по убыванию накоплений
          type Group = { head: string; entries: typeof rows }
          const groupMap = new Map<string, typeof rows>()
          for (const s of rows) {
            const raw = s.anyRow as Record<string, unknown>
            const head = String(raw['HeadPartnerCB'] ?? raw['HeadPartner'] ?? '—').trim() || '—'
            if (!groupMap.has(head)) groupMap.set(head, [])
            groupMap.get(head)!.push(s)
          }
          // Группы сортируем по суммарному накоплению убывания
          const groups: Group[] = Array.from(groupMap.entries())
            .map(([head, entries]) => ({ head, entries: entries.sort((a, b) => b.totalAccrual - a.totalAccrual) }))
            .sort((a, b) => b.entries.reduce((s, e) => s + e.totalAccrual, 0) - a.entries.reduce((s, e) => s + e.totalAccrual, 0))

          const out: Record<string, unknown>[] = []
          for (const g of groups) {
            for (const s of g.entries) {
              const raw = s.anyRow as Record<string, unknown>
              const r: Record<string, unknown> = {
                HeadPartnerCB: g.head,
                CashbookId:    String(raw['CashbookId'] ?? '—').trim(),
                RenId: s.renId, ФИО: s.fullName, Роль: s.role,
              }
              for (const cf of contactFields) r[cf] = raw[cf] ?? '—'
              r['Накоплено_РБ']        = Math.round(s.totalAccrual)
              r['Событий_начисления']  = s.accrualCount
              r['Кол-во_списаний']     = s.spendCount
              r['Списано_РБ']          = Math.round(s.totalSpend)
              r['Утилизация_%']        = s.totalAccrual > 0 ? Math.round((s.totalSpend / s.totalAccrual) * 100) : 0
              r['Последнее_начисление'] = fmtDate(s.lastAccrualDate)
              out.push(r)
            }
          }
          downloadXlsx(out, 'underutilizers_all.xlsx')
        }}
      />

    </div>
  )
}

// ── Сводный дашборд ─────────────────────────────────────────────────────────
type SAgg = { osago25: number; kasko25: number; osago26: number; kasko26: number }

function SummaryDashboard({ rawRows }: { rawRows: RawRow[] }) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)
  const [methodologyOpen, setMethodologyOpen] = useState(false)

  const G = useMemo(() => {
    const roleSet = new Set(selectedRoles)
    const EXCL = new Set(['PolicyAnnulled', 'PolicyTerminated'])

    const everIssued   = new Set<string>()
    const everAccrued  = new Set<string>()
    const spendCntEver = new Map<string, number>()
    for (const row of rawRows) {
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId) continue
      if (String(row.State ?? '') === 'PolicyIssued') {
        everIssued.add(renId)
        const lp = toNum(row.LoyaltyPointsInLK)
        if (!isNull(row.LoyaltyPointsInLK) && lp > 0) everAccrued.add(renId)
      }
      if (isSpendingRow(row)) spendCntEver.set(renId, (spendCntEver.get(renId) ?? 0) + 1)
    }

    const partners2026 = new Set<string>()
    for (const row of rawRows) {
      if (parseYear(row.CreateDate) !== 2026) continue
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId || !roleSet.has(String(row['Role'] ?? '').trim())) continue
      partners2026.add(renId)
    }

    type GKey = 'noIssued' | 'noBal' | 'zero' | 'oneTwo' | 'three' | 'ten'
    function grp(renId: string): GKey | null {
      if (!partners2026.has(renId)) return null
      if (!everIssued.has(renId))  return 'noIssued'
      if (!everAccrued.has(renId)) return 'noBal'
      const c = spendCntEver.get(renId) ?? 0
      if (c >= 10) return 'ten'
      if (c >= 3)  return 'three'
      if (c >= 1)  return 'oneTwo'
      return 'zero'
    }

    const cnt: Record<GKey, number> = { noIssued: 0, noBal: 0, zero: 0, oneTwo: 0, three: 0, ten: 0 }
    for (const renId of partners2026) {
      const g = grp(renId)
      if (g) cnt[g]++
    }

    const mkA = (): SAgg => ({ osago25: 0, kasko25: 0, osago26: 0, kasko26: 0 })
    const agg: Record<GKey, SAgg> = {
      noIssued: mkA(), noBal: mkA(), zero: mkA(), oneTwo: mkA(), three: mkA(), ten: mkA(),
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
      const st = agg[g]
      if (yr === 2026) {
        if (isIssued)            st.osago26++
        if (isIssued && isCross) st.kasko26++
      } else {
        if (isIssued)            st.osago25++
        if (isIssued && isCross) st.kasko25++
      }
    }

    return { cnt, agg, total: partners2026.size }
  }, [rawRows, selectedRoles])

  const withBalTotal = G.cnt.zero + G.cnt.oneTwo + G.cnt.three + G.cnt.ten
  const total = G.total

  const fmtPct = (num: number, den: number) =>
    den > 0 ? (num / den * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—'

  // Суммарные агрегаты для withBal строк
  const spendKeys = ['zero', 'oneTwo', 'three', 'ten'] as const
  const totalAgg: SAgg = {
    osago25: spendKeys.reduce((s, k) => s + G.agg[k].osago25, 0),
    kasko25: spendKeys.reduce((s, k) => s + G.agg[k].kasko25, 0),
    osago26: spendKeys.reduce((s, k) => s + G.agg[k].osago26, 0),
    kasko26: spendKeys.reduce((s, k) => s + G.agg[k].kasko26, 0),
  }

  function toggleRole(role: string) {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }

  const spendRows: { key: typeof spendKeys[number]; label: string; color: string }[] = [
    { key: 'zero',   label: '0 раз — не списывали',  color: 'text-slate-600' },
    { key: 'oneTwo', label: '1–2 раза',               color: 'text-amber-700' },
    { key: 'three',  label: '3–9 раз',                color: 'text-green-700' },
    { key: 'ten',    label: '10+ раз',                color: 'text-emerald-700' },
  ]

  return (
    <div className="bg-white rounded-xl border border-blue-200 overflow-hidden shadow-sm">

      {/* Шапка */}
      <div className="px-5 py-4 bg-blue-50 border-b border-blue-100 space-y-3">
        <h3 className="font-bold text-blue-800 text-base">Вовлечённость партнёров в программу лояльности</h3>

        {/* Фильтр по роли */}
        <div>
          <p className="text-xs font-semibold text-blue-700 mb-1.5">Фильтр по роли:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_ALLOWED_ROLES.map(role => (
              <label key={role} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={selectedRoles.includes(role)}
                  onChange={() => toggleRole(role)} className="w-3.5 h-3.5 accent-blue-600" />
                <span className={selectedRoles.includes(role) ? 'text-blue-800 font-medium' : 'text-blue-300'}>{role}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Методология — сворачиваемая */}
        <div>
          <button
            onClick={() => setMethodologyOpen(o => !o)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            <span>{methodologyOpen ? '▾' : '▸'}</span>
            <span>Методология</span>
          </button>
          {methodologyOpen && (
            <div className="mt-2 text-xs text-blue-700 space-y-1 border-t border-blue-100 pt-2">
              <p>Партнёры из данных 2026 года. Вся история — данные за все годы из загруженного файла.</p>
              <p><strong>Нет оформленных ОСАГО, только котировки</strong> — за всю историю нет ни одной строки State = PolicyIssued.</p>
              <p><strong>Есть ОСАГО, без начислений РБ</strong> — PolicyIssued есть, но LoyaltyPointsInLK никогда не был &gt; 0.</p>
              <p><strong>Есть ОСАГО с РБ</strong> — был хоть раз PolicyIssued с LoyaltyPointsInLK &gt; 0. Разбивка по частоте списания Рен-бонусов за всю историю.</p>
              <p><strong>«Списание РБ»</strong> — строка с CrossIsBought = Да и (ChargedToIncreasedKV ≠ 0 или FinalPrice ≠ PolicyPrice).</p>
              <p><strong>ОСАГО, шт.</strong> — оформленные полисы (State = PolicyIssued) партнёров группы в 2026 г.</p>
              <p><strong>Каско от бесполисных, шт.</strong> — из них куплен Каско от бесполисных (CrossIsBought = Да).</p>
              <p><strong>Конверсия Бесполис</strong> — Каско / ОСАГО × 100%.</p>
            </div>
          )}
        </div>
      </div>

      {/* Три KPI-карточки */}
      {(() => {
        const hasIssued = G.cnt.noBal + withBalTotal
        return (
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
            <div className="px-5 py-4 bg-gray-50">
              <p className="text-xs text-gray-500 font-medium mb-1 leading-snug">Нет оформленных ОСАГО, только котировки</p>
              <p className="text-3xl font-bold text-gray-500">{fmtN(G.cnt.noIssued)} <span className="text-sm font-normal text-gray-400">партнёров</span></p>
              <p className="text-sm text-gray-400 mt-0.5">{fmtPct(G.cnt.noIssued, total)} от всех</p>
            </div>
            <div className="px-5 py-4 bg-gray-50">
              <p className="text-xs text-gray-500 font-medium mb-1 leading-snug">Есть ОСАГО, без начислений РБ</p>
              <p className="text-3xl font-bold text-gray-600">{fmtN(G.cnt.noBal)} <span className="text-sm font-normal text-gray-400">партнёров</span></p>
              <p className="text-sm text-gray-400 mt-0.5">{fmtPct(G.cnt.noBal, total)} от всех</p>
              <p className="text-xs text-gray-400 mt-0.5">{fmtPct(G.cnt.noBal, hasIssued)} из имеющих ОСАГО</p>
            </div>
            <div className="px-5 py-4 bg-blue-50">
              <p className="text-xs text-blue-700 font-medium mb-1 leading-snug">Есть ОСАГО с начислением РБ</p>
              <p className="text-3xl font-bold text-blue-700">{fmtN(withBalTotal)} <span className="text-sm font-normal text-blue-400">партнёров</span></p>
              <p className="text-sm text-blue-500 mt-0.5">{fmtPct(withBalTotal, total)} от всех</p>
              <p className="text-xs text-gray-400 mt-0.5">{fmtPct(withBalTotal, hasIssued)} из имеющих ОСАГО</p>
            </div>
          </div>
        )
      })()}

      {/* Разбивка по частоте списания */}
      <div className="px-5 py-3 bg-blue-50/40 border-b border-blue-100">
        <p className="text-xs font-semibold text-blue-700">
          Из {fmtN(withBalTotal)} партнёров с начислениями РБ — частота списания за всю историю:
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left whitespace-nowrap">Частота списания РБ</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Партнёров</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">% от группы с РБ</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">% от всех</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">ОСАГО</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Каско, шт.</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Конв. '25</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Конв. '26</th>
            </tr>
          </thead>
          <tbody>
            {spendRows.map(({ key, label, color }) => {
              const a = G.agg[key]
              return (
                <tr key={key} className="border-t border-gray-100 hover:bg-blue-50/30 transition-colors">
                  <td className={`px-4 py-2.5 font-medium ${color}`}>{label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">{fmtN(G.cnt[key])}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-600">{fmtPct(G.cnt[key], withBalTotal)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{fmtPct(G.cnt[key], total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtN(a.osago26)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmtN(a.kasko26)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-500">{fmtPct(a.kasko25, a.osago25)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-700 font-semibold">{fmtPct(a.kasko26, a.osago26)}</td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-blue-200 bg-blue-50 font-semibold">
              <td className="px-4 py-2.5 text-blue-800">Итого с РБ</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-blue-800">{fmtN(withBalTotal)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-blue-600">100,0%</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{fmtPct(withBalTotal, total)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{fmtN(totalAgg.osago26)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmtN(totalAgg.kasko26)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-blue-500">{fmtPct(totalAgg.kasko25, totalAgg.osago25)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-blue-700">{fmtPct(totalAgg.kasko26, totalAgg.osago26)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Динамика вовлечённости по месяцам ───────────────────────────────────────
type GK = 'zero' | 'oneTwo' | 'three' | 'ten'
const GKS: GK[] = ['zero', 'oneTwo', 'three', 'ten']
const GK_LABEL: Record<GK, string> = { zero: '0 раз', oneTwo: '1–2', three: '3–9', ten: '10+' }
const GK_COLOR: Record<GK, string> = {
  zero: '#94a3b8', oneTwo: '#fbbf24', three: '#4ade80', ten: '#059669',
}
const GK_TEXT: Record<GK, string> = {
  zero: 'text-slate-500', oneTwo: 'text-amber-600', three: 'text-green-700', ten: 'text-emerald-700',
}

function EngagementTrend({ rawRows }: { rawRows: RawRow[] }) {
  const { rows: data, N } = useMemo(() => {
    // 1. Фиксированная база: everAccrued ∩ partners2026 (как в SummaryDashboard)
    const ROLES = new Set(ALL_ALLOWED_ROLES)
    const everAccrued = new Set<string>()
    for (const row of rawRows) {
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || String(row.State ?? '') !== 'PolicyIssued') continue
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNull(row.LoyaltyPointsInLK) && lp > 0) everAccrued.add(rid)
    }
    const partners2026 = new Set<string>()
    for (const row of rawRows) {
      if (parseYear(row.CreateDate) !== 2026) continue
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || !ROLES.has(String(row['Role'] ?? '').trim())) continue
      partners2026.add(rid)
    }
    // База = только партнёры активные в 2026 с начислениями РБ
    const base = new Set<string>()
    for (const rid of everAccrued) { if (partners2026.has(rid)) base.add(rid) }
    const N = base.size

    // 2. Временные метки событий списания по партнёру (отсортированные)
    const spendTs = new Map<string, number[]>()
    for (const row of rawRows) {
      if (!isSpendingRow(row)) continue
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || !base.has(rid)) continue
      const d = parseDate(row.CreateDate)
      if (!d) continue
      if (!spendTs.has(rid)) spendTs.set(rid, [])
      spendTs.get(rid)!.push(d.getTime())
    }
    for (const ts of spendTs.values()) ts.sort((a, b) => a - b)

    // 3. ОСАГО/Каско по месяцам (только для партнёров из базы, с разрешёнными ролями)
    const monthSet = new Set<string>()
    const mOsago = new Map<string, Map<string, { o: number; k: number }>>()

    for (const row of rawRows) {
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || !base.has(rid)) continue
      const d = parseDate(row.CreateDate)
      if (!d) continue
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      if (ym < '2025-08') continue  // начинаем с августа 2025
      monthSet.add(ym)
      if (!ROLES.has(String(row['Role'] ?? '').trim())) continue
      if (String(row.State ?? '') !== 'PolicyIssued') continue
      if (!mOsago.has(ym)) mOsago.set(ym, new Map())
      const mm = mOsago.get(ym)!
      if (!mm.has(rid)) mm.set(rid, { o: 0, k: 0 })
      const e = mm.get(rid)!
      e.o++
      if (String(row.CrossIsBought ?? '').trim() === 'Да') e.k++
    }

    const months = Array.from(monthSet).sort()

    // 4. Накопительный обход: для каждого месяца — группа партнёра на конец месяца
    const grp = (c: number): GK => c >= 10 ? 'ten' : c >= 3 ? 'three' : c >= 1 ? 'oneTwo' : 'zero'
    const cumCnt = new Map<string, number>()
    for (const rid of base) cumCnt.set(rid, 0)
    const ptrs = new Map<string, number>()
    for (const rid of spendTs.keys()) ptrs.set(rid, 0)

    const rows = months.map(ym => {
      const [y, mo] = ym.split('-').map(Number)
      const endMs = Date.UTC(y, mo, 1) - 1  // последняя мс месяца

      // Добавляем накопленные списания до конца этого месяца
      for (const [rid, ts] of spendTs) {
        let p = ptrs.get(rid) ?? 0
        while (p < ts.length && ts[p] <= endMs) {
          cumCnt.set(rid, (cumCnt.get(rid) ?? 0) + 1)
          p++
        }
        ptrs.set(rid, p)
      }

      // Распределение по группам на этот момент (вся база N)
      const dist: Record<GK, number> = { zero: 0, oneTwo: 0, three: 0, ten: 0 }
      for (const rid of base) dist[grp(cumCnt.get(rid) ?? 0)]++

      // Конверсия в этом месяце по группе (группа = накопленная на этот момент)
      const osago: Record<GK, number> = { zero: 0, oneTwo: 0, three: 0, ten: 0 }
      const kasko: Record<GK, number> = { zero: 0, oneTwo: 0, three: 0, ten: 0 }
      const mm = mOsago.get(ym)
      if (mm) {
        for (const [rid, e] of mm) {
          const g = grp(cumCnt.get(rid) ?? 0)
          osago[g] += e.o
          kasko[g] += e.k
        }
      }

      return { ym, dist, osago, kasko }
    })

    return { rows, N }
  }, [rawRows])

  const fmtYM = (ym: string) => {
    const [y, mo] = ym.split('-')
    const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
    return `${names[parseInt(mo) - 1]} '${y.slice(2)}`
  }

  const fmtPctLocal = (num: number, den: number) =>
    den > 0 ? (num / den * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—'

  return (
    <div className="bg-white rounded-xl border border-indigo-100 overflow-hidden shadow-sm">
      <div className="px-5 py-4 bg-indigo-50 border-b border-indigo-100">
        <h3 className="font-bold text-indigo-900 text-base">Динамика вовлечённости по месяцам</h3>
        <p className="text-xs text-indigo-500 mt-1">
          Фиксированная база: <strong>{fmtN(N)}</strong> партнёров с начислениями РБ.
          Группы — накопительно на конец каждого месяца. Партнёр перетекает в следующую группу по мере накопления списаний.
          Конверсия — Каско / ОСАГО в конкретном месяце.
        </p>
        <div className="flex flex-wrap gap-4 mt-2">
          {GKS.map(g => (
            <span key={g} className="flex items-center gap-1 text-xs text-gray-600">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: GK_COLOR[g] }} />
              {GK_LABEL[g]}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr className="border-b border-gray-200">
              <th className="px-4 py-2 text-left" rowSpan={2}>Месяц</th>
              <th className="px-4 py-2 text-center border-l border-gray-100" colSpan={5}>Доля в группе (накопит.), % из {fmtN(N)}</th>
              <th className="px-4 py-2 text-center border-l border-gray-200" colSpan={4}>Конв. ОСАГО→Каско в месяце</th>
            </tr>
            <tr className="border-b border-gray-200">
              {GKS.map(g => (
                <th key={g} className={`px-3 py-1.5 text-center font-semibold ${GK_TEXT[g]}`}>{GK_LABEL[g]}</th>
              ))}
              <th className="px-3 py-1.5 text-center text-gray-400">Бар</th>
              {GKS.map(g => (
                <th key={g} className={`px-3 py-1.5 text-center font-semibold ${GK_TEXT[g]}`}>{GK_LABEL[g]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(m => {
              const pcts = GKS.map(g => N > 0 ? (m.dist[g] / N) * 100 : 0)
              return (
                <tr key={m.ym} className="border-t border-gray-100 hover:bg-indigo-50/30 transition-colors">
                  <td className="px-4 py-2 font-medium text-gray-700 whitespace-nowrap">{fmtYM(m.ym)}</td>
                  {GKS.map((g, i) => (
                    <td key={g} className={`px-3 py-2 text-center tabular-nums ${GK_TEXT[g]}`}>
                      {`${Math.round(pcts[i])}%`}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex h-3 rounded overflow-hidden w-20">
                      {GKS.map((g, i) => (
                        <div key={g} style={{ width: `${pcts[i]}%`, backgroundColor: GK_COLOR[g] }}
                          title={`${GK_LABEL[g]}: ${Math.round(pcts[i])}%`} />
                      ))}
                    </div>
                  </td>
                  {GKS.map(g => (
                    <td key={g} className={`px-3 py-2 text-center tabular-nums font-medium ${GK_TEXT[g]}`}>
                      {fmtPctLocal(m.kasko[g], m.osago[g])}
                    </td>
                  ))}
                </tr>
              )
            })}
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
              <th className="px-4 py-2 text-right whitespace-nowrap">Списаний</th>
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
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                    {s.spendCount > 0 ? s.spendCount : <span className="text-red-400 font-medium">0</span>}
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
