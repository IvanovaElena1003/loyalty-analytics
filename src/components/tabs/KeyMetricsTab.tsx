import { useMemo, useState } from 'react'
import type { RawRow } from '../../types'
import { downloadXlsx } from '../../utils/engagement'
import { AgentFilterBar } from '../AgentFilterBar'
import CrossImpactSepOctBlock from '../CrossImpactSepOctBlock'
import {
  EMPTY_AGENT_FILTERS,
  enrichRawRows,
  filterEnrichedRows,
  type AgentFilters,
} from '../../utils/agentNetwork'

interface Props { rawRows: RawRow[]; agentRows?: RawRow[]; lockedCurator?: string }

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

  const enrichedRows = useMemo(() => enrichRawRows(rawRows, agentRows), [rawRows, agentRows])
  const filteredRows = useMemo(
    () => filterEnrichedRows(enrichedRows, agentFilters),
    [enrichedRows, agentFilters],
  )

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

  return (
    <div className="space-y-6">

      {/* ── Фильтры агентской сети ──────────────────────────────────────── */}
      {agentRows && agentRows.length > 0 && (
        <AgentFilterBar enrichedRows={enrichedRows} filters={agentFilters} setFilters={setAgentFilters} lockedCurator={lockedCurator} />
      )}

      {/* ── Динамика по месяцам ───────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <EngagementTrend rawRows={filteredRows} />
        <EngagementTrendBySegment rawRows={filteredRows} />
      </div>

      {/* ── Когортный анализ: выход в активность ──────────────────────── */}
      <CohortCumulativeBlock rawRows={filteredRows} />

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

      {/* ── Сен → окт: вклад партнёров в conv кросса ─────────────────── */}
      <CrossImpactSepOctBlock rawRows={filteredRows} agentRows={agentRows ?? undefined} />

    </div>
  )
}

// ── Динамика вовлечённости по месяцам ───────────────────────────────────────
type GK = 'zero' | 'oneTwo' | 'threePlus' | 'ten'
const GKS: GK[] = ['zero', 'oneTwo', 'threePlus', 'ten']
const GK_LABEL: Record<GK, string> = { zero: 'Не списывали', oneTwo: 'Списано 1–2 раза', threePlus: 'Списано 3 и более раз', ten: 'Списано 10 и более раз' }
const GK_LABEL_SHORT: Record<GK, string> = { zero: '0 раз', oneTwo: '1–2 раза', threePlus: '3+ раз', ten: '10+ раз' }
const GK_COLOR: Record<GK, string> = {
  zero: '#94a3b8', oneTwo: '#fbbf24', threePlus: '#4ade80', ten: '#059669',
}
const GK_TEXT: Record<GK, string> = {
  zero: 'text-slate-500', oneTwo: 'text-amber-600', threePlus: 'text-green-700', ten: 'text-emerald-700',
}
const GK_KEY: GK = 'threePlus'
const GK_KEY_CELL = 'bg-green-50 font-semibold'
function emptyGkDist(): Record<GK, number> {
  return { zero: 0, oneTwo: 0, threePlus: 0, ten: 0 }
}
/** Разбиение: 0 / 1–2 / 3+ (10+ — подмножество 3+). */
function addEngagementCounts(dist: Record<GK, number>, spendCount: number) {
  if (spendCount === 0) dist.zero++
  else if (spendCount <= 2) dist.oneTwo++
  if (spendCount >= 3) dist.threePlus++
  if (spendCount >= 10) dist.ten++
}

/** Пороги для сегментов ОСАГО: 1+ ⊃ 3+ ⊃ 10+ (вложенные). */
function addEngagementThresholdCounts(dist: Record<GK, number>, spendCount: number) {
  if (spendCount === 0) dist.zero++
  if (spendCount >= 1) dist.oneTwo++
  if (spendCount >= 3) dist.threePlus++
  if (spendCount >= 10) dist.ten++
}
function addEngagementPolicy(
  osago: Record<GK, number>,
  kasko: Record<GK, number>,
  spendCount: number,
  o: number,
  k: number,
) {
  if (spendCount === 0) { osago.zero += o; kasko.zero += k }
  else if (spendCount <= 2) { osago.oneTwo += o; kasko.oneTwo += k }
  if (spendCount >= 3) { osago.threePlus += o; kasko.threePlus += k }
  if (spendCount >= 10) { osago.ten += o; kasko.ten += k }
}

type SegmentPartner = {
  renId: string
  fullName: string
  role: string
  anyRow: RawRow
  totalSpend: number
  totalAccrual: number
  accrualCount: number
  lastAccrualDate: Date | null
  bucketSpendCount: number
}

type SegmentBuckets = {
  ten: SegmentPartner[]
  threeToNine: SegmentPartner[]
  oneTwo: SegmentPartner[]
  zero: SegmentPartner[]
}

const EMPTY_SEGMENT_BUCKETS: SegmentBuckets = { ten: [], threeToNine: [], oneTwo: [], zero: [] }

function buildPartnerProfiles(rawRows: RawRow[], base: Set<string>): Map<string, SegmentPartner> {
  const map = new Map<string, SegmentPartner>()
  for (const row of rawRows) {
    const rid = String(row['RenId'] ?? '').trim()
    if (!rid || !base.has(rid)) continue
    if (!map.has(rid)) {
      map.set(rid, {
        renId: rid,
        fullName: String(row['FullName'] ?? row['AgentName'] ?? '').trim() || '—',
        role: String(row['Role'] ?? '').trim() || '—',
        anyRow: row,
        totalSpend: 0,
        totalAccrual: 0,
        accrualCount: 0,
        lastAccrualDate: null,
        bucketSpendCount: 0,
      })
    }
    const p = map.get(rid)!
    if ((!p.fullName || p.fullName === '—') && row['FullName']) {
      p.fullName = String(row['FullName']).trim()
    }
    if (isSpendingRow(row)) p.totalSpend += calcSpend(row)
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
  return map
}

function assignSegmentBuckets(
  base: Set<string>,
  profiles: Map<string, SegmentPartner>,
  getCount: (rid: string) => number,
): SegmentBuckets {
  const buckets: SegmentBuckets = { ten: [], threeToNine: [], oneTwo: [], zero: [] }
  for (const rid of base) {
    const p = profiles.get(rid)
    if (!p) continue
    const c = getCount(rid)
    p.bucketSpendCount = c
    const item = { ...p, bucketSpendCount: c }
    if (c >= 10) buckets.ten.push(item)
    else if (c >= 3) buckets.threeToNine.push(item)
    else if (c >= 1) buckets.oneTwo.push(item)
    else buckets.zero.push(item)
  }
  buckets.ten.sort((a, b) => b.bucketSpendCount - a.bucketSpendCount)
  buckets.threeToNine.sort((a, b) => b.bucketSpendCount - a.bucketSpendCount)
  buckets.oneTwo.sort((a, b) => b.bucketSpendCount - a.bucketSpendCount)
  buckets.zero.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
  return buckets
}

function buildSegmentXlsxRow(p: SegmentPartner, contactFields: string[], spendCountLabel: string): Record<string, unknown> {
  const base = p.anyRow as Record<string, unknown>
  const out: Record<string, unknown> = {}
  out['HeadPartnerCB'] = String(base['HeadPartnerCB'] ?? '').trim() || '[NULL]'
  out['CashbookId'] = String(base['CashbookId'] ?? '').trim() || '[NULL]'
  out['RenId'] = p.renId
  out['ФИО'] = p.fullName
  out['Роль'] = p.role
  for (const cf of contactFields) out[cf] = base[cf] ?? '—'
  out['Накоплено_РБ'] = Math.round(p.totalAccrual)
  out['Событий_начисления'] = p.accrualCount
  out['Списано_РБ'] = Math.round(p.totalSpend)
  out[spendCountLabel] = p.bucketSpendCount
  out['Утилизация_%'] = p.totalAccrual > 0 ? Math.round((p.totalSpend / p.totalAccrual) * 100) : 0
  out['Последнее_начисление'] = fmtDate(p.lastAccrualDate)
  return out
}

function downloadSegmentGroup(
  group: SegmentPartner[],
  filename: string,
  contactFields: string[],
  spendCountLabel: string,
) {
  type Grp = { head: SegmentPartner; subs: SegmentPartner[] }
  const groupMap = new Map<string, Grp>()
  for (const p of group) {
    const raw = p.anyRow as Record<string, unknown>
    const headCB = String(raw['HeadPartnerCB'] ?? '').trim()
    const cid = String(raw['CashbookId'] ?? '').trim()
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
  const остаток = (p: SegmentPartner) => p.totalAccrual - p.totalSpend
  const rows: Record<string, unknown>[] = []
  for (const g of Array.from(groupMap.values())
    .map(g => ({ ...g, maxОст: Math.max(остаток(g.head), ...g.subs.map(остаток)) }))
    .sort((a, b) => b.maxОст - a.maxОст)) {
    rows.push(buildSegmentXlsxRow(g.head, contactFields, spendCountLabel))
    for (const sub of g.subs.sort((a, b) => остаток(b) - остаток(a))) {
      rows.push(buildSegmentXlsxRow(sub, contactFields, spendCountLabel))
    }
  }
  downloadXlsx(rows, filename)
}

type EngagementViewMode = 'cumulative' | 'monthly'

function EngagementTrend({ rawRows }: { rawRows: RawRow[] }) {
  const [viewMode, setViewMode] = useState<EngagementViewMode>('cumulative')
  const isMonthly = viewMode === 'monthly'
  const [legendOpen, setLegendOpen] = useState(false)
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)
  const toggleRole = (role: string) =>
    setSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role])

  const contactFields = useMemo(() => {
    if (rawRows.length === 0) return []
    const firstRow = rawRows[0] as Record<string, unknown>
    const CONTACT_PATTERNS = /phone|email|телефон|мобил|почт|контакт|contact/i
    return Object.keys(firstRow).filter(k => CONTACT_PATTERNS.test(k))
  }, [rawRows])

  const { rows: data, N, latestYm, segments } = useMemo(() => {
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

    if (isMonthly) {
      const spendByMonth = new Map<string, Map<string, number>>()
      for (const row of rawRows) {
        if (!isSpendingRow(row)) continue
        const rid = String(row['RenId'] ?? '').trim()
        if (!rid || !base.has(rid)) continue
        const d = parseDate(row.CreateDate)
        if (!d) continue
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        if (ym < '2025-08') continue
        monthSet.add(ym)
        if (!spendByMonth.has(rid)) spendByMonth.set(rid, new Map())
        const byMonth = spendByMonth.get(rid)!
        byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1)
      }
      const monthsMonthly = Array.from(monthSet).sort()

      const rows = monthsMonthly.map(ym => {
        const dist = emptyGkDist()
        let monthSpenders = 0
        for (const rid of base) {
          const monthlyCount = spendByMonth.get(rid)?.get(ym) ?? 0
          if (monthlyCount > 0) monthSpenders++
          addEngagementCounts(dist, monthlyCount)
        }

        const osago = emptyGkDist()
        const kasko = emptyGkDist()
        const mm = mOsago.get(ym)
        if (mm) {
          for (const [rid, e] of mm) {
            const monthlyCount = spendByMonth.get(rid)?.get(ym) ?? 0
            addEngagementPolicy(osago, kasko, monthlyCount, e.o, e.k)
          }
        }

        return { ym, dist, osago, kasko, cumActive: monthSpenders }
      })

      const latestYm = rows.length ? rows[rows.length - 1].ym : null
      const profiles = buildPartnerProfiles(rawRows, base)
      const segments = latestYm
        ? assignSegmentBuckets(
            base,
            profiles,
            rid => spendByMonth.get(rid)?.get(latestYm) ?? 0,
          )
        : EMPTY_SEGMENT_BUCKETS

      return { rows, N, latestYm, segments }
    }

    // 4. Накопительный обход: для каждого месяца — группа партнёра на конец месяца
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
      const dist = emptyGkDist()
      for (const rid of base) addEngagementCounts(dist, cumCnt.get(rid) ?? 0)

      // Конверсия в этом месяце по группе (группа = накопленная на этот момент)
      const osago = emptyGkDist()
      const kasko = emptyGkDist()
      const mm = mOsago.get(ym)
      if (mm) {
        for (const [rid, e] of mm) {
          addEngagementPolicy(osago, kasko, cumCnt.get(rid) ?? 0, e.o, e.k)
        }
      }

      return { ym, dist, osago, kasko, cumActive }
    })

    const latestYm = months.length ? months[months.length - 1] : null
    const profiles = buildPartnerProfiles(rawRows, base)
    const segments = assignSegmentBuckets(base, profiles, rid => cumCnt.get(rid) ?? 0)

    return { rows, N, latestYm, segments }
  }, [rawRows, selectedRoles, isMonthly])

  const fmtYM = (ym: string) => {
    const [y, mo] = ym.split('-')
    const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
    return `${names[parseInt(mo) - 1]} '${y.slice(2)}`
  }

  const fmtPctLocal = (num: number, den: number) =>
    den > 0 ? (num / den * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—'

  return (
    <div className="ren-card">
      <div className="ren-card__header space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="ren-card__title">Динамика вовлечённости по месяцам</h3>
            <p className="ren-card__subtitle">
              {isMonthly
                ? 'Доля партнёров по количеству списаний — только внутри каждого календарного месяца'
                : 'Доля партнёров по количеству списаний — накопительно на конец каждого месяца'}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <div className="ren-segmented">
              <button
                type="button"
                onClick={() => setViewMode('cumulative')}
                className={`ren-segmented__btn ${!isMonthly ? 'ren-segmented__btn--active' : ''}`}
              >
                Накопительный результат
              </button>
              <button
                type="button"
                onClick={() => setViewMode('monthly')}
                className={`ren-segmented__btn ${isMonthly ? 'ren-segmented__btn--active' : ''}`}
              >
                Ежемесячный результат
              </button>
            </div>
            <div className="ren-kpi">
              <p className="ren-kpi__value">{fmtN(N)}</p>
              <p className="ren-kpi__label">партнёров с начислениями РБ</p>
            </div>
          </div>
        </div>

        {/* Фильтр по роли */}
        <div>
          <p className="text-xs font-semibold ren-text-brand mb-1.5">Фильтр по роли:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_ALLOWED_ROLES.map(role => (
              <label key={role} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={selectedRoles.includes(role)}
                  onChange={() => toggleRole(role)} className="w-3.5 h-3.5 ren-checkbox" />
                <span className={selectedRoles.includes(role) ? 'ren-text-brand font-medium' : 'text-[var(--text-tertiary)]'}>{role}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Цветовая легенда */}
        <div className="flex flex-wrap gap-4">
          {GKS.map(g => (
            <span key={g} className="flex items-center gap-1.5 text-xs ren-text-secondary">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: GK_COLOR[g] }} />
              {GK_LABEL[g]}
            </span>
          ))}
        </div>

        {/* Сворачиваемая легенда */}
        <div>
          <button
            onClick={() => setLegendOpen(o => !o)}
            className="ren-link flex items-center gap-1"
          >
            <span>{legendOpen ? '▾' : '▸'}</span>
            <span>Как читать этот отчёт</span>
          </button>
          {legendOpen && (
            <div className="mt-2 text-xs ren-text-brand space-y-1.5 border-t border-[var(--stroke-divider)] pt-2">
              <p><strong>Фиксированная база ({fmtN(N)} партнёров)</strong> — все, у кого хоть раз было PolicyIssued с LoyaltyPointsInLK&nbsp;&gt;&nbsp;0 и есть разрешённая роль (Агент / Субагент / Директор партнёра и др.). База не меняется от месяца к месяцу.</p>
              {isMonthly ? (
                <>
                  <p><strong>Ежемесячный результат</strong> — в каждой ячейке показано, какой % из {fmtN(N)} партнёров списывал РБ столько раз <em>именно в этом календарном месяце</em>. Колонки «0 раз», «1–2 раза» и «3+ раз» в сумме дают 100%; «10+ раз» — подмножество «3+ раз».</p>
                  <p><strong>За месяц</strong> — партнёр может быть в группе «0 раз» в одном месяце и «3+ раз» в другом. Партнёр с 10+ списаниями учитывается и в «3+ раз», и в «10+ раз».</p>
                  <p><strong>Списали в месяце</strong> — число партнёров из базы, у которых было хотя бы одно списание РБ в данном месяце.</p>
                </>
              ) : (
                <>
                  <p><strong>Накопительный результат</strong> — в каждой ячейке показано, какой % из {fmtN(N)} партнёров к концу данного месяца накопительно списывал РБ столько раз. Колонки «0 раз», «1–2 раза» и «3+ раз» в сумме дают 100%; «10+ раз» — подмножество «3+ раз».</p>
                  <p><strong>Накопительно</strong> — достигнув 3+ или 10+ списаний нарастающим итогом, партнёр остаётся в соответствующей колонке. Доля «0 раз» со временем только уменьшается.</p>
                </>
              )}
              <p><strong>Конв. ОСАГО→Каско</strong> — Каско (шт.) / ОСАГО (шт.) именно в этом конкретном месяце для партнёров данной группы{isMonthly ? ' (по списаниям за этот месяц)' : ' (по накопленной группе на конец месяца)'}.</p>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="ren-table w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-[var(--stroke-divider)]">
              <th className="px-4 py-2 text-left" rowSpan={2}>Месяц</th>
              <th className="px-4 py-2 text-center border-l border-[var(--stroke-divider)]" rowSpan={2}>
                <span className="ren-text-brand">
                  {isMonthly ? <>Списали<br/>в месяце</> : <>Партнёров<br/>с РБ (накопит.)</>}
                </span>
              </th>
              <th className="px-4 py-2 text-center border-l border-gray-100" colSpan={5}>Доля партнёров по количеству списаний</th>
              <th className="px-4 py-2 text-center border-l border-gray-200" colSpan={4}>Конв. ОСАГО→Каско в месяце</th>
            </tr>
            <tr className="border-b border-gray-200">
              {GKS.map(g => (
                <th key={`share-${g}`} className={`px-3 py-1.5 text-center font-semibold ${GK_TEXT[g]}`}>{GK_LABEL_SHORT[g]}</th>
              ))}
              <th className="px-3 py-1.5 text-center text-gray-400">Бар</th>
              {GKS.map(g => (
                <th key={`conv-${g}`} className={`px-3 py-1.5 text-center font-semibold ${GK_TEXT[g]}`}>{GK_LABEL_SHORT[g]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((m, idx) => {
              const pcts = GKS.map(g => N > 0 ? (m.dist[g] / N) * 100 : 0)
              const barPcts = N > 0 ? [
                { g: 'zero' as GK, pct: (m.dist.zero / N) * 100 },
                { g: 'oneTwo' as GK, pct: (m.dist.oneTwo / N) * 100 },
                { g: 'threePlus' as GK, pct: ((m.dist.threePlus - m.dist.ten) / N) * 100 },
                { g: 'ten' as GK, pct: (m.dist.ten / N) * 100 },
              ] : []
              const prevCumActive = idx > 0 ? data[idx - 1].cumActive : 0
              const growthPct = prevCumActive > 0 ? ((m.cumActive - prevCumActive) / prevCumActive) * 100 : null
              const isLatestMonth = idx === data.length - 1
              return (
                <tr key={m.ym} className="border-t border-[var(--stroke-divider)] transition-colors">
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)] whitespace-nowrap">{fmtYM(m.ym)}</td>
                  <td className="px-4 py-2 text-center tabular-nums font-semibold ren-text-brand border-l border-[var(--stroke-divider)]">
                    {fmtN(m.cumActive)}
                    {growthPct !== null && growthPct !== 0 && (
                      <span className="block text-[10px] font-normal text-[var(--text-success-contrast)] leading-tight">
                        +{growthPct < 1 ? growthPct.toFixed(1) : Math.round(growthPct)}%
                      </span>
                    )}
                  </td>
                  {GKS.map((g, i) => (
                    <td key={`share-${g}`} className={`px-3 py-2 text-center tabular-nums ${GK_TEXT[g]} ${isLatestMonth && g === GK_KEY ? GK_KEY_CELL : ''}`}>
                      <span className="block">
                        {g === 'zero' ? `${Math.round(pcts[i])}%` : `${pcts[i].toFixed(1)}%`}
                      </span>
                      <span className="block text-[10px] font-normal text-[var(--text-tertiary)] leading-tight mt-0.5">
                        {fmtN(m.dist[g])}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex h-3 rounded overflow-hidden w-20">
                      {barPcts.map(({ g, pct }) => (
                        pct > 0 && (
                          <div key={g} style={{ width: `${pct}%`, backgroundColor: GK_COLOR[g] }}
                            title={`${GK_LABEL[g]}: ${pct.toFixed(1)}%`} />
                        )
                      ))}
                    </div>
                  </td>
                  {GKS.map(g => (
                    <td key={`conv-${g}`} className={`px-3 py-2 text-center tabular-nums font-medium ${GK_TEXT[g]}`}>
                      {fmtPctLocal(m.kasko[g], m.osago[g])}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {latestYm && data.length > 0 && (() => {
        const last = data[data.length - 1]
        const spendCountLabel = isMonthly ? 'Кол-во_списаний_в_месяце' : 'Кол-во_списаний_накопит'
        const modeLabel = isMonthly ? 'ежемесячный' : 'накопительный'
        const ymTag = latestYm.replace('-', '')
        const cards: {
          key: keyof SegmentBuckets
          title: string
          subtitle: string
          count: number
          file: string
        }[] = [
          {
            key: 'ten',
            title: 'Списали 10+ раз',
            subtitle: 'Супер-активные пользователи',
            count: last.dist.ten,
            file: `spent_10plus_${ymTag}.xlsx`,
          },
          {
            key: 'threeToNine',
            title: 'Списали 3–9 раз',
            subtitle: 'Активные пользователи',
            count: last.dist.threePlus - last.dist.ten,
            file: `spent_3_9_${ymTag}.xlsx`,
          },
          {
            key: 'oneTwo',
            title: 'Списали 1–2 раза',
            subtitle: 'Низкая активность',
            count: last.dist.oneTwo,
            file: `spent_1_2_${ymTag}.xlsx`,
          },
          {
            key: 'zero',
            title: 'Списали 0 раз',
            subtitle: isMonthly
              ? 'В этом месяце не было списаний РБ'
              : 'К концу месяца ни разу не списывали (накопительно)',
            count: last.dist.zero,
            file: `spent_0_${ymTag}.xlsx`,
          },
        ]

        return (
          <div className="border-t border-[var(--stroke-divider)] p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                Крайний месяц в таблице · {fmtYM(latestYm)} · {modeLabel} результат
              </h4>
              <p className="text-xs ren-text-secondary mt-0.5">
                Сегменты и xlsx совпадают с фильтром ролей выше и с учётом фильтров агентской сети на вкладке.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cards.map(card => {
                const group = segments[card.key]
                return (
                  <div key={card.key} className="ren-card ren-card__body">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h5 className="font-semibold text-[var(--text-primary)]">{card.title}</h5>
                        <p className="text-xs ren-text-secondary">{card.subtitle}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadSegmentGroup(group, card.file, contactFields, spendCountLabel)}
                        disabled={group.length === 0}
                        className="ren-btn ren-btn--primary shrink-0 text-xs"
                      >
                        ↓ xlsx
                      </button>
                    </div>
                    <div>
                      <p className="text-xs ren-text-secondary">Партнёров</p>
                      <p className="text-3xl font-bold ren-text-brand tabular-nums">{fmtN(card.count)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs ren-text-secondary">
              Excel: одна строка на партнёра · {spendCountLabel} — по правилам {modeLabel} среза для {fmtYM(latestYm)}.
            </p>
          </div>
        )
      })()}
    </div>
  )
}

// ── Вовлечённость по сегментам ОСАГО ────────────────────────────────────────
type OsagoSegId = '0-9' | '10-19' | '20-39' | '40+' | 'total'
const OSAGO_SEGMENTS: { id: OsagoSegId; label: string }[] = [
  { id: '0-9', label: '0–9/мес.' },
  { id: '10-19', label: '10–19/мес.' },
  { id: '20-39', label: '20–39/мес.' },
  { id: '40+', label: '40+/мес.' },
  { id: 'total', label: 'Итого' },
]

function quarterMonthsFor(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const qStart = Math.floor((m - 1) / 3) * 3 + 1
  return [0, 1, 2].map(i => `${y}-${String(qStart + i).padStart(2, '0')}`)
}

function osagoSegmentFromAvg(avgMonthly: number): Exclude<OsagoSegId, 'total'> {
  if (avgMonthly >= 40) return '40+'
  if (avgMonthly >= 20) return '20-39'
  if (avgMonthly >= 10) return '10-19'
  return '0-9'
}

function osagoQuarterThrough(
  cb: string,
  ym: string,
  osagoByCbMonth: Map<string, Map<string, number>>,
): number {
  let sum = 0
  for (const qm of quarterMonthsFor(ym)) {
    if (qm > ym) break
    sum += osagoByCbMonth.get(cb)?.get(qm) ?? 0
  }
  return sum
}

type SegCell = { N: number; dist: Record<GK, number> }

const SEG_BUCKETS: GK[] = ['zero', 'oneTwo', 'threePlus', 'ten']
const SEG_GK_LABEL_SHORT: Record<GK, string> = {
  zero: '0 раз', oneTwo: '1+ раз', threePlus: '3+ раз', ten: '10+ раз',
}

function EngagementTrendBySegment({ rawRows }: { rawRows: RawRow[] }) {
  const [viewMode, setViewMode] = useState<EngagementViewMode>('cumulative')
  const isMonthly = viewMode === 'monthly'
  const [engBucket, setEngBucket] = useState<GK>('threePlus')
  const [legendOpen, setLegendOpen] = useState(false)
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)
  const toggleRole = (role: string) =>
    setSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role])

  const { rows: data, N } = useMemo(() => {
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

    const renIdToCb = new Map<string, string>()
    for (const row of rawRows) {
      const rid = String(row['RenId'] ?? '').trim()
      const cb = String(row['CashbookId'] ?? '').trim()
      if (!rid || !cb || !base.has(rid)) continue
      if (!renIdToCb.has(rid)) renIdToCb.set(rid, cb)
    }

    const osagoByCbMonth = new Map<string, Map<string, number>>()
    for (const row of rawRows) {
      if (String(row.State ?? '') !== 'PolicyIssued') continue
      const cb = String(row['CashbookId'] ?? '').trim()
      if (!cb) continue
      const d = parseDate(row.CreateDate)
      if (!d) continue
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      if (ym < '2025-08') continue
      if (!osagoByCbMonth.has(cb)) osagoByCbMonth.set(cb, new Map())
      const mm = osagoByCbMonth.get(cb)!
      mm.set(ym, (mm.get(ym) ?? 0) + 1)
    }

    const spendTs = new Map<string, number[]>()
    for (const row of rawRows) {
      if (!isSpendingRow(row)) continue
      const rid = String(row['RenId'] ?? '').trim()
      if (!rid || !base.has(rid)) continue
      const d = parseDate(row.CreateDate)
      if (!d) continue
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      if (ym < '2025-08') continue
      if (!spendTs.has(rid)) spendTs.set(rid, [])
      spendTs.get(rid)!.push(d.getTime())
    }
    for (const ts of spendTs.values()) ts.sort((a, b) => a - b)

    const monthSet = new Set<string>()
    for (const mm of osagoByCbMonth.values()) {
      for (const ym of mm.keys()) monthSet.add(ym)
    }
    for (const ts of spendTs.values()) {
      for (const t of ts) {
        const d = new Date(t)
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        if (ym >= '2025-08') monthSet.add(ym)
      }
    }
    const months = Array.from(monthSet).sort()

    function emptySegMap(): Record<OsagoSegId, SegCell> {
      return {
        '0-9': { N: 0, dist: emptyGkDist() },
        '10-19': { N: 0, dist: emptyGkDist() },
        '20-39': { N: 0, dist: emptyGkDist() },
        '40+': { N: 0, dist: emptyGkDist() },
        total: { N: 0, dist: emptyGkDist() },
      }
    }

    function segmentForRenAtMonth(rid: string, ym: string): Exclude<OsagoSegId, 'total'> | null {
      const cb = renIdToCb.get(rid)
      if (!cb) return null
      const avg = osagoQuarterThrough(cb, ym, osagoByCbMonth) / 3
      return osagoSegmentFromAvg(avg)
    }

    function addToSeg(segments: Record<OsagoSegId, SegCell>, rid: string, ym: string, spendCount: number) {
      const seg = segmentForRenAtMonth(rid, ym)
      segments.total.N++
      addEngagementThresholdCounts(segments.total.dist, spendCount)
      if (!seg) return
      segments[seg].N++
      addEngagementThresholdCounts(segments[seg].dist, spendCount)
    }

    if (isMonthly) {
      const spendByMonth = new Map<string, Map<string, number>>()
      for (const row of rawRows) {
        if (!isSpendingRow(row)) continue
        const rid = String(row['RenId'] ?? '').trim()
        if (!rid || !base.has(rid)) continue
        const d = parseDate(row.CreateDate)
        if (!d) continue
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        if (ym < '2025-08') continue
        if (!spendByMonth.has(rid)) spendByMonth.set(rid, new Map())
        const byMonth = spendByMonth.get(rid)!
        byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1)
      }

      const rows = months.map(ym => {
        const segments = emptySegMap()
        let monthSpenders = 0
        for (const rid of base) {
          const monthlyCount = spendByMonth.get(rid)?.get(ym) ?? 0
          if (monthlyCount > 0) monthSpenders++
          addToSeg(segments, rid, ym, monthlyCount)
        }
        return { ym, segments, cumActive: monthSpenders }
      })
      return { rows, N }
    }

    const cumCnt = new Map<string, number>()
    for (const rid of base) cumCnt.set(rid, 0)
    const ptrs = new Map<string, number>()
    for (const rid of spendTs.keys()) ptrs.set(rid, 0)

    const rows = months.map(ym => {
      const [y, mo] = ym.split('-').map(Number)
      const endMs = Date.UTC(y, mo, 1) - 1

      for (const [rid, ts] of spendTs) {
        let p = ptrs.get(rid) ?? 0
        while (p < ts.length && ts[p] <= endMs) {
          cumCnt.set(rid, (cumCnt.get(rid) ?? 0) + 1)
          p++
        }
        ptrs.set(rid, p)
      }

      const segments = emptySegMap()
      let cumSpenders = 0
      for (const rid of base) {
        const count = cumCnt.get(rid) ?? 0
        if (count > 0) cumSpenders++
        addToSeg(segments, rid, ym, count)
      }

      return { ym, segments, cumActive: cumSpenders }
    })

    return { rows, N }
  }, [rawRows, selectedRoles, isMonthly])

  const fmtYM = (ym: string) => {
    const [, mo] = ym.split('-')
    const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
    const [y] = ym.split('-')
    return `${names[parseInt(mo) - 1]} '${y.slice(2)}`
  }

  return (
    <div className="ren-card">
      <div className="ren-card__header space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="ren-card__title">Вовлечённость по сегментам ОСАГО</h3>
            <p className="ren-card__subtitle">
              Сегмент = ОСАГО за квартал ÷ 3 (среднее в месяц): 0–9 / 10–19 / 20–39 / 40+
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <div className="ren-segmented">
              <button
                type="button"
                onClick={() => setViewMode('cumulative')}
                className={`ren-segmented__btn ${!isMonthly ? 'ren-segmented__btn--active' : ''}`}
              >
                Накопительный
              </button>
              <button
                type="button"
                onClick={() => setViewMode('monthly')}
                className={`ren-segmented__btn ${isMonthly ? 'ren-segmented__btn--active' : ''}`}
              >
                Ежемесячный
              </button>
            </div>
            <div className="ren-kpi">
              <p className="ren-kpi__value">{fmtN(N)}</p>
              <p className="ren-kpi__label">база с РБ</p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold ren-text-brand mb-1.5">Группа списаний:</p>
          <div className="ren-segmented inline-flex flex-wrap">
            {SEG_BUCKETS.map(b => (
              <button
                key={b}
                type="button"
                onClick={() => setEngBucket(b)}
                className={`ren-segmented__btn ${engBucket === b ? 'ren-segmented__btn--active' : ''}`}
              >
                {SEG_GK_LABEL_SHORT[b]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold ren-text-brand mb-1.5">Фильтр по роли:</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_ALLOWED_ROLES.map(role => (
              <label key={role} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={selectedRoles.includes(role)}
                  onChange={() => toggleRole(role)} className="w-3.5 h-3.5 ren-checkbox" />
                <span className={selectedRoles.includes(role) ? 'ren-text-brand font-medium' : 'text-[var(--text-tertiary)]'}>{role}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <button onClick={() => setLegendOpen(o => !o)} className="ren-link flex items-center gap-1">
            <span>{legendOpen ? '▾' : '▸'}</span>
            <span>Как читать этот отчёт</span>
          </button>
          {legendOpen && (
            <div className="mt-2 text-xs ren-text-brand space-y-1.5 border-t border-[var(--stroke-divider)] pt-2">
              <p><strong>Сегмент ОСАГО</strong> — по CashbookId: сумма PolicyIssued за текущий календарный квартал (до выбранного месяца включительно) ÷ 3. Логика как в отчёте «Потенциал кросса».</p>
              <p><strong>Группа списаний</strong> — пороги нарастающим итогом: «1+ раз» — хотя бы одно списание; «3+» и «10+» включают более активных (10+ ⊂ 3+ ⊂ 1+). «0 раз» — ни одного.</p>
              <p><strong>Ячейка</strong> — доля партнёров сегмента в выбранной группе ({SEG_GK_LABEL_SHORT[engBucket]}){isMonthly ? ' за этот месяц' : ' на конец месяца'}. Под процентом — размер сегмента (N), не число в группе.</p>
              <p><strong>Итого</strong> — вся база ({fmtN(N)} партнёров с начислениями РБ и выбранной ролью), без разбивки по объёму ОСАГО.</p>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="ren-table w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-[var(--stroke-divider)]">
              <th className="px-3 py-2 text-left">Месяц</th>
              {OSAGO_SEGMENTS.map(s => (
                <th key={s.id} className={`px-3 py-2 text-center ${s.id === 'total' ? 'border-l border-[var(--stroke-divider)]' : ''}`}>
                  <span className={s.id === 'total' ? 'ren-text-brand font-semibold' : ''}>{s.label}</span>
                  <span className={`block text-[10px] font-normal ${GK_TEXT[engBucket]}`}>{SEG_GK_LABEL_SHORT[engBucket]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((m, idx) => {
              const isLatestMonth = idx === data.length - 1
              return (
                <tr key={m.ym} className="border-t border-[var(--stroke-divider)]">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{fmtYM(m.ym)}</td>
                  {OSAGO_SEGMENTS.map(s => {
                    const cell = m.segments[s.id]
                    const pct = cell.N > 0 ? (cell.dist[engBucket] / cell.N) * 100 : null
                    const highlight = isLatestMonth && engBucket === GK_KEY
                    return (
                      <td
                        key={s.id}
                        className={`px-3 py-2 text-center tabular-nums ${s.id === 'total' ? 'border-l border-[var(--stroke-divider)] font-semibold ren-text-brand' : GK_TEXT[engBucket]} ${highlight ? GK_KEY_CELL : ''}`}
                      >
                        <span className="block">
                          {pct != null
                            ? engBucket === 'zero' ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
                            : '—'}
                        </span>
                        <span className="block text-[10px] font-normal text-[var(--text-tertiary)]">{fmtN(cell.N)}</span>
                      </td>
                    )
                  })}
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
  const TOP = 5
  const top = data.slice(0, TOP)
  if (top.length === 0) return null

  return (
    <div className="ren-card">
      <div className="ren-card__header flex items-center justify-between gap-3">
        <div>
          <h3 className="ren-card__title">
            ТОП: копят, но не используют баллы
          </h3>
          <p className="ren-card__subtitle">
            Ранжированы по неиспользованному остатку РБ (накоплено − списано) за всю историю.
            Потенциальные клиенты для активации программы.
          </p>
        </div>
        <button
          onClick={() => onDownload(data)}
          className="ren-btn ren-btn--primary shrink-0 text-xs"
        >
          ↓ xlsx (все)
        </button>
      </div>

      {/* Таблица */}
      <div className="overflow-x-auto">
        <table className="ren-table w-full text-sm">
          <thead className="border-b border-[var(--stroke-divider)]">
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
                    className="cursor-help inline-flex items-center justify-center w-4 h-4 rounded-full border border-[var(--stroke-border)] text-[var(--text-tertiary)] hover:border-[var(--stroke-brand-primary)] hover:text-[var(--text-brand-primary)] hover:bg-[var(--bg-brand-primary-00)] text-[10px] font-bold leading-none transition-colors"
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
                <tr key={s.renId} className="border-t border-[var(--stroke-divider)] transition-colors">
                  <td className="px-4 py-2.5 text-[var(--text-tertiary)] font-medium">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-[var(--text-primary)]">{s.fullName}</span>
                    <span className="block text-xs text-[var(--text-tertiary)]">{s.renId}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs ren-text-secondary">{s.role}</td>
                  {contactFields.map(cf => (
                    <td key={cf} className="px-4 py-2.5 text-xs text-gray-700 whitespace-nowrap">
                      {String(base[cf] ?? '—')}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[var(--text-primary)]">
                    {fmtN(s.totalAccrual)}
                    <span className="block text-[10px] ren-text-secondary font-normal">
                      не исп.: {fmtN(unused)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums ren-text-secondary">
                    {s.accrualCount}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums ren-text-brand">
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

      <div className="ren-card__body border-t border-[var(--stroke-divider)] text-xs ren-text-secondary py-3">
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

// Общий хедер с фильтрами и методологией
function CohortHeader({
  title, subtitle, selectedRoles, onToggle, methodologyOpen, onToggleMethodology, methodologyText,
}: {
  title: string; subtitle: string
  selectedRoles: string[]; onToggle: (r: string) => void
  methodologyOpen: boolean; onToggleMethodology: () => void; methodologyText: React.ReactNode
}) {
  return (
    <div className="ren-card__header space-y-3">
      <div>
        <h2 className="ren-card__title">{title}</h2>
        <p className="ren-card__subtitle">{subtitle}</p>
      </div>
      <div>
        <p className="text-xs font-semibold ren-text-brand mb-1.5">Фильтр по роли:</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ALL_ALLOWED_ROLES.map(role => (
            <label key={role} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={selectedRoles.includes(role)}
                onChange={() => onToggle(role)} className="w-3.5 h-3.5 ren-checkbox" />
              <span className={selectedRoles.includes(role) ? 'ren-text-brand font-medium' : 'text-[var(--text-tertiary)]'}>{role}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <button onClick={onToggleMethodology}
          className="ren-link flex items-center gap-1">
          <span>{methodologyOpen ? '▾' : '▸'}</span>
          <span>Как читать этот отчёт</span>
        </button>
        {methodologyOpen && (
          <div className="mt-2 text-xs ren-text-brand space-y-1 border-t border-[var(--stroke-divider)] pt-2">
            {methodologyText}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Блок: выход партнёров в активность по когортам ──────────────────────────
type CohortType = 'accrual' | 'spend'
type ActivitySegment = '1+' | '3+' | '10+'

const ACTIVITY_SEGMENT_OPTIONS: { id: ActivitySegment; label: string }[] = [
  { id: '1+', label: '1+ списание' },
  { id: '3+', label: '3+ списаний' },
  { id: '10+', label: '10+ списаний' },
]

function activitySegmentLabel(s: ActivitySegment): string {
  return ACTIVITY_SEGMENT_OPTIONS.find(o => o.id === s)?.label ?? s
}

function CohortCumulativeBlock({ rawRows }: { rawRows: RawRow[] }) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(ALL_ALLOWED_ROLES)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [cohortType, setCohortType] = useState<CohortType>('accrual')
  const [segment, setSegment] = useState<ActivitySegment>('3+')

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
      if (segment === '1+') return n >= 1
      if (segment === '3+') return n >= 3
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
    return `rgba(51, 0, 102, ${0.08 + i * 0.55})`
  }

  const segmentLabel = activitySegmentLabel(segment)

  return (
    <div className="ren-card">
      <CohortHeader
        title="Когортный анализ: выход партнёров в активность"
        subtitle={`Ячейка — сколько партнёров из когорты вошли в сегмент «${segmentLabel}» нарастающим итогом к этому месяцу.`}
        selectedRoles={selectedRoles}
        onToggle={r => setSelectedRoles(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r])}
        methodologyOpen={methodologyOpen}
        onToggleMethodology={() => setMethodologyOpen(o => !o)}
        methodologyText={<>
          <p><strong>Когорта</strong> — партнёры, у которых первое начисление РБ (или первое списание) произошло в данном месяце.</p>
          <p><strong>M0</strong> — месяц формирования когорты. <strong>M1</strong> — следующий месяц и т.д.</p>
          <p><strong>Ячейка</strong> — сколько партнёров из когорты к этому месяцу нарастающим итогом набрали 1+, 3+ или 10+ кросс-транзакций (списаний РБ на кросс-Каско) — по выбранному порогу.</p>
          <p>Чем раньше появляются числа в строке — тем быстрее когорта выходит в активность.</p>
        </>}
      />

      {/* Фильтры */}
      <div className="ren-card__body border-t border-[var(--stroke-divider)] flex flex-wrap gap-8 py-3">
        <div>
          <p className="text-xs font-semibold ren-text-brand mb-2">Тип когорты:</p>
          <div className="flex gap-4">
            {([['accrual', 'По первому начислению РБ'], ['spend', 'По первому списанию РБ']] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="radio" name="cohortTypeBlock2" value={v}
                  checked={cohortType === v} onChange={() => setCohortType(v)}
                  className="w-3.5 h-3.5 ren-checkbox" />
                <span className={cohortType === v ? 'ren-text-brand font-medium' : 'ren-text-secondary'}>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold ren-text-brand mb-2">Сегмент по кол-ву кросс-транзакций:</p>
          <div className="ren-segmented">
            {ACTIVITY_SEGMENT_OPTIONS.map(({ id, label }) => (
              <button key={id} onClick={() => setSegment(id)}
                className={`ren-segmented__btn ${segment === id ? 'ren-segmented__btn--active' : ''}`}>
                {label}
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
      <div className="ren-card__body border-t border-[var(--stroke-divider)] text-xs ren-text-secondary py-3">
        Ячейка = партнёры в сегменте <strong>«{segmentLabel}»</strong> нарастающим итогом к этому месяцу.
        {' '}Когорта: <strong>{cohortType === 'accrual' ? 'по первому начислению' : 'по первому списанию'}</strong>.
      </div>
    </div>
  )
}
