import type { RawRow } from '../types'
import { parseEngDate } from './engagement'

const EXCLUDED = new Set(['PolicyAnnulled', 'PolicyTerminated'])
/** Октябрь 2026: дни, исключённые из среза (как в Excel-выгрузке). */
const OCT_SKIP_DAYS = new Set([8, 12, 14, 22])

export interface CrossImpactRow {
  cashbook: string
  name: string
  curator: string
  filial: string
  division: string
  mediatorType: string
  salesChannel: string
  osSep: number
  osOct: number
  crossSep: number
  crossOct: number
  convSep: number
  convOct: number
  deltaConvPp: number
  impactPp: number
  deltaCross: number
}

export interface CrossImpactResult {
  rows: CrossImpactRow[]
  totalOsSep: number
  totalOsOct: number
  convSep: number
  convOct: number
  deltaConvPp: number
}

type Bucket = {
  osSep: number
  osOct: number
  crossSep: number
  crossOct: number
  name: string
  channels: Map<string, number>
}

function mediatorTypeFromKp(kp: string): string {
  const c = kp.trim().toUpperCase()
  if (c.startsWith('SRL')) return 'Агент'
  if (c.startsWith('SSP')) return 'Брокер'
  return '—'
}

function modeChannel(channels: Map<string, number>, fallback: string): string {
  let best = fallback
  let max = 0
  for (const [k, n] of channels) {
    if (n > max) { max = n; best = k }
  }
  return best || '—'
}

function isSep2026(d: Date): boolean {
  return d.getFullYear() === 2026 && d.getMonth() === 8
}

function isOct2026Slice(d: Date): boolean {
  if (d.getFullYear() !== 2026 || d.getMonth() !== 9) return false
  return !OCT_SKIP_DAYS.has(d.getDate())
}

function buildAgentLookup(agentRows?: RawRow[]): Map<string, RawRow> {
  const lookup = new Map<string, RawRow>()
  if (!agentRows) return lookup
  for (const r of agentRows) {
    const id = String(r['subj_id'] ?? '').trim()
    if (id && id !== 'null') lookup.set(id, r)
  }
  return lookup
}

function agentForCashbook(cb: string, lookup: Map<string, RawRow>): RawRow | undefined {
  return lookup.get(cb)
}

/** Сентябрь (полный) vs октябрь (без 08/12/14/22) — вклад партнёров по CashbookId. */
export function computeCrossImpactSepOct(
  rawRows: RawRow[],
  agentRows?: RawRow[],
): CrossImpactResult {
  const agentLookup = buildAgentLookup(agentRows)
  const byCb = new Map<string, Bucket>()

  let totalOsSep = 0
  let totalOsOct = 0
  let totalCrossSep = 0
  let totalCrossOct = 0

  for (const row of rawRows) {
    const state = String(row.State ?? '')
    if (EXCLUDED.has(state) || state !== 'PolicyIssued') continue

    const cb = String(row.CashbookId ?? '').trim()
    if (!cb || cb === '[NULL]') continue

    const d = parseEngDate(row.CreateDate)
    if (!d) continue

    const inSep = isSep2026(d)
    const inOct = isOct2026Slice(d)
    if (!inSep && !inOct) continue

    if (!byCb.has(cb)) {
      byCb.set(cb, {
        osSep: 0, osOct: 0, crossSep: 0, crossOct: 0,
        name: '', channels: new Map(),
      })
    }
    const b = byCb.get(cb)!
    const cross = String(row.CrossIsBought ?? '').trim() === 'Да'
    const ch = String(row.SalesChannel ?? '').trim()
    if (ch) b.channels.set(ch, (b.channels.get(ch) ?? 0) + 1)

    const fn = String(row.FullName ?? row.AgentName ?? '').trim()
    if (fn && !b.name) b.name = fn

    if (inSep) {
      b.osSep++
      totalOsSep++
      if (cross) { b.crossSep++; totalCrossSep++ }
    }
    if (inOct) {
      b.osOct++
      totalOsOct++
      if (cross) { b.crossOct++; totalCrossOct++ }
    }
  }

  const convSep = totalOsSep > 0 ? (totalCrossSep / totalOsSep) * 100 : 0
  const convOct = totalOsOct > 0 ? (totalCrossOct / totalOsOct) * 100 : 0

  const rows: CrossImpactRow[] = []

  for (const [cashbook, b] of byCb) {
    if (b.osSep <= 0) continue

    const agent = agentForCashbook(cashbook, agentLookup)
    const kpAgent = agent ? String(agent['КОД_КП'] ?? '').trim() : ''
    const salesChannel = modeChannel(b.channels, kpAgent)
    const kp = salesChannel !== '—' ? salesChannel : kpAgent

    const name =
      (agent ? String(agent['ПОСРЕДНИК'] ?? '').trim() : '') ||
      b.name ||
      '—'
    const curator = agent ? String(agent['КУРАТОР'] ?? '').trim() || '—' : '—'
    const filial = agent ? String(agent['ФИЛИАЛ'] ?? '').trim() || '—' : '—'
    const division = agent ? String(agent['ДИВИЗИОН'] ?? '').trim() || '—' : '—'

    const cSep = b.osSep > 0 ? (b.crossSep / b.osSep) * 100 : 0
    const cOct = b.osOct > 0 ? (b.crossOct / b.osOct) * 100 : 0
    const deltaConvPp = cOct - cSep
    const impactPp = totalOsSep > 0 ? (b.osSep / totalOsSep) * deltaConvPp : 0

    rows.push({
      cashbook,
      name,
      curator,
      filial,
      division,
      mediatorType: mediatorTypeFromKp(kp),
      salesChannel: kp || '—',
      osSep: b.osSep,
      osOct: b.osOct,
      crossSep: b.crossSep,
      crossOct: b.crossOct,
      convSep: cSep,
      convOct: cOct,
      deltaConvPp,
      impactPp,
      deltaCross: b.crossOct - b.crossSep,
    })
  }

  return {
    rows,
    totalOsSep,
    totalOsOct,
    convSep,
    convOct,
    deltaConvPp: convOct - convSep,
  }
}

export function crossImpactToXlsxRow(r: CrossImpactRow, index: number): Record<string, unknown> {
  const fmtConv = (v: number) =>
    Math.round(v * 100) / 100
  return {
    '№': index,
    Cashbook: r.cashbook,
    'Наименование партнёра': r.name,
    Куратор: r.curator,
    Филиал: r.filial,
    Дивизион: r.division,
    'Тип посредника': r.mediatorType,
    'Канал продаж (КП)': r.salesChannel,
    'ОСАГО сент': r.osSep,
    'ОСАГО окт': r.osOct,
    'Кросс сент': r.crossSep,
    'Кросс окт': r.crossOct,
    'Conv сент, %': fmtConv(r.convSep),
    'Conv окт, %': fmtConv(r.convOct),
    'Δ conv, п.п.': Math.round(r.deltaConvPp * 100) / 100,
    'Влияние на общую conv, п.п.': Math.round(r.impactPp * 10000) / 10000,
    'Δ кросс, шт': r.deltaCross,
  }
}
