import type { RawRow } from '../types'
import * as XLSX from 'xlsx'

// ─── Constants ────────────────────────────────────────────────────────────────

const EXCLUDED = new Set(['PolicyAnnulled', 'PolicyTerminated'])
export const MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн',
                           'Июл','Авг','Сен','Окт','Ноя','Дек']

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function parseEngDate(v: unknown): Date | null {
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

export function toMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function toMonthLabel(d: Date): string {
  return `${MONTHS_RU[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function addCalMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}

// ─── Bonus check (consistent with aggregate.ts) ───────────────────────────────

export function hasBonus(row: RawRow): boolean {
  const v = row.LoyaltyPointsInLK
  if (v == null) return false
  const s = String(v).trim()
  if (s === '' || s === '[NULL]') return false
  return Number(s) !== 0
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export function median(arr: number[]): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ─── Download ─────────────────────────────────────────────────────────────────

export function downloadXlsx(rows: Record<string, unknown>[], filename: string) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Данные')
  XLSX.writeFile(wb, filename)
}

// ─── Internal agent model ─────────────────────────────────────────────────────

interface AgentInfo {
  renId: string
  fullName: string
  role: string
  rows: RawRow[]
  t0: Date | null          // min date with bonus
  bonusMonths: Set<string> // month keys where agent had LoyaltyPointsInLK > 0
}

function buildAgentMap(rawRows: RawRow[]): Map<string, AgentInfo> {
  const map = new Map<string, AgentInfo>()

  for (const row of rawRows) {
    const renId = String(row.RenId ?? '').trim()
    if (!renId) continue

    if (!map.has(renId)) {
      map.set(renId, {
        renId, fullName: '', role: '',
        rows: [], t0: null, bonusMonths: new Set(),
      })
    }
    const a = map.get(renId)!
    a.rows.push(row)
    if (row.FullName && !a.fullName) a.fullName = String(row.FullName)
    if (row.Role     && !a.role)     a.role     = String(row.Role)

    const d = parseEngDate(row.CreateDate)
    if (hasBonus(row) && d) {
      if (!a.t0 || d.getTime() < a.t0.getTime()) a.t0 = d
      a.bonusMonths.add(toMonthKey(d))
    }
  }
  return map
}

function lastDate(rows: RawRow[]): string {
  let max = 0
  for (const r of rows) {
    const d = parseEngDate(r.CreateDate)
    if (d) max = Math.max(max, d.getTime())
  }
  return max ? new Date(max).toLocaleDateString('ru-RU') : '—'
}

// ─── Section 1 types + compute ────────────────────────────────────────────────

export interface AgentExportRow {
  RenId: string
  ФИО: string
  Роль: string
  'Кол-во полисов': number
  'Последняя активность': string
}

export interface RoleStats {
  role: string
  total: number
  tried: number
  notTriedAgents: AgentExportRow[]
}

export interface Section1Result {
  byRole: RoleStats[]
  grandTotal: number
  grandTried: number
  allNotTried: AgentExportRow[]
}

export function computeSection1(rawRows: RawRow[]): Section1Result {
  const agentMap = buildAgentMap(rawRows)
  const roleMap  = new Map<string, RoleStats>()

  for (const a of agentMap.values()) {
    if (!a.rows.some(r => r.State === 'PolicyIssued')) continue

    const role  = a.role || 'Не указана'
    const tried = a.bonusMonths.size > 0
    if (!roleMap.has(role)) roleMap.set(role, { role, total: 0, tried: 0, notTriedAgents: [] })
    const b = roleMap.get(role)!
    b.total++
    if (tried) {
      b.tried++
    } else {
      b.notTriedAgents.push({
        RenId: a.renId,
        ФИО: a.fullName || '—',
        Роль: role,
        'Кол-во полисов': a.rows.filter(r => r.State === 'PolicyIssued').length,
        'Последняя активность': lastDate(a.rows),
      })
    }
  }

  const byRole = Array.from(roleMap.values()).sort((a, b) => {
    const pa = a.total ? (a.total - a.tried) / a.total : 0
    const pb = b.total ? (b.total - b.tried) / b.total : 0
    return pb - pa
  })

  return {
    byRole,
    grandTotal:   byRole.reduce((s, r) => s + r.total,  0),
    grandTried:   byRole.reduce((s, r) => s + r.tried,  0),
    allNotTried:  byRole.flatMap(r => r.notTriedAgents),
  }
}

// ─── Section 2 types + compute ────────────────────────────────────────────────

export interface CohortRow {
  cohortKey: string
  cohortLabel: string
  agentCount: number
  retention: (number | null)[]  // M+0 … M+4
}

export interface Section2Result {
  cohorts: CohortRow[]
  maxOffset: number
  medianByOffset: (number | null)[]
}

export function computeSection2(rawRows: RawRow[]): Section2Result {
  const agentMap  = buildAgentMap(rawRows)
  const allMonths = new Set<string>()
  for (const row of rawRows) {
    const d = parseEngDate(row.CreateDate)
    if (d) allMonths.add(toMonthKey(d))
  }

  const MAX = 5  // M+0 … M+4

  // Group agents by cohort month
  const cohortMap = new Map<string, { label: string; agents: AgentInfo[] }>()
  for (const a of agentMap.values()) {
    if (!a.t0) continue
    const key   = toMonthKey(a.t0)
    const label = toMonthLabel(a.t0)
    if (!cohortMap.has(key)) cohortMap.set(key, { label, agents: [] })
    cohortMap.get(key)!.agents.push(a)
  }

  const cohorts: CohortRow[] = []

  for (const [cohortKey, cohort] of cohortMap) {
    if (cohort.agents.length < 5) continue

    const base      = new Date(cohortKey + '-01T00:00:00Z')
    const retention = Array.from({ length: MAX }, (_, mo): number | null => {
      const targetKey = toMonthKey(addCalMonths(base, mo))
      if (!allMonths.has(targetKey)) return null
      const active = cohort.agents.filter(a => a.bonusMonths.has(targetKey)).length
      return (active / cohort.agents.length) * 100
    })

    cohorts.push({ cohortKey, cohortLabel: cohort.label, agentCount: cohort.agents.length, retention })
  }

  cohorts.sort((a, b) => a.cohortKey.localeCompare(b.cohortKey))

  const medianByOffset = Array.from({ length: MAX }, (_, mo) => {
    const vals = cohorts.map(c => c.retention[mo]).filter((v): v is number => v !== null)
    return vals.length ? median(vals) : null
  })

  return { cohorts, maxOffset: MAX, medianByOffset }
}

// ─── Section 3 types + compute ────────────────────────────────────────────────

export interface WindowMetrics { quotations: number; issued: number; conversion: number; cross: number }
export interface Section3Result {
  beforeMed: WindowMetrics
  afterMed:  WindowMetrics
  deltaMed:  WindowMetrics   // median of per-agent deltas
  agentsIncluded: number
  agentsTotal:    number
}

export function computeSection3(rawRows: RawRow[]): Section3Result | null {
  const agentMap = buildAgentMap(rawRows)
  const WIN_MS   = 60 * 86400000

  const bQ: number[] = [], bI: number[] = [], bV: number[] = [], bX: number[] = []
  const aQ: number[] = [], aI: number[] = [], aV: number[] = [], aX: number[] = []
  const dQ: number[] = [], dI: number[] = [], dV: number[] = [], dX: number[] = []

  let included = 0, total = 0

  for (const a of agentMap.values()) {
    if (!a.t0) continue
    total++
    const t0 = a.t0.getTime()

    const before = a.rows.filter(r => {
      const d = parseEngDate(r.CreateDate)
      return d && d.getTime() >= t0 - WIN_MS && d.getTime() < t0
    })
    const after = a.rows.filter(r => {
      const d = parseEngDate(r.CreateDate)
      return d && d.getTime() >= t0 && d.getTime() < t0 + WIN_MS
    })
    if (before.length < 3 || after.length < 3) continue
    included++

    const metrics = (rows: RawRow[]): WindowMetrics => {
      const valid  = rows.filter(r => !EXCLUDED.has(String(r.State ?? '')))
      const issued = valid.filter(r => r.State === 'PolicyIssued').length
      const cross  = valid.filter(r => r.State === 'PolicyIssued' && String(r.CrossIsBought ?? '') === 'Да').length
      const quot   = valid.length
      return { quotations: quot, issued, conversion: quot ? (issued / quot) * 100 : 0, cross }
    }

    const bm = metrics(before)
    const am = metrics(after)

    bQ.push(bm.quotations); bI.push(bm.issued); bV.push(bm.conversion); bX.push(bm.cross)
    aQ.push(am.quotations); aI.push(am.issued); aV.push(am.conversion); aX.push(am.cross)
    dQ.push(am.quotations - bm.quotations)
    dI.push(am.issued     - bm.issued)
    dV.push(am.conversion - bm.conversion)
    dX.push(am.cross      - bm.cross)
  }

  if (!included) return null

  return {
    beforeMed: { quotations: median(bQ), issued: median(bI), conversion: median(bV), cross: median(bX) },
    afterMed:  { quotations: median(aQ), issued: median(aI), conversion: median(aV), cross: median(aX) },
    deltaMed:  { quotations: median(dQ), issued: median(dI), conversion: median(dV), cross: median(dX) },
    agentsIncluded: included,
    agentsTotal:    total,
  }
}
