import type { RawRow } from '../types'

export const AGENT_FILTER_KEYS = ['ДИВИЗИОН', 'ФИЛИАЛ', 'УПРАВЛЕНИЕ', 'КОД_КП', 'КУРАТОР', 'ПОСРЕДНИК'] as const
export type AgentFilterKey = typeof AGENT_FILTER_KEYS[number]
export type AgentFilters = Record<AgentFilterKey, string[]>

export const EMPTY_AGENT_FILTERS: AgentFilters = {
  ДИВИЗИОН: [], ФИЛИАЛ: [], УПРАВЛЕНИЕ: [], КОД_КП: [], КУРАТОР: [], ПОСРЕДНИК: [],
}

export const AGENT_FILTER_LABELS: Record<AgentFilterKey, string> = {
  ДИВИЗИОН: 'Дивизион',
  ФИЛИАЛ: 'Филиал',
  УПРАВЛЕНИЕ: 'Управление',
  КОД_КП: 'Код КП',
  КУРАТОР: 'Куратор',
  ПОСРЕДНИК: 'Посредник',
}

/** Join loyalty rows with agent-network dimensions by CashbookId / HeadPartnerCB. */
export function enrichRawRows(rawRows: RawRow[], agentRows?: RawRow[]): RawRow[] {
  if (!agentRows || agentRows.length === 0) return rawRows
  const lookup = new Map<string, RawRow>()
  for (const r of agentRows) {
    const id = String(r['subj_id'] ?? '').trim()
    if (id && id !== 'null') lookup.set(id, r)
  }
  return rawRows.map(r => {
    const cb = String(r['CashbookId'] ?? '').trim()
    const hcb = String(r['HeadPartnerCB'] ?? '').trim()
    const key = (cb && cb !== '[NULL]') ? cb : hcb
    const agent = key ? lookup.get(key) : undefined
    if (!agent) return r
    const extra: Record<string, unknown> = {}
    for (const k of AGENT_FILTER_KEYS) extra[k] = agent[k] ?? null
    return { ...r, ...extra }
  })
}

export function filterEnrichedRows(enrichedRows: RawRow[], filters: AgentFilters): RawRow[] {
  const active = AGENT_FILTER_KEYS.filter(k => filters[k].length > 0)
  if (active.length === 0) return enrichedRows
  return enrichedRows.filter(r =>
    active.every(k => filters[k].includes(String(r[k] ?? '').trim()))
  )
}
