import { useMemo } from 'react'
import type { RawRow } from '../types'
import type { AgentFilters } from '../utils/agentNetwork'
import {
  computeLoyaltyPartnerBoardMetrics,
  type LoyaltyPartnerBoardMetrics,
} from '../utils/loyaltyPartnerMetrics'
import { fmtPct } from '../utils/loyaltyBalances'

interface Props {
  osagoRows: RawRow[]
  filters: AgentFilters
  agentRows?: RawRow[]
  maxCreateDate?: string | null
}

const fmtN = (n: number) => n.toLocaleString('ru-RU')

export default function LoyaltyPartnerMetricsBlock({
  osagoRows,
  filters,
  agentRows,
  maxCreateDate,
}: Props) {
  const refDate = maxCreateDate ? new Date(maxCreateDate + 'T12:00:00') : null
  const m = useMemo(
    () => computeLoyaltyPartnerBoardMetrics(osagoRows, filters, agentRows, refDate),
    [osagoRows, filters, agentRows, refDate],
  )

  return (
    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)]">
        <h3 className="ren-card__title text-sm">Партнёры и РБ · как на слайде</h3>
        <p className="text-[11px] ren-text-secondary mt-1 font-normal">
          1 партнёр = 1 кешбук: PartnerDir, PartnerLead, Partnerseller и русские аналоги схлопнуты в HeadPartnerCB.
          Не считаем только Seller / Продавец (не «внутри партнёра»).
          Активные:{' '}
          {m.activeSource === 'agent_network'
            ? 'агентская сеть (борд)'
            : `≥ ${3} оформленных ОСАГО в периоде`}
          .
        </p>
      </div>
      <div className="ren-card__body space-y-4">
        <PeriodBlock title={`Начисления · ${m.periodLabel}`} metrics={m} kind="accrual" />
        <PeriodBlock title={`Списания (кросс) · ${m.periodLabel}`} metrics={m} kind="spend" />
        <div>
          <p className="text-xs font-semibold ren-text-brand mb-2">Динамика · последние 3 полных месяца</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-[var(--stroke-divider)]">
                  <th className="text-left py-2 font-medium ren-text-secondary">Месяц</th>
                  <th className="text-right py-2 font-medium ren-text-secondary">С начислением</th>
                  <th className="text-right py-2 font-medium ren-text-secondary">% от активных</th>
                  <th className="text-right py-2 font-medium ren-text-secondary">Со списанием</th>
                  <th className="text-right py-2 font-medium ren-text-secondary">% от с накоплениями</th>
                </tr>
              </thead>
              <tbody>
                {m.last3Months.map(row => (
                  <tr key={row.ym} className="border-b border-[var(--stroke-divider)] last:border-0">
                    <td className="py-2 pr-2 font-medium">{row.label}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtN(row.withAccrual)}
                      <span className="ren-text-secondary"> / {fmtN(row.activePartners)}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold ren-text-brand">
                      {fmtPct(row.accrualSharePct)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtN(row.withSpend)}
                      <span className="ren-text-secondary"> / {fmtN(row.withAccrualEver)}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold ren-text-brand">
                      {fmtPct(row.spendShareOfAccrualsPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function PeriodBlock({
  title,
  metrics,
  kind,
}: {
  title: string
  metrics: LoyaltyPartnerBoardMetrics
  kind: 'accrual' | 'spend'
}) {
  const fp = metrics.fullPeriod
  if (kind === 'accrual') {
    return (
      <MetricHero
        title={title}
        big={fmtN(fp.accrualPartners)}
        denom={fmtN(fp.activePartners)}
        pct={fp.accrualSharePct}
        caption="партнёров с начислением / активных"
      />
    )
  }
  return (
    <MetricHero
      title={title}
      big={fmtN(fp.spendPartners)}
      denom={fmtN(fp.accrualBaseForSpend)}
      pct={fp.spendSharePct}
      caption="партнёров со списанием >0 / с накоплениями за год"
    />
  )
}

function MetricHero({
  title,
  big,
  denom,
  pct,
  caption,
}: {
  title: string
  big: string
  denom: string
  pct: number | null
  caption: string
}) {
  return (
    <div className="rounded-xl border border-[var(--stroke-divider)] bg-gradient-to-br from-[var(--bg-brand-primary-00)] to-[var(--bg-content)] p-4">
      <p className="text-xs font-semibold ren-text-secondary mb-2">{title}</p>
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-3xl font-bold tabular-nums ren-text-brand leading-none">{big}</p>
        <p className="text-lg ren-text-secondary tabular-nums pb-0.5">/ {denom}</p>
        <p className="text-2xl font-bold tabular-nums text-[var(--text-success)] ml-auto">{fmtPct(pct)}</p>
      </div>
      <p className="text-[11px] ren-text-secondary mt-2">{caption}</p>
    </div>
  )
}