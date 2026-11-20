import { useMemo, useState } from 'react'
import type { RawRow } from '../types'
import type { SliderQuoteRow } from '../utils/loyaltyBalances'
import { BUNDLED_LOYALTY_META } from '../data/bundledExtras'
import {
  ACCRUAL_MECHANICS,
  ALL_MECHANICS_ON,
  computeLoyaltyBalances,
  computeMechanicStarts,
  fmtDateRu,
  fmtPct,
  fmtRub,
  MECHANIC_LABELS,
  rollupRegionsTop3,
  SPEND_MECHANICS,
  type MechanicKey,
  type MechanicToggle,
} from '../utils/loyaltyBalances'
import type { AgentFilters } from '../utils/agentNetwork'

interface Props {
  osagoRows: RawRow[]
  kaskoRows: RawRow[]
  sliderQuotes: SliderQuoteRow[]
  filters: AgentFilters
  monthKey: string | null
  yearKey?: number | null
  mechanics?: MechanicToggle
  hasKasko: boolean
  hasSlider: boolean
  agentRows?: RawRow[]
  titleSuffix?: string
}

const COL_KEYS: { key: MechanicKey; short: string }[] = [
  { key: 'accOsago', short: 'Начисл. ОСАГО ФЛ' },
  { key: 'accKasko', short: 'Начисл. КАСКО ФЛ' },
  { key: 'spendCrossDiscount', short: 'Скидка СП (бесполис.)' },
  { key: 'spendCrossKv', short: 'Повыш. КВ (кросс)' },
  { key: 'spendKasko', short: 'Списание КАСКО ФЛ' },
  { key: 'spendOsagoSlider', short: 'ОСАГО пролонгация' },
]

export default function LoyaltyBalancesBlock({
  osagoRows,
  kaskoRows,
  sliderQuotes,
  filters,
  monthKey,
  yearKey = null,
  mechanics = ALL_MECHANICS_ON,
  agentRows,
  titleSuffix,
}: Props) {
  const [regionsOpen, setRegionsOpen] = useState(false)

  const { totals, byRegion } = useMemo(
    () =>
      computeLoyaltyBalances(
        osagoRows,
        kaskoRows,
        sliderQuotes,
        filters,
        monthKey,
        agentRows,
        yearKey,
        mechanics,
      ),
    [osagoRows, kaskoRows, sliderQuotes, filters, monthKey, agentRows, yearKey, mechanics],
  )
  const starts = useMemo(
    () => computeMechanicStarts(osagoRows, kaskoRows, sliderQuotes, filters, agentRows),
    [osagoRows, kaskoRows, sliderQuotes, filters, agentRows],
  )

  const top3 = useMemo(() => rollupRegionsTop3(byRegion), [byRegion])

  const startByKey: Record<MechanicKey, string> = {
    accOsago: fmtDateRu(starts.accOsago),
    accKasko: fmtDateRu(starts.accKasko),
    spendCrossDiscount: fmtDateRu(starts.spendCrossDiscount),
    spendCrossKv: fmtDateRu(starts.spendCrossKv),
    spendKasko: fmtDateRu(starts.spendKasko),
    spendOsagoSlider: fmtDateRu(starts.spendOsagoSlider),
  }

  const visibleCols = COL_KEYS.filter(c => mechanics[c.key])

  return (
    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)]">
        <h3 className="ren-card__title text-sm">
          Начисления и списания РБ (история){titleSuffix ?? ''}
        </h3>
        <p className="text-[11px] ren-text-secondary mt-1 font-normal">
          ОСАГО (2025 статика + 2026 БД) + КАСКО + ползунок.
          {monthKey ? ` · месяц ${monthKey}` : ''}
          {yearKey != null ? ` · год ${yearKey}` : ' · все годы'}
          {' · снимок '}
          {BUNDLED_LOYALTY_META.embeddedAt}
        </p>
      </div>

      <div className="ren-card__body space-y-4">

        <div>
          <p className="text-xs font-semibold ren-text-brand mb-2">
            Механики начисления и списания и даты запуска
          </p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--stroke-divider)]">
                <th className="text-left py-1.5 font-medium ren-text-secondary">Механика</th>
                <th className="text-right py-1.5 font-medium ren-text-secondary w-36">Дата запуска</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(MECHANIC_LABELS) as MechanicKey[]).map(key => (
                <tr key={key} className="border-b border-[var(--stroke-divider)] last:border-0">
                  <td className="py-1.5 pr-2">{MECHANIC_LABELS[key]}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{startByKey[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <MetricsTable
          title="Итого без разбивки по регионам"
          regionLabel="Вся сеть"
          totals={totals}
          columns={visibleCols}
        />

        <MetricsTable
          title="Топ-3: Москва, Санкт-Петербург, Регионы"
          rows={top3}
          columns={visibleCols}
          onToggleRegions={
            top3.some(r => r.rollup === 'regions')
              ? () => setRegionsOpen(o => !o)
              : undefined
          }
          regionsOpen={regionsOpen}
        />

        {regionsOpen &&
          top3
            .filter(r => r.rollup === 'regions' && r.children?.length)
            .flatMap(r => r.children!)
            .map(r => (
              <MetricsTable
                key={r.region}
                title=""
                regionLabel={r.region}
                totals={r}
                columns={visibleCols}
                compact
              />
            ))}
      </div>
    </div>
  )
}

function valForKey(
  totals: {
    accOsago: number
    accKasko: number
    spendCrossDiscount: number
    spendCrossKv: number
    spendKasko: number
    spendOsagoSlider: number
    accTotal: number
    spendTotal: number
    utilPct: number | null
  },
  key: MechanicKey,
): number {
  return totals[key]
}

function MetricsTable({
  title,
  regionLabel,
  totals,
  rows,
  columns,
  compact,
  onToggleRegions,
  regionsOpen,
}: {
  title: string
  regionLabel?: string
  totals?: Parameters<typeof valForKey>[0]
  rows?: ReturnType<typeof rollupRegionsTop3>
  columns: { key: MechanicKey; short: string }[]
  compact?: boolean
  onToggleRegions?: () => void
  regionsOpen?: boolean
}) {
  const bodyRows =
    rows ??
    (totals && regionLabel
      ? [{ region: regionLabel, ...totals }]
      : [])

  return (
    <div className={compact ? 'pl-4 border-l-2 border-[var(--stroke-divider)]' : ''}>
      {title ? <p className="text-xs font-semibold ren-text-brand mb-2">{title}</p> : null}
      <div className="overflow-auto">
        <table className="ren-table w-full text-xs">
          <thead>
            <tr>
              <th className="text-left sticky left-0 bg-[var(--bg-bg-secondary)] z-10">Срез</th>
              {columns.map(c => (
                <th key={c.key} className="text-right whitespace-nowrap">
                  {c.short}
                </th>
              ))}
              <th className="text-right">Начисл. всего</th>
              <th className="text-right">Списано</th>
              <th className="text-right">Утилизация</th>
            </tr>
          </thead>
          <tbody>
            {bodyRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 4} className="text-center ren-text-secondary py-4">
                  Нет данных
                </td>
              </tr>
            ) : (
              bodyRows.map(row => (
                <tr key={row.region}>
                  <td className="font-medium sticky left-0 bg-white">
                    {row.rollup === 'regions' && onToggleRegions ? (
                      <button type="button" onClick={onToggleRegions} className="ren-link text-left">
                        {regionsOpen ? '▾' : '▸'} {row.region}
                      </button>
                    ) : (
                      row.region
                    )}
                  </td>
                  {columns.map(c => (
                    <td key={c.key} className="text-right tabular-nums">
                      {fmtRub(valForKey(row, c.key))}
                    </td>
                  ))}
                  <td className="text-right tabular-nums font-semibold">{fmtRub(row.accTotal)}</td>
                  <td className="text-right tabular-nums font-semibold ren-text-brand">
                    {fmtRub(row.spendTotal)}
                  </td>
                  <td className="text-right tabular-nums">{fmtPct(row.utilPct)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function MechanicFilterPanel({
  mechanics,
  setMechanics,
}: {
  mechanics: MechanicToggle
  setMechanics: (m: MechanicToggle) => void
}) {
  const toggle = (key: MechanicKey) =>
    setMechanics({ ...mechanics, [key]: !mechanics[key] })

  return (
    <div className="ren-card ren-card__body space-y-3">
      <p className="text-sm font-semibold ren-text-brand">Механики в расчёте</p>
      <div>
        <p className="text-xs font-medium ren-text-secondary mb-1.5">Начисления</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ACCRUAL_MECHANICS.map(key => (
            <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={mechanics[key]}
                onChange={() => toggle(key)}
                className="ren-checkbox w-3.5 h-3.5"
              />
              <span>{MECHANIC_LABELS[key]}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium ren-text-secondary mb-1.5">Списания</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {SPEND_MECHANICS.map(key => (
            <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={mechanics[key]}
                onChange={() => toggle(key)}
                className="ren-checkbox w-3.5 h-3.5"
              />
              <span className="max-w-md">{MECHANIC_LABELS[key]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}