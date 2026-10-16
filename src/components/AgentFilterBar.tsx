import { useMemo, useState } from 'react'
import type { RawRow } from '../types'
import {
  AGENT_FILTER_KEYS,
  AGENT_FILTER_LABELS,
  EMPTY_AGENT_FILTERS,
  type AgentFilterKey,
  type AgentFilters,
} from '../utils/agentNetwork'

export function AgentFilterBar({
  enrichedRows,
  filters,
  setFilters,
  lockedCurator,
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
    <div className="ren-card ren-card--popover mb-4">
      <div className="ren-card__header">
        <div className="flex items-center justify-between mb-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold ren-text-brand">Фильтры по агентской сети</span>
            {activeCount > 0 && (
              <span className="ren-badge">{activeCount} активных</span>
            )}
          </div>
          {activeCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_AGENT_FILTERS)}
              className="ren-link">
              Сбросить всё
            </button>
          )}
        </div>
      </div>
      <div className="ren-card__body pt-3 pb-4">
        {lockedCurator && (
          <div className="mb-2 flex items-center gap-2">
            <span className="ren-badge">Куратор: {lockedCurator}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {AGENT_FILTER_KEYS.map(key => {
            const opts = options[key]
            const sel = filters[key]
            const isOpen = open === key
            if (opts.length === 0) return null
            if (key === 'КУРАТОР' && lockedCurator) return null
            return (
              <div key={key} className="relative">
                <button
                  onClick={() => setOpen(isOpen ? null : key)}
                  className={`ren-btn text-xs py-1.5 px-3 ${
                    sel.length > 0 ? 'ren-btn--primary' : 'ren-btn--secondary'
                  }`}
                >
                  <span>{AGENT_FILTER_LABELS[key]}</span>
                  {sel.length > 0 && <span className="bg-white/30 rounded px-1">{sel.length}</span>}
                  <span className="opacity-60">{isOpen ? '▴' : '▾'}</span>
                </button>
                {isOpen && (
                  <div className="ren-popover">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--stroke-divider)]">
                      <span className="text-xs font-semibold ren-text-brand">{AGENT_FILTER_LABELS[key]}</span>
                      {sel.length > 0 && (
                        <button onClick={() => setFilters(p => ({ ...p, [key]: [] }))}
                          className="ren-link text-[10px]">
                          Сбросить
                        </button>
                      )}
                    </div>
                    <div className="max-h-52 overflow-y-auto py-1">
                      {opts.map(v => (
                        <label key={v} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-brand-primary-00)] cursor-pointer">
                          <input type="checkbox" checked={sel.includes(v)} onChange={() => toggle(key, v)}
                            className="w-3.5 h-3.5 ren-checkbox flex-shrink-0" />
                          <span className={`text-xs truncate ${sel.includes(v) ? 'font-medium ren-text-brand' : 'ren-text-secondary'}`}>{v}</span>
                        </label>
                      ))}
                    </div>
                    <div className="px-3 py-2 border-t border-[var(--stroke-divider)] text-[10px] ren-text-secondary">
                      {sel.length === 0 ? `Все ${opts.length}` : `Выбрано ${sel.length} из ${opts.length}`}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
