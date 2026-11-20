import { useMemo, useState } from 'react'
import type { AggregateResult } from '../../types'
import type { RawRow } from '../../types'
import { AgentFilterBar } from '../AgentFilterBar'
import {
  EMPTY_AGENT_FILTERS,
  enrichRawRows,
  filterEnrichedRows,
  type AgentFilters,
} from '../../utils/agentNetwork'
import type { SliderQuoteRow } from '../../utils/loyaltyBalances'
import LoyaltyBalancesBlock, { MechanicFilterPanel } from '../LoyaltyBalancesBlock'
import { ALL_MECHANICS_ON, type MechanicToggle } from '../../utils/loyaltyBalances'
import LoyaltyPartnerMetricsBlock from '../LoyaltyPartnerMetricsBlock'

interface Props {
  result: AggregateResult
  agentRows?: RawRow[]
  kaskoRows?: RawRow[]
  sliderQuotes?: SliderQuoteRow[]
  osago2025Count?: number
  lockedCurator?: string
}

export default function StatusesTab({
  result,
  agentRows,
  kaskoRows,
  sliderQuotes,
  osago2025Count = 0,
  lockedCurator,
}: Props) {
  const [agentFilters, setAgentFilters] = useState<AgentFilters>(() =>
    lockedCurator
      ? { ...EMPTY_AGENT_FILTERS, КУРАТОР: [lockedCurator] }
      : EMPTY_AGENT_FILTERS,
  )
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [mechanics, setMechanics] = useState<MechanicToggle>(() => ({ ...ALL_MECHANICS_ON }))

  const enrichedRows = useMemo(
    () => enrichRawRows(result.rawRows, agentRows),
    [result.rawRows, agentRows],
  )
  const filteredRows = useMemo(
    () => filterEnrichedRows(enrichedRows, agentFilters),
    [enrichedRows, agentFilters],
  )
  const enrichedKasko = useMemo(
    () => enrichRawRows(kaskoRows ?? [], agentRows),
    [kaskoRows, agentRows],
  )
  const filteredKasko = useMemo(
    () => filterEnrichedRows(enrichedKasko, agentFilters),
    [enrichedKasko, agentFilters],
  )

  const months = useMemo(() => {
    const keys = new Set<string>()
    for (const row of filteredRows) {
      const v = row.CreateDate
      let d: Date | null = null
      if (v instanceof Date) d = v
      else if (typeof v === 'string') d = new Date(v)
      else if (typeof v === 'number') d = new Date((v - 25569) * 86400000)
      if (!d || isNaN(d.getTime())) continue
      keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
    return Array.from(keys)
      .sort()
      .map(sortKey => {
        const [y, mo] = sortKey.split('-').map(Number)
        return { sortKey, label: `${names[mo - 1]} ${y}` }
      })
  }, [filteredRows])

  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const row of filteredRows) {
      const v = row.CreateDate
      let d: Date | null = null
      if (v instanceof Date) d = v
      else if (typeof v === 'string') d = new Date(v)
      else if (typeof v === 'number') d = new Date((v - 25569) * 86400000)
      if (d && !isNaN(d.getTime())) ys.add(d.getFullYear())
    }
    return Array.from(ys).sort((a, b) => b - a)
  }, [filteredRows])

  const activeFilterCount = useMemo(
    () => Object.values(agentFilters).filter(a => a.length > 0).length,
    [agentFilters],
  )

  return (
    <div className="space-y-6">
      <div className="ren-card ren-card__body text-sm ren-text-secondary">
        Загружено из статики: ОСАГО 2025 — {osago2025Count.toLocaleString('ru-RU')} строк, КАСКО — {(kaskoRows?.length ?? 0).toLocaleString('ru-RU')}, ползунок — {(sliderQuotes?.length ?? 0).toLocaleString('ru-RU')}.
        {osago2025Count === 0 && (
          <span className="block mt-1 text-[var(--text-warning)] font-medium">
            Снимок ОСАГО 2025 не подгрузился (обновите страницу или проверьте /data/bundled-osago-2025.json).
          </span>
        )}
        <span className="block mt-2">
        Сводка для отчёта по статусам лояльности: начисления/списания РБ, метрики партнёров по кешбуку.
        Субучётки (Partnerseller, PartnerLead и др.) схлопываются в{' '}
        <code className="ren-bg-brand-soft px-1 rounded">HeadPartnerCB</code>.
        Исключены только роли <strong>Seller</strong> / <strong>Продавец</strong> (не «внутри партнёра»).
        В исходном xlsx 2025 лист <strong>октябрь пустой</strong> — его нет в снимке, это не потеря при деплое.
        </span>
      </div>

      <AgentFilterBar
        enrichedRows={enrichedRows}
        filters={agentFilters}
        setFilters={setAgentFilters}
        lockedCurator={lockedCurator}
      />

      {activeFilterCount > 0 && (
        <div className="ren-card ren-card__body text-sm ren-text-secondary">
          Фильтры агентской сети: {filteredRows.length.toLocaleString('ru-RU')} строк ОСАГО в выборке.
          {!agentRows?.length && (
            <span className="block mt-1 text-xs">
              Без файла агентской сети работают только срезы по кешбуку; дивизион/филиал/куратор — после загрузки
              базы B2Partners (subj_id = CashbookId).
            </span>
          )}
        </div>
      )}

      <div className="ren-card ren-card__body flex flex-wrap items-center gap-3">
        <span className="text-sm ren-text-brand font-medium shrink-0">Год:</span>
        <select
          value={selectedYear ?? ''}
          onChange={e => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
          className="ren-select text-sm"
        >
          <option value="">Все годы</option>
          {years.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-sm ren-text-brand font-medium shrink-0 ml-2">Месяц:</span>
        <select
          value={selectedMonth ?? ''}
          onChange={e => setSelectedMonth(e.target.value || null)}
          className="ren-select text-sm"
        >
          <option value="">Все месяцы</option>
          {months.map(m => (
            <option key={m.sortKey} value={m.sortKey}>{m.label}</option>
          ))}
        </select>
        {(selectedMonth || selectedYear != null) && (
          <button
            type="button"
            onClick={() => { setSelectedMonth(null); setSelectedYear(null) }}
            className="ren-link text-xs"
          >
            ✕ сбросить период
          </button>
        )}
      </div>

      <MechanicFilterPanel mechanics={mechanics} setMechanics={setMechanics} />

      <LoyaltyBalancesBlock
        osagoRows={filteredRows}
        kaskoRows={filteredKasko}
        sliderQuotes={sliderQuotes ?? []}
        filters={agentFilters}
        monthKey={selectedMonth}
        yearKey={selectedYear}
        mechanics={mechanics}
        hasKasko={(kaskoRows?.length ?? 0) > 0}
        hasSlider={(sliderQuotes?.length ?? 0) > 0}
        agentRows={agentRows}
      />

      <LoyaltyPartnerMetricsBlock
        osagoRows={filteredRows}
        filters={agentFilters}
        agentRows={agentRows}
        maxCreateDate={result.maxCreateDate}
      />
    </div>
  )
}