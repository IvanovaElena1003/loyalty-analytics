import { useMemo } from 'react'
import type { RawRow } from '../types'
import type { SliderQuoteRow } from '../utils/loyaltyBalances'
import { BUNDLED_LOYALTY_META } from '../data/bundledExtras'
import {
  computeLoyaltyBalances,
  computeMechanicStarts,
  fmtDateRu,
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
  titleSuffix?: string
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
  titleSuffix,
}: Props) {
  const { totals, byRegion } = useMemo(
    () => computeLoyaltyBalances(osagoRows, kaskoRows, sliderQuotes, filters, monthKey, agentRows),
    [osagoRows, kaskoRows, sliderQuotes, filters, monthKey, agentRows],
  )
  const starts = useMemo(
    () => computeMechanicStarts(osagoRows, kaskoRows, sliderQuotes, filters, agentRows),
    [osagoRows, kaskoRows, sliderQuotes, filters, agentRows],
  )

  const mechanicRows: { label: string; start: string; note?: string }[] = [
    { label: 'Начисление ОСАГО (LoyaltyPointsInLK)', start: fmtDateRu(starts.accOsago) },
    { label: 'Начисление КАСКО (LoyaltyPointsOut × СП)', start: fmtDateRu(starts.accKasko), note: !hasKasko ? 'нет в БД' : undefined },
    { label: 'Списание · кросс скидка (бесполисные)', start: fmtDateRu(starts.spendCrossDiscount) },
    { label: 'Списание · кросс повыш. КВ', start: fmtDateRu(starts.spendCrossKv) },
    { label: 'Списание · КАСКО (кошелёк + скоринг)', start: fmtDateRu(starts.spendKasko), note: !hasKasko ? 'нет в БД' : undefined },
    { label: 'Списание · ОСАГО пролонгация (ползунок)', start: fmtDateRu(starts.spendOsagoSlider), note: !hasSlider ? 'нет в БД' : undefined },
  ]

  return (
    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)]">
        <h3 className="ren-card__title text-sm">
          Начисления и списания РБ (история){titleSuffix ?? ''}
        </h3>
        <p className="text-[11px] ren-text-secondary mt-1 font-normal">
          ОСАГО (2025 в статике + 2026 из БД) + КАСКО + ползунок. Субучётки → HeadPartnerCB; Seller/Продавец не в суммах.
          {monthKey ? ` · месяц ${monthKey}` : ' · все месяцы в выборке'}
          {' · снимок '}
          {BUNDLED_LOYALTY_META.embeddedAt}
        </p>
      </div>

      <div className="ren-card__body space-y-4">

        <div className="text-xs ren-text-secondary bg-[var(--bg-brand-primary-00)] border border-[var(--stroke-divider)] rounded-lg px-3 py-2.5">
          <strong className="ren-text-brand">Про 60 млн и 81 млн начислений:</strong> в раннем HTML-отчёте сумма была занижена (~21 млн ₽)
          — в итог не попадали оформленные ОСАГО <em>без CashbookId</em> в выгрузке. В дашборде считаем все строки <code>PolicyIssued</code>;
          КАСКО и ползунок на начисление почти не влияют (КАСКО ~1,6 млн ₽).
        </div>

        <div>
          <p className="text-xs font-semibold ren-text-brand mb-2">С какого дня есть события (по загруженным данным)</p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--stroke-divider)]">
                <th className="text-left py-1.5 font-medium ren-text-secondary">Механика</th>
                <th className="text-right py-1.5 font-medium ren-text-secondary w-36">Первое событие</th>
              </tr>
            </thead>
            <tbody>
              {mechanicRows.map(r => (
                <tr key={r.label} className="border-b border-[var(--stroke-divider)] last:border-0">
                  <td className="py-1.5 pr-2">{r.label}{r.note ? ` · ${r.note}` : ''}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{r.start}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
