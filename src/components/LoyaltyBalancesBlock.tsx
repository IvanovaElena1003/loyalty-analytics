import { useMemo } from 'react'
import type { RawRow } from '../types'
import type { SliderQuoteRow } from '../utils/loyaltyBalances'
import {
  computeLoyaltyBalances,
  fmtPct,
  fmtRub,
} from '../utils/loyaltyBalances'
import type { AgentFilters } from '../utils/agentNetwork'

interface Props {
  osagoRows: RawRow[]
  kaskoRows: RawRow[]
  sliderQuotes: SliderQuoteRow[]
  filters: AgentFilters
  monthKey: string | null
  hasKasko: boolean
  hasSlider: boolean
  agentRows?: RawRow[]
}

export default function LoyaltyBalancesBlock({
  osagoRows,
  kaskoRows,
  sliderQuotes,
  filters,
  monthKey,
  hasKasko,
  hasSlider,
  agentRows,
}: Props) {
  const { totals, byRegion } = useMemo(
    () => computeLoyaltyBalances(osagoRows, kaskoRows, sliderQuotes, filters, monthKey, agentRows),
    [osagoRows, kaskoRows, sliderQuotes, filters, monthKey, agentRows],
  )

  return (
    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)]">
        <h3 className="ren-card__title text-sm">Начисления и списания РБ (история)</h3>
        <p className="text-[11px] ren-text-secondary mt-1 font-normal">
          ОСАГО + КАСКО ФЛ: начисления, кросс (скидка / КВ), КАСКО, пролонгация ОСАГО (ползунок).
          {monthKey ? ` · месяц ${monthKey}` : ' · все месяцы в выборке'}
          {!hasKasko && ' · КАСКО: нет данных в БД'}
          {!hasSlider && ' · ползунок: нет данных в БД'}
        </p>
      </div>

      <div className="ren-card__body space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Начислено" value={fmtRub(totals.accTotal)} sub={`ОС ${fmtRub(totals.accOsago)} · КА ${fmtRub(totals.accKasko)}`} />
          <Kpi label="Списано" value={fmtRub(totals.spendTotal)} highlight />
          <Kpi label="Утилизация" value={fmtPct(totals.utilPct)} />
          <Kpi label="Кросс скидка" value={fmtRub(totals.spendCrossDiscount)} />
          <Kpi label="Кросс КВ" value={fmtRub(totals.spendCrossKv)} />
          <Kpi label="КАСКО + ползунок" value={fmtRub(totals.spendKasko + totals.spendOsagoSlider)} sub={`КА ${fmtRub(totals.spendKasko)} · П ${fmtRub(totals.spendOsagoSlider)}`} />
        </div>

        <div className="overflow-auto max-h-[min(50vh,420px)]">
          <table className="ren-table w-full text-xs">
            <thead>
              <tr>
                <th className="text-left sticky left-0 bg-[var(--bg-bg-secondary)] z-10">Филиал</th>
                <th className="text-right">Начисл. ОСАГО</th>
                <th className="text-right">Начисл. КАСКО</th>
                <th className="text-right">Начисл. всего</th>
                <th className="text-right">Кросс скидка</th>
                <th className="text-right">Кросс КВ</th>
                <th className="text-right">КАСКО</th>
                <th className="text-right">Ползунок</th>
                <th className="text-right">Списано</th>
                <th className="text-right">Утилизация</th>
              </tr>
            </thead>
            <tbody>
              {byRegion.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center ren-text-secondary py-6">
                    Нет данных в выбранном срезе
                  </td>
                </tr>
              ) : (
                byRegion.map(r => (
                  <tr key={r.region}>
                    <td className="font-medium sticky left-0 bg-white">{r.region}</td>
                    <td className="text-right tabular-nums">{fmtRub(r.accOsago)}</td>
                    <td className="text-right tabular-nums">{fmtRub(r.accKasko)}</td>
                    <td className="text-right tabular-nums font-semibold">{fmtRub(r.accTotal)}</td>
                    <td className="text-right tabular-nums">{fmtRub(r.spendCrossDiscount)}</td>
                    <td className="text-right tabular-nums">{fmtRub(r.spendCrossKv)}</td>
                    <td className="text-right tabular-nums">{fmtRub(r.spendKasko)}</td>
                    <td className="text-right tabular-nums">{fmtRub(r.spendOsagoSlider)}</td>
                    <td className="text-right tabular-nums font-semibold ren-text-brand">{fmtRub(r.spendTotal)}</td>
                    <td className="text-right tabular-nums">{fmtPct(r.utilPct)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <div className="ren-kpi">
      <p className="ren-kpi__label">{label}</p>
      <p className={`ren-kpi__value text-lg ${highlight ? 'ren-text-brand' : ''}`}>{value}</p>
      {sub && <p className="text-[10px] ren-text-secondary mt-0.5">{sub}</p>}
    </div>
  )
}
