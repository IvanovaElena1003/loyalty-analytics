import { useMemo, useState } from 'react'
import type { RawRow } from '../../types'
import { downloadXlsx } from '../../utils/engagement'

interface Props { rawRows: RawRow[]; agentRows?: RawRow[]; lockedCurator?: string }

// ─── Фильтры агентской сети ──────────────────────────────────────────────────
const AGENT_FILTER_KEYS = ['ДИВИЗИОН', 'ФИЛИАЛ', 'УПРАВЛЕНИЕ', 'КОД_КП', 'КУРАТОР', 'ПОСРЕДНИК'] as const
type AgentFilterKey = typeof AGENT_FILTER_KEYS[number]
type AgentFilters = Record<AgentFilterKey, string[]>
const EMPTY_AGENT_FILTERS: AgentFilters = { ДИВИЗИОН: [], ФИЛИАЛ: [], УПРАВЛЕНИЕ: [], КОД_КП: [], КУРАТОР: [], ПОСРЕДНИК: [] }
const AGENT_FILTER_LABELS: Record<AgentFilterKey, string> = {
  ДИВИЗИОН: 'Дивизион', ФИЛИАЛ: 'Филиал', УПРАВЛЕНИЕ: 'Управление',
  КОД_КП: 'Код КП', КУРАТОР: 'Куратор', ПОСРЕДНИК: 'Посредник',
}

function AgentFilterBar({
  enrichedRows, filters, setFilters, lockedCurator,
}: {
  enrichedRows: RawRow[]
  filters: AgentFilters
  setFilters: React.Dispatch<React.SetStateAction<AgentFilters>>
  lockedCurator?: string
}) {
  const [open, setOpen] = useState<AgentFilterKey | null>(null)

  const options = useMemo(() => {
    const sets = Object.fromEntries(AGENT_FILTER_KEYS.map(k => [k, new Set<string>()])) as Record<AgentFilterKey, Set<string>>
    for (const r of enrichedRows) {
      for (const k of AGENT_FILTER_KEYS) {
        const v = String(r[k] ?? '').trim()
        if (v && v !== '[NULL]' && v !== 'null') sets[k].add(v)
      }
    }
    return Object.fromEntries(
      AGENT_FILTER_KEYS.map(k => [k, [...sets[k]].sort()])
    ) as Record<AgentFilterKey, string[]>
  }, [enrichedRows])

  const activeCount = AGENT_FILTER_KEYS.filter(k => filters[k].length > 0).length

  function toggle(key: AgentFilterKey, value: string) {
    setFilters(prev => {
      const cur = prev[key]
      return { ...prev, [key]: cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value] }
    })
  }

  return (
    <div className="bg-white border border-blue-200 rounded-xl p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-800">🔍 Фильтры по агентской сети</span>
          {activeCount > 0 && (
            <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">{activeCount} активных</span>
          )}
        </div>
        {activeCount > 0 && (
          <button onClick={() => setFilters(EMPTY_AGENT_FILTERS)}
            className="text-xs text-blue-500 hover:text-blue-700 transition-colors">
            Сбросить всё
          </button>
        )}
      </div>

      {lockedCurator && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs bg-blue-100 text-blue-700 border border-blue-300 px-3 py-1 rounded-lg font-medium">
            🔒 Куратор: {lockedCurator}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {AGENT_FILTER_KEYS.map(key => {
          const opts = options[key]
          const sel  = filters[key]
          const isOpen = open === key
          if (opts.length === 0) return null
          if (key === 'КУРАТОР' && lockedCurator) return null
          return (
            <div key={key} className="relative">
              <button
                onClick={() => setOpen(isOpen ? null : key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  sel.length > 0
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                <span>{AGENT_FILTER_LABELS[key]}</span>
                {sel.length > 0 && <span className="bg-white/30 rounded px-1">{sel.length}</span>}
                <span className="opacity-60">{isOpen ? '▴' : '▾'}</span>
              </button>

              {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[200px] max-w-[280px]">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-600">{AGENT_FILTER_LABELS[key]}</span>
                    {sel.length > 0 && (
                      <button onClick={() => setFilters(p => ({ ...p, [key]: [] }))}
                        className="text-[10px] text-blue-500 hover:text-blue-700">
                        Сбросить
                      </button>
                    )}
                  </div>
                  <div className="max-h-52 overflow-y-auto py-1">
                    {opts.map(v => (
                      <label key={v} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={sel.includes(v)} onChange={() => toggle(key, v)}
                          className="w-3.5 h-3.5 accent-blue-600 flex-shrink-0" />
                        <span className={`text-xs truncate ${sel.includes(v) ? 'font-medium text-gray-800' : 'text-gray-600'}`}>{v}</span>
                      </label>
                    ))}
                  </div>
                  <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400">
                    {sel.length === 0 ? `Все ${opts.length}` : `Выбрано ${sel.length} из ${opts.length}`}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}


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
export default function KeyMetricsTab({ rawRows, agentRows, lockedCurator }: Props) {
  const [agentFilters, setAgentFilters] = useState<AgentFilters>(() =>
    lockedCurator
      ? { ...EMPTY_AGENT_FILTERS, КУРАТОР: [lockedCurator] }
      : EMPTY_AGENT_FILTERS
  )

  // Join: добавляем только нужные поля из агентской сети (не спредим весь объект — экономим память)
  const enrichedRows = useMemo<RawRow[]>(() => {
    if (!agentRows || agentRows.length === 0) return rawRows
    const lookup = new Map<string, RawRow>()
    for (const r of agentRows) {
      const id = String(r['subj_id'] ?? '').trim()
      if (id && id !== 'null') lookup.set(id, r)
    }
    return rawRows.map(r => {
      const cb  = String(r['CashbookId'] ?? '').trim()
      const hcb = String(r['HeadPartnerCB'] ?? '').trim()
      const key = (cb && cb !== '[NULL]') ? cb : hcb
      const agent = key ? lookup.get(key) : undefined
      if (!agent) return r
      // Добавляем только 6 фильтровых полей — не копируем весь объект агента
      const extra: Record<string, unknown> = {}
      for (const k of AGENT_FILTER_KEYS) extra[k] = agent[k] ?? null
      return { ...r, ...extra }
    })
  }, [rawRows, agentRows])

  // Применяем фильтры агентской сети
  const filteredRows = useMemo<RawRow[]>(() => {
    const active = AGENT_FILTER_KEYS.filter(k => agentFilters[k].length > 0)
    if (active.length === 0) return enrichedRows
    return enrichedRows.filter(r =>
      active.every(k => agentFilters[k].includes(String(r[k] ?? '').trim()))
    )
  }, [enrichedRows, agentFilters])

  const ALLOWED_ROLES = new Set(ALL_ALLOWED_ROLES)

  const { tenOrMore, threeToNine, oneOrTwo, neverSpent } = useMemo(() => {
    type PartnerData = {
      renId: string
      fullName: string
      role: string
      anyRow: RawRow
      spendRows: RawRow[]
      totalSpend: number
      totalAccrual: number
      accrualCount: number
      lastAccrualDate: Date | null
    }

    // Шаг 0: партнёры, у которых хоть раз было начисление за ВСЮ историю
    const everAccrued = new Set<string>()
    for (const row of filteredRows) {
      if (String(row.State ?? '') !== 'PolicyIssued') continue
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId) continue
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNull(row.LoyaltyPointsInLK) && lp > 0) everAccrued.add(renId)
    }

    const partnerMap = new Map<string, PartnerData>()

    // Шаг 1: партнёры с начислениями за всю историю с разрешёнными ролями
    for (const row of filteredRows) {
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
          totalAccrual: 0,
          accrualCount: 0,
          lastAccrualDate: null,
        })
      }
      const p = partnerMap.get(renId)!
      if ((!p.fullName || p.fullName === '—') && row['FullName']) {
        p.fullName = String(row['FullName']).trim()
      }
    }

    // Шаг 2: считаем события списания и начисления за всю историю
    for (const row of filteredRows) {
      const renId = String(row['RenId'] ?? '').trim()
      const p = partnerMap.get(renId)
      if (!p) continue
      if (isSpendingRow(row)) {
        p.spendRows.push(row)
        p.totalSpend += calcSpend(row)
      }
      if (String(row.State ?? '') === 'PolicyIssued') {
        const lp = toNum(row.LoyaltyPointsInLK)
        if (!isNull(row.LoyaltyPointsInLK) && lp > 0) {
          p.totalAccrual += lp
          p.accrualCount++
          const d = parseDate(row.CreateDate)
          if (d && (!p.lastAccrualDate || d > p.lastAccrualDate)) p.lastAccrualDate = d
        }
      }
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
  }, [filteredRows])


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

    for (const row of filteredRows) {
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
  }, [filteredRows])

  // Контактные поля — ищем в первой строке данных
  const contactFields = useMemo(() => {
    if (rawRows.length === 0) return []
    const firstRow = rawRows[0] as Record<string, unknown>
    const CONTACT_PATTERNS = /phone|email|телефон|мобил|почт|контакт|contact/i
    return Object.keys(firstRow).filter(k => CONTACT_PATTERNS.test(k))
  }, [rawRows])

  function buildPartnerRow(p: typeof tenOrMore[number]): Record<string, unknown> {
    const base = p.anyRow as Record<string, unknown>
    const out: Record<string, unknown> = {}
    out['HeadPartnerCB']      = String(base['HeadPartnerCB'] ?? '').trim() || '[NULL]'
    out['CashbookId']         = String(base['CashbookId'] ?? '').trim() || '[NULL]'
    out['RenId']              = p.renId
    out['ФИО']                = p.fullName
    out['Роль']               = p.role
    for (const cf of contactFields) out[cf] = base[cf] ?? '—'
    out['Накоплено_РБ']       = Math.round(p.totalAccrual)
    out['Событий_начисления'] = p.accrualCount
    out['Списано_РБ']         = Math.round(p.totalSpend)
    out['Кол-во_списаний']    = p.spendRows.length
    out['Утилизация_%']       = p.totalAccrual > 0 ? Math.round((p.totalSpend / p.totalAccrual) * 100) : 0
    out['Последнее_начисление'] = fmtDate(p.lastAccrualDate)
    return out
  }

  function handleDownload(group: typeof tenOrMore, filename: string) {
    // Группируем: голова = HeadPartnerCB пустой, суб = HeadPartnerCB = CashbookId головы
    type Grp = { head: typeof group[number]; subs: typeof group[number][] }
    const groupMap = new Map<string, Grp>()

    for (const p of group) {
      const raw = p.anyRow as Record<string, unknown>
      const headCB = String(raw['HeadPartnerCB'] ?? '').trim()
      const cid    = String(raw['CashbookId']    ?? '').trim()
      if (!headCB || headCB === '[NULL]') {
        const key = cid || p.renId
        if (!groupMap.has(key)) groupMap.set(key, { head: p, subs: [] })
      }
    }
    for (const p of group) {
      const raw = p.anyRow as Record<string, unknown>
      const headCB = String(raw['HeadPartnerCB'] ?? '').trim()
      if (headCB && headCB !== '[NULL]') {
        if (groupMap.has(headCB)) groupMap.get(headCB)!.subs.push(p)
        else groupMap.set(`orphan_${p.renId}`, { head: p, subs: [] })
      }
    }

    const остаток = (p: typeof group[number]) => p.totalAccrual - p.totalSpend
    const rows: Record<string, unknown>[] = []
    for (const g of Array.from(groupMap.values())
      .map(g => ({ ...g, maxОст: Math.max(остаток(g.head), ...g.subs.map(остаток)) }))
      .sort((a, b) => b.maxОст - a.maxОст)) {
      rows.push(buildPartnerRow(g.head))
      for (const sub of g.subs.sort((a, b) => остаток(b) - остаток(a))) rows.push(buildPartnerRow(sub))
    }
    downloadXlsx(rows, filename)
  }

  const totalEventsTen   = tenOrMore.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendTen    = tenOrMore.reduce((s, p) => s + p.totalSpend, 0)
  const totalEventsThree = threeToNine.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendThree  = threeToNine.reduce((s, p) => s + p.totalSpend, 0)
  const totalEventsB     = oneOrTwo.reduce((s, p) => s + p.spendRows.length, 0)
  const totalSpendB      = oneOrTwo.reduce((s, p) => s + p.totalSpend, 0)

  return (
    <div className="space-y-6">

      {/* ── Фильтры агентской сети ──────────────────────────────────────── */}
      {agentRows && agentRows.length > 0 && (
        <AgentFilterBar enrichedRows={enrichedRows} filters={agentFilters} setFilters={setAgentFilters} lockedCurator={lockedCurator} />
      )}

      {/* Сводный дашборд */}
      <SummaryDashboard rawRows={filteredRows} />


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
      <EngagementTrend rawRows={filteredRows} />

      {/* ── Топ: копят, но не тратят ──────────────────────────────────── */}
      <UnderutilizersBlock
        data={underutilizers}
        contactFields={contactFields}
        onDownload={(rows) => {
          // Голова = HeadPartnerCB пустой/[NULL], CashbookId заполнен
          // Суб = HeadPartnerCB = CashbookId головы
          type Group = { head: typeof rows[0]; subs: typeof rows[0][] }
          const groupMap = new Map<string, Group>()

          for (const s of rows) {
            const raw = s.anyRow as Record<string, unknown>
            const headCB = String(raw['HeadPartnerCB'] ?? '').trim()
            const cid    = String(raw['CashbookId']    ?? '').trim()
            if (!headCB || headCB === '[NULL]') {
              const key = cid || s.renId
              if (!groupMap.has(key)) groupMap.set(key, { head: s, subs: [] })
            }
          }
          for (const s of rows) {
            const raw = s.anyRow as Record<string, unknown>
            const headCB = String(raw['HeadPartnerCB'] ?? '').trim()
            if (headCB && headCB !== '[NULL]') {
              if (groupMap.has(headCB)) groupMap.get(headCB)!.subs.push(s)
              else groupMap.set(`orphan_${s.renId}`, { head: s, subs: [] })
            }
          }

          const mkRow = (s: typeof rows[0]) => {
            const raw = s.anyRow as Record<string, unknown>
            const r: Record<string, unknown> = {
              HeadPartnerCB: String(raw['HeadPartnerCB'] ?? '').trim() || '[NULL]',
              CashbookId:    String(raw['CashbookId']    ?? '').trim() || '[NULL]',
              RenId: s.renId, ФИО: s.fullName, Роль: s.role,
            }
            for (const cf of contactFields) r[cf] = raw[cf] ?? '—'
            r['Накоплено_РБ']        = Math.round(s.totalAccrual)
            r['Событий_начисления']  = s.accrualCount
            r['Списано_РБ']          = Math.round(s.totalSpend)
            r['Кол-во_списаний']     = s.spendCount
            r['Утилизация_%']        = s.totalAccrual > 0 ? Math.round((s.totalSpend / s.totalAccrual) * 100) : 0
            r['Последнее_начисление'] = fmtDate(s.lastAccrualDate)
            return r
          }

          const остаток = (s: typeof rows[0]) => s.totalAccrual - s.totalSpend
          const out: Record<string, unknown>[] = []
          // Сортируем группы по MAX остатку среди всех участников группы
          for (const g of Array.from(groupMap.values())
            .map(g => ({ ...g, maxОстаток: Math.max(остаток(g.head), ...g.subs.map(остаток)) }))
            .sort((a, b) => b.maxОстаток - a.maxОстаток)) {
            out.push(mkRow(g.head))
            for (const sub of g.subs.sort((a, b) => остаток(b) - остаток(a))) out.push(mkRow(sub))
          }
          downloadXlsx(out, 'underutilizers_all.xlsx')
        }}
      />

      {/* ── Когортный анализ: выход в активность ──────────────────────── */}
      <CohortCumulativeBlock rawRows={filteredRows} />

      {/* ── Когортный анализ: хотя бы 1 кросс в месяц ────────────────── */}
      <CohortBlock rawRows={filteredRows} />

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

    // Все партнёры с разрешёнными ролями за всю историю (популяция)
    const partnersWithRole = new Set<string>()
    for (const row of rawRows) {
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId || !roleSet.has(String(row['Role'] ?? '').trim())) continue
      partnersWithRole.add(renId)
    }

    type GKey = 'noIssued' | 'noBal' | 'zero' | 'oneTwo' | 'three' | 'ten'
    function grp(renId: string): GKey | null {
      if (!partnersWithRole.has(renId)) return null
      if (!everIssued.has(renId))  return 'noIssued'
      if (!everAccrued.has(renId)) return 'noBal'
      const c = spendCntEver.get(renId) ?? 0
      if (c >= 10) return 'ten'
      if (c >= 3)  return 'three'
      if (c >= 1)  return 'oneTwo'
      return 'zero'
    }

    const cnt: Record<GKey, number> = { noIssued: 0, noBal: 0, zero: 0, oneTwo: 0, three: 0, ten: 0 }
    for (const renId of partnersWithRole) {
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

    return { cnt, agg, total: partnersWithRole.size }
  }, [rawRows, selectedRoles])

  const withBalTotal = G.cnt.zero + G.cnt.oneTwo + G.cnt.three + G.cnt.ten
  const total = G.total

  const fmtPct = (num: number, den: number) =>
    den > 0 ? (num / den * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—'

  // Суммарные агрегаты для withBal строк
  const spendKeys = ['zero', 'oneTwo', 'three', 'ten'] as const

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

        {/* Как читать этот отчёт — сворачиваемая */}
        <div>
          <button
            onClick={() => setMethodologyOpen(o => !o)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            <span>{methodologyOpen ? '▾' : '▸'}</span>
            <span>Как читать этот отчёт</span>
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
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtN(a.osago26)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-indigo-600">{fmtN(a.kasko26)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-500">{fmtPct(a.kasko25, a.osago25)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-700 font-semibold">{fmtPct(a.kasko26, a.osago26)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Динамика вовлечённости по месяцам ───────────────────────────────────────
type GK = 'zero' | 'oneTwo' | 'three' | 'ten'
const GKS: GK[] = ['zero', 'oneTwo', 'three', 'ten']
const GK_LABEL: Record<GK, string> = { zero: 'Не списывали', oneTwo: 'Списано 1–2 раза', three: 'Списано 3–9 раз', ten: 'Списано 10+ раз' }
const GK_LABEL_SHORT: Record<GK, string> = { zero: '0 раз', oneTwo: '1–2 раза', three: '3–9 раз', ten: '10+ раз' }
const GK_COLOR: Record<GK, string> = {
  zero: '#94a3b8', oneTwo: '#fbbf24', three: '#4ade80', ten: '#059669',
}
const GK_TEXT: Record<GK, string> = {
  zero: 'text-slate-500', oneTwo: 'text-amber-600', three: 'text-green-700', ten: 'text-emerald-700',
}

function EngagementTrend({ rawRows }: { rawRows: RawRow[] }) {
  const [legendOpen, setLegendOpen] = useState(false)
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)
  const toggleRole = (role: string) =>
    setSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role])

  const { rows: data, N } = useMemo(() => {
    // 1. Фиксированная база: everAccrued ∩ партнёры с выбранными ролями (вся история, без года)
    const ROLES = new Set(selectedRoles)
    const everAccrued = new Set<string>()
    for (const row of rawRows) {
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || String(row.State ?? '') !== 'PolicyIssued') continue
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNull(row.LoyaltyPointsInLK) && lp > 0) everAccrued.add(rid)
    }
    const partnersWithRole = new Set<string>()
    for (const row of rawRows) {
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || !ROLES.has(String(row['Role'] ?? '').trim())) continue
      partnersWithRole.add(rid)
    }
    const base = new Set<string>()
    for (const rid of everAccrued) { if (partnersWithRole.has(rid)) base.add(rid) }
    const N = base.size

    // 2а. Первое начисление РБ по каждому партнёру (для накопительного счётчика активных)
    const firstAccrualMs = new Map<string, number>()
    for (const row of rawRows) {
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || !base.has(rid) || String(row.State ?? '') !== 'PolicyIssued') continue
      const lp = toNum(row.LoyaltyPointsInLK)
      if (isNull(row.LoyaltyPointsInLK) || lp <= 0) continue
      const d = parseDate(row.CreateDate)
      if (!d) continue
      const ms = d.getTime()
      if (!firstAccrualMs.has(rid) || ms < firstAccrualMs.get(rid)!) firstAccrualMs.set(rid, ms)
    }
    const firstAccrualsSorted = Array.from(firstAccrualMs.values()).sort((a, b) => a - b)
    let faPtr = 0  // pointer for cumulative first-accrual count

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

      // Кол-во партнёров с начислениями РБ накопительно к этому месяцу
      while (faPtr < firstAccrualsSorted.length && firstAccrualsSorted[faPtr] <= endMs) faPtr++
      const cumActive = faPtr

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

      return { ym, dist, osago, kasko, cumActive }
    })

    return { rows, N }
  }, [rawRows, selectedRoles])

  const fmtYM = (ym: string) => {
    const [y, mo] = ym.split('-')
    const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
    return `${names[parseInt(mo) - 1]} '${y.slice(2)}`
  }

  const fmtPctLocal = (num: number, den: number) =>
    den > 0 ? (num / den * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—'

  return (
    <div className="bg-white rounded-xl border border-indigo-100 overflow-hidden shadow-sm">
      <div className="px-5 py-4 bg-indigo-50 border-b border-indigo-100 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-indigo-900 text-base">Динамика вовлечённости по месяцам</h3>
            <p className="text-xs text-indigo-500 mt-0.5">Доля партнёров по количеству списаний — накопительно на конец каждого месяца</p>
          </div>
          {/* База */}
          <div className="shrink-0 text-center bg-white border-2 border-indigo-300 rounded-xl px-4 py-2 shadow-sm">
            <p className="text-2xl font-bold text-indigo-700 leading-none">{fmtN(N)}</p>
            <p className="text-[10px] text-indigo-400 mt-0.5">партнёров с начислениями РБ</p>
          </div>
        </div>

        {/* Фильтр по роли */}
        <div>
          <p className="text-xs font-semibold text-indigo-700 mb-1.5">Фильтр по роли:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_ALLOWED_ROLES.map(role => (
              <label key={role} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={selectedRoles.includes(role)}
                  onChange={() => toggleRole(role)} className="w-3.5 h-3.5 accent-indigo-600" />
                <span className={selectedRoles.includes(role) ? 'text-indigo-800 font-medium' : 'text-indigo-300'}>{role}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Цветовая легенда */}
        <div className="flex flex-wrap gap-4">
          {GKS.map(g => (
            <span key={g} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: GK_COLOR[g] }} />
              {GK_LABEL[g]}
            </span>
          ))}
        </div>

        {/* Сворачиваемая легенда */}
        <div>
          <button
            onClick={() => setLegendOpen(o => !o)}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            <span>{legendOpen ? '▾' : '▸'}</span>
            <span>Как читать этот отчёт</span>
          </button>
          {legendOpen && (
            <div className="mt-2 text-xs text-indigo-700 space-y-1.5 border-t border-indigo-100 pt-2">
              <p><strong>Фиксированная база ({fmtN(N)} партнёров)</strong> — все, у кого хоть раз было PolicyIssued с LoyaltyPointsInLK&nbsp;&gt;&nbsp;0 и есть разрешённая роль (Агент / Субагент / Директор партнёра и др.). База не меняется от месяца к месяцу.</p>
              <p><strong>Доля по частоте списания</strong> — в каждой ячейке показано, какой % из {fmtN(N)} партнёров к концу данного месяца накопительно списывал РБ столько раз. Суммируется в 100% по строке (без столбца конверсии).</p>
              <p><strong>Накопительно</strong> — однажды перейдя в группу «Списано 3–9 раз», партнёр остаётся в ней и не возвращается назад. Поэтому доля «Не списывали» со временем только уменьшается.</p>
              <p><strong>Конв. ОСАГО→Каско</strong> — Каско (шт.) / ОСАГО (шт.) именно в этом конкретном месяце для партнёров данной группы (по накопленной группе на конец месяца).</p>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr className="border-b border-gray-200">
              <th className="px-4 py-2 text-left" rowSpan={2}>Месяц</th>
              <th className="px-4 py-2 text-center border-l border-indigo-100" rowSpan={2}>
                <span className="text-indigo-600">Партнёров<br/>с РБ (накопит.)</span>
              </th>
              <th className="px-4 py-2 text-center border-l border-gray-100" colSpan={5}>Доля партнёров по количеству списаний</th>
              <th className="px-4 py-2 text-center border-l border-gray-200" colSpan={4}>Конв. ОСАГО→Каско в месяце</th>
            </tr>
            <tr className="border-b border-gray-200">
              {GKS.map(g => (
                <th key={g} className={`px-3 py-1.5 text-center font-semibold ${GK_TEXT[g]}`}>{GK_LABEL_SHORT[g]}</th>
              ))}
              <th className="px-3 py-1.5 text-center text-gray-400">Бар</th>
              {GKS.map(g => (
                <th key={g} className={`px-3 py-1.5 text-center font-semibold ${GK_TEXT[g]}`}>{GK_LABEL_SHORT[g]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((m, idx) => {
              const pcts = GKS.map(g => N > 0 ? (m.dist[g] / N) * 100 : 0)
              const prevCumActive = idx > 0 ? data[idx - 1].cumActive : 0
              const growthPct = prevCumActive > 0 ? ((m.cumActive - prevCumActive) / prevCumActive) * 100 : null
              return (
                <tr key={m.ym} className="border-t border-gray-100 hover:bg-indigo-50/30 transition-colors">
                  <td className="px-4 py-2 font-medium text-gray-700 whitespace-nowrap">{fmtYM(m.ym)}</td>
                  <td className="px-4 py-2 text-center tabular-nums font-semibold text-indigo-600 border-l border-indigo-100">
                    {fmtN(m.cumActive)}
                    {growthPct !== null && growthPct !== 0 && (
                      <span className="block text-[10px] font-normal text-emerald-600 leading-tight">
                        +{growthPct < 1 ? growthPct.toFixed(1) : Math.round(growthPct)}%
                      </span>
                    )}
                  </td>
                  {GKS.map((g, i) => (
                    <td key={g} className={`px-3 py-2 text-center tabular-nums ${GK_TEXT[g]}`}>
                      {g === 'zero' ? `${Math.round(pcts[i])}%` : `${pcts[i].toFixed(1)}%`}
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
            ТОП: копят, но не используют баллы
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
              <th className="px-4 py-2 text-right whitespace-nowrap">Списаний</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Утилизация
                  <span
                    title="Утилизация = Списано РБ / Накоплено РБ × 100%. Показывает, какую долю накопленных рен-бонусов партнёр уже потратил. 0% — ни разу не списывал, 100% — потратил всё накопленное."
                    className="cursor-help inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-400 text-gray-400 hover:border-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 text-[10px] font-bold leading-none transition-colors"
                  >?</span>
                </span>
              </th>
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
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                    {s.spendCount > 0 ? s.spendCount : <span className="text-red-400 font-medium">0</span>}
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

// ── Когортный анализ ─────────────────────────────────────────────────────────
function ymStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function addMonthsToYM(ym: string, k: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + k, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function labelYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('ru-RU', { month: 'short', year: '2-digit' })
    .replace(/^./, c => c.toUpperCase())
}

const MAX_COHORT_OFFSET = 12

// Общая функция вычисления когорт (используется в двух блоках)
function buildCohortData(rawRows: RawRow[], selectedRoles: string[]) {
  const roleSet = new Set(selectedRoles)
  const EXCL = new Set(['PolicyAnnulled', 'PolicyTerminated'])
  const firstAccrualYM = new Map<string, string>()
  const crossMonthsMap = new Map<string, Set<string>>()
  let maxDataYM = ''

  for (const row of rawRows) {
    const renId = String(row['RenId'] ?? '').trim()
    if (!renId || !roleSet.has(String(row['Role'] ?? '').trim())) continue
    if (EXCL.has(String(row.State ?? ''))) continue
    const d = parseDate(row.CreateDate)
    if (!d) continue
    const ym = ymStr(d)
    if (ym > maxDataYM) maxDataYM = ym
    if (String(row.State ?? '') === 'PolicyIssued') {
      const lp = toNum(row.LoyaltyPointsInLK)
      if (!isNull(row.LoyaltyPointsInLK) && lp > 0) {
        const ex = firstAccrualYM.get(renId)
        if (!ex || ym < ex) firstAccrualYM.set(renId, ym)
      }
    }
    if (isSpendingRow(row)) {
      if (!crossMonthsMap.has(renId)) crossMonthsMap.set(renId, new Set())
      crossMonthsMap.get(renId)!.add(ym)
    }
  }

  const cohortMap = new Map<string, string[]>()
  for (const [pid, ym] of firstAccrualYM) {
    if (!cohortMap.has(ym)) cohortMap.set(ym, [])
    cohortMap.get(ym)!.push(pid)
  }

  const cohortMonths = Array.from(cohortMap.keys()).sort()
  if (!cohortMonths.length) return null

  const earliestYM = cohortMonths[0]
  let dynMax = 0
  for (let k = 0; k <= MAX_COHORT_OFFSET; k++) {
    if (addMonthsToYM(earliestYM, k) <= maxDataYM) dynMax = k
  }

  return { cohortMap, cohortMonths, crossMonthsMap, maxDataYM, dynMax }
}

// Общий хедер с фильтрами и методологией
function CohortHeader({
  title, subtitle, accentColor, selectedRoles, onToggle, methodologyOpen, onToggleMethodology, methodologyText,
}: {
  title: string; subtitle: string; accentColor: string
  selectedRoles: string[]; onToggle: (r: string) => void
  methodologyOpen: boolean; onToggleMethodology: () => void; methodologyText: React.ReactNode
}) {
  return (
    <div className={`px-5 py-4 border-b ${accentColor} space-y-3`}>
      <div>
        <h2 className="font-bold text-base">{title}</h2>
        <p className="text-xs mt-0.5 opacity-80">{subtitle}</p>
      </div>
      <div>
        <p className="text-xs font-semibold mb-1.5">Фильтр по роли:</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ALL_ALLOWED_ROLES.map(role => (
            <label key={role} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={selectedRoles.includes(role)}
                onChange={() => onToggle(role)} className="w-3.5 h-3.5" />
              <span className={selectedRoles.includes(role) ? 'font-medium' : 'opacity-40'}>{role}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <button onClick={onToggleMethodology}
          className="flex items-center gap-1 text-xs font-medium opacity-70 hover:opacity-100 transition-opacity">
          <span>{methodologyOpen ? '▾' : '▸'}</span>
          <span>Как читать этот отчёт</span>
        </button>
        {methodologyOpen && (
          <div className="mt-2 text-xs space-y-1 border-t border-current/10 pt-2 opacity-80">
            {methodologyText}
          </div>
        )}
      </div>
    </div>
  )
}

// Общая таблица когорт
function CohortTable({
  cohortRows, maxOffset, cellBg,
}: {
  cohortRows: Array<{ cohortYM: string; N: number; cells: Array<{ count: number; pct: number } | null> }>
  maxOffset: number
  cellBg: (pct: number) => string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap sticky left-0 bg-gray-50 z-10 border-r border-gray-200">
              Когорта
            </th>
            <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap border-r border-gray-100">
              Партнёров
            </th>
            {Array.from({ length: maxOffset + 1 }, (_, k) => (
              <th key={k} className="px-2 py-2 text-center font-semibold text-gray-500 whitespace-nowrap min-w-[52px]">
                M{k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohortRows.map(row => (
            <tr key={row.cohortYM} className="border-b border-gray-100 hover:brightness-95 transition-all">
              <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap sticky left-0 bg-white z-10 border-r border-gray-200">
                {labelYM(row.cohortYM)}
              </td>
              <td className="px-3 py-1.5 text-center tabular-nums text-gray-500 border-r border-gray-100">
                {row.N.toLocaleString('ru-RU')}
              </td>
              {Array.from({ length: maxOffset + 1 }, (_, k) => {
                const cell = row.cells[k]
                if (!cell) return <td key={k} className="px-2 py-1.5 text-center text-gray-200">—</td>
                return (
                  <td key={k}
                    title={`${cell.count} из ${row.N} партнёров`}
                    className="px-2 py-1.5 text-center tabular-nums font-medium"
                    style={{ backgroundColor: cell.pct > 0 ? cellBg(cell.pct) : undefined }}>
                    {cell.pct > 0 ? `${cell.pct < 1 ? cell.pct.toFixed(1) : Math.round(cell.pct)}%` : <span className="text-gray-300">0%</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Блок 1: конверсия в месяце (не накопительно) ─────────────────────────────
function CohortBlock({ rawRows }: { rawRows: RawRow[] }) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)
  const [methodologyOpen, setMethodologyOpen] = useState(false)

  const result = useMemo(() => {
    const d = buildCohortData(rawRows, selectedRoles)
    if (!d) return null
    const { cohortMap, cohortMonths, crossMonthsMap, maxDataYM, dynMax } = d
    const cohortRows = cohortMonths.map(cohortYM => {
      const partners = cohortMap.get(cohortYM)!
      const N = partners.length
      const cells: Array<{ count: number; pct: number } | null> = []
      for (let k = 0; k <= dynMax; k++) {
        const tYM = addMonthsToYM(cohortYM, k)
        if (tYM > maxDataYM) { cells.push(null); continue }
        const count = partners.filter(pid => crossMonthsMap.get(pid)?.has(tYM) ?? false).length
        cells.push({ count, pct: N > 0 ? (count / N) * 100 : 0 })
      }
      return { cohortYM, N, cells }
    })
    const maxPct = Math.max(1, ...cohortRows.flatMap(r => r.cells.map(c => c?.pct ?? 0)))
    return { cohortRows, maxOffset: dynMax, maxPct }
  }, [rawRows, selectedRoles])

  if (!result) return null

  function cellBg(pct: number) {
    const i = Math.min(pct / result!.maxPct, 1)
    return `rgba(16,185,129,${0.1 + i * 0.65})`  // emerald
  }

  return (
    <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-sm">
      <CohortHeader
        title="📅 Когортный анализ: Хотя бы 1 кросс-продажа в указанный месяц"
        subtitle="Партнёры с первым начислением РБ в указанном месяце. Ячейка — % когорты, купивших Каско именно в этом относительном месяце (M0, M1 и т.д.)."
        accentColor="bg-emerald-50 text-emerald-800 border-emerald-200"
        selectedRoles={selectedRoles}
        onToggle={r => setSelectedRoles(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r])}
        methodologyOpen={methodologyOpen}
        onToggleMethodology={() => setMethodologyOpen(o => !o)}
        methodologyText={<>
          <p><strong>Когорта</strong> — все партнёры, у которых первое начисление РБ (State=PolicyIssued, LoyaltyPointsInLK&gt;0) произошло в данном месяце.</p>
          <p><strong>M0</strong> — тот же месяц, что и первое начисление. <strong>M1</strong> — следующий месяц и т.д.</p>
          <p><strong>Ячейка</strong> — % партнёров когорты, у которых в этом конкретном месяце была хоть одна кросс-продажа (CrossIsBought=Да + списание РБ).</p>
          <p>Один партнёр может попасть в несколько столбцов — если делал кросс в разные месяцы.</p>
          <p>Чем темнее ячейка — тем выше доля партнёров с кросс-продажами в этом месяце.</p>
        </>}
      />
      <CohortTable cohortRows={result.cohortRows} maxOffset={result.maxOffset} cellBg={cellBg} />
      <div className="px-5 py-3 bg-emerald-50/40 border-t border-emerald-100 text-xs text-emerald-600">
        Показывает активность когорты в каждом конкретном месяце. Не накопительно — один и тот же партнёр учитывается заново в каждом месяце, когда делает кросс.
      </div>
    </div>
  )
}

// ── Блок 2: выход партнёров в активность по когортам ──────────────────────────
type CohortType = 'accrual' | 'spend'
type ActivitySegment = '3-9' | '10+'

function CohortCumulativeBlock({ rawRows }: { rawRows: RawRow[] }) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [cohortType, setCohortType] = useState<CohortType>('accrual')
  const [segment, setSegment] = useState<ActivitySegment>('10+')

  // Сырые данные: не зависят от cohortType и threshold
  const rawData = useMemo(() => {
    const roleSet = new Set(selectedRoles)
    const EXCL = new Set(['PolicyAnnulled', 'PolicyTerminated'])
    const firstAccrualYM = new Map<string, string>()
    const firstSpendYM   = new Map<string, string>()
    // pid → sorted [(ym, count)] — для быстрого cumulative подсчёта
    const tempCross = new Map<string, Map<string, number>>()
    let maxDataYM = ''

    for (const row of rawRows) {
      const renId = String(row['RenId'] ?? '').trim()
      if (!renId || !roleSet.has(String(row['Role'] ?? '').trim())) continue
      if (EXCL.has(String(row.State ?? ''))) continue
      const d = parseDate(row.CreateDate)
      if (!d) continue
      const ym = ymStr(d)
      if (ym > maxDataYM) maxDataYM = ym

      if (String(row.State ?? '') === 'PolicyIssued') {
        const lp = toNum(row.LoyaltyPointsInLK)
        if (!isNull(row.LoyaltyPointsInLK) && lp > 0) {
          const ex = firstAccrualYM.get(renId)
          if (!ex || ym < ex) firstAccrualYM.set(renId, ym)
        }
        if (isSpendingRow(row)) {
          const ex = firstSpendYM.get(renId)
          if (!ex || ym < ex) firstSpendYM.set(renId, ym)
          if (!tempCross.has(renId)) tempCross.set(renId, new Map())
          tempCross.get(renId)!.set(ym, (tempCross.get(renId)!.get(ym) ?? 0) + 1)
        }
      }
    }

    // Сортируем месяцы кросс-продаж для быстрого prefix-sum
    const crossSorted = new Map<string, [string, number][]>()
    for (const [pid, m] of tempCross) {
      crossSorted.set(pid, Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])))
    }

    return { firstAccrualYM, firstSpendYM, crossSorted, maxDataYM }
  }, [rawRows, selectedRoles])

  // Таблица: зависит от cohortType и segment
  const result = useMemo(() => {
    const { firstAccrualYM, firstSpendYM, crossSorted, maxDataYM } = rawData
    const sourceMap = cohortType === 'accrual' ? firstAccrualYM : firstSpendYM

    const cohortMap = new Map<string, string[]>()
    for (const [pid, ym] of sourceMap) {
      if (!cohortMap.has(ym)) cohortMap.set(ym, [])
      cohortMap.get(ym)!.push(pid)
    }
    const cohortMonths = Array.from(cohortMap.keys()).sort()
    if (!cohortMonths.length) return null

    const earliestYM = cohortMonths[0]
    let dynMax = 0
    for (let k = 0; k <= MAX_COHORT_OFFSET; k++) {
      if (addMonthsToYM(earliestYM, k) <= maxDataYM) dynMax = k
    }

    function cumCross(pid: string, targetYM: string): number {
      const months = crossSorted.get(pid)
      if (!months) return 0
      let total = 0
      for (const [ym, cnt] of months) {
        if (ym > targetYM) break
        total += cnt
      }
      return total
    }

    function inSeg(n: number): boolean {
      if (segment === '3-9') return n >= 3 && n <= 9
      return n >= 10
    }

    const cohortRows = cohortMonths.map(cohortYM => {
      const partners = cohortMap.get(cohortYM)!
      const N = partners.length
      const cells: Array<{ count: number; pct: number } | null> = []
      for (let k = 0; k <= dynMax; k++) {
        const tYM = addMonthsToYM(cohortYM, k)
        if (tYM > maxDataYM) { cells.push(null); continue }
        let count = 0
        for (const pid of partners) {
          if (inSeg(cumCross(pid, tYM))) count++
        }
        cells.push({ count, pct: N > 0 ? (count / N) * 100 : 0 })
      }
      return { cohortYM, N, cells }
    })

    const maxPct = Math.max(1, ...cohortRows.flatMap(r => r.cells.map(c => c?.pct ?? 0)))
    return { cohortRows, maxOffset: dynMax, maxPct }
  }, [rawData, cohortType, segment])

  if (!result) return null

  function cellBg(pct: number) {
    const i = Math.min(pct / result!.maxPct, 1)
    return `rgba(99,102,241,${0.08 + i * 0.65})`
  }

  const segmentLabel = segment === '3-9' ? '3–9 списаний' : '10+ списаний'

  return (
    <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden shadow-sm">
      <CohortHeader
        title="📊 Когортный анализ: выход партнёров в активность"
        subtitle={`Ячейка — сколько партнёров из когорты вошли в сегмент «${segmentLabel}» нарастающим итогом к этому месяцу.`}
        accentColor="bg-indigo-50 text-indigo-800 border-indigo-200"
        selectedRoles={selectedRoles}
        onToggle={r => setSelectedRoles(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r])}
        methodologyOpen={methodologyOpen}
        onToggleMethodology={() => setMethodologyOpen(o => !o)}
        methodologyText={<>
          <p><strong>Когорта</strong> — партнёры, у которых первое начисление РБ (или первое списание) произошло в данном месяце.</p>
          <p><strong>M0</strong> — месяц формирования когорты. <strong>M1</strong> — следующий месяц и т.д.</p>
          <p><strong>Ячейка</strong> — сколько партнёров из когорты к этому месяцу нарастающим итогом набрали 3–9 или 10+ кросс-транзакций.</p>
          <p>Чем раньше появляются числа в строке — тем быстрее когорта выходит в активность.</p>
        </>}
      />

      {/* Фильтры */}
      <div className="px-5 py-3 border-b border-indigo-100 bg-indigo-50/20 flex flex-wrap gap-8">
        <div>
          <p className="text-xs font-semibold text-indigo-700 mb-2">Тип когорты:</p>
          <div className="flex gap-4">
            {([['accrual', 'По первому начислению РБ'], ['spend', 'По первому списанию РБ']] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="radio" name="cohortTypeBlock2" value={v}
                  checked={cohortType === v} onChange={() => setCohortType(v)}
                  className="w-3.5 h-3.5 accent-indigo-600" />
                <span className={cohortType === v ? 'font-medium text-indigo-700' : 'text-gray-500'}>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-indigo-700 mb-2">Сегмент по кол-ву кросс-транзакций:</p>
          <div className="flex gap-2">
            {(['3-9', '10+'] as const).map(s => (
              <button key={s} onClick={() => setSegment(s)}
                className={`px-4 py-1 rounded-full text-xs font-medium transition-colors border ${
                  segment === s
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'
                }`}>
                {s === '3-9' ? '3–9 списаний' : '10+ списаний'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap sticky left-0 bg-gray-50 z-10 border-r border-gray-200">Когорта</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap border-r border-gray-100">Всего<br/>партнёров</th>
              {Array.from({ length: result.maxOffset + 1 }, (_, k) => (
                <th key={k} className="px-2 py-2 text-center font-semibold text-gray-500 whitespace-nowrap min-w-[56px]">M{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.cohortRows.map(row => (
              <tr key={row.cohortYM} className="border-b border-gray-100 hover:brightness-95 transition-all">
                <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap sticky left-0 bg-white z-10 border-r border-gray-200">{labelYM(row.cohortYM)}</td>
                <td className="px-3 py-1.5 text-center tabular-nums text-gray-500 border-r border-gray-100">{row.N.toLocaleString('ru-RU')}</td>
                {row.cells.map((cell, k) => {
                  if (!cell) return <td key={k} className="px-2 py-1.5 text-center text-gray-200">—</td>
                  return (
                    <td key={k}
                      title={`${cell.count} из ${row.N} партнёров в сегменте «${segmentLabel}» к M${k}`}
                      className="px-2 py-1.5 text-center tabular-nums font-medium leading-tight"
                      style={{ backgroundColor: cell.pct > 0 ? cellBg(cell.pct) : undefined }}>
                      {cell.count > 0 ? (
                        <>
                          <span className="block">{cell.pct < 1 ? cell.pct.toFixed(1) : Math.round(cell.pct)}%</span>
                          <span className="block text-[10px] font-normal opacity-70">{cell.count}</span>
                        </>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 bg-indigo-50/40 border-t border-indigo-100 text-xs text-indigo-600">
        Ячейка = партнёры в сегменте <strong>«{segmentLabel}»</strong> нарастающим итогом к этому месяцу.
        {' '}Когорта: <strong>{cohortType === 'accrual' ? 'по первому начислению' : 'по первому списанию'}</strong>.
      </div>
    </div>
  )
}
