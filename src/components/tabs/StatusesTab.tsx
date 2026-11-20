import { useMemo, useState } from 'react'
import { STATUSES_SNAPSHOT } from '../../data/statusesSnapshot'
import {
  MECHANIC_LABELS,
  fmtPct,
  fmtRub,
  type MechanicKey,
} from '../../utils/loyaltyBalances'

const COL_KEYS: { key: MechanicKey; short: string }[] = [
  { key: 'accOsago', short: 'Начисл. ОСАГО ФЛ' },
  { key: 'accKasko', short: 'Начисл. КАСКО ФЛ' },
  { key: 'spendCrossDiscount', short: 'Скидка СП (бесполис.)' },
  { key: 'spendCrossKv', short: 'Повыш. КВ (кросс)' },
  { key: 'spendKasko', short: 'Списание КАСКО ФЛ' },
  { key: 'spendOsagoSlider', short: 'ОСАГО пролонгация' },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowTotals = any

function fmtDateRu(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function valForKey(row: RowTotals, key: MechanicKey): number {
  return Number(row[key] ?? 0)
}

export default function StatusesTab() {
  const snap = STATUSES_SNAPSHOT
  const [regionsOpen, setRegionsOpen] = useState(false)

  const startByKey = useMemo(() => snap.mechanicStarts, [])

  return (
    <div className="space-y-6">
      <div className="ren-card ren-card__body text-sm ren-text-secondary">
        Предрасчёт локально из ваших xlsx ({snap.generatedAt}). В git только итоговые числа, без сырых выгрузок.
        Филиалы: {snap.agentFilialMapSize > 0
          ? `B2Partners (${snap.agentFilialMapSize} кешбуков)`
          : 'без разреза — карта филиалов не загружена'}
        .
      </div>

      {/* Итого как на HTML-отчёте */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)]">
          <h3 className="ren-card__title text-sm">Итого за период · {snap.periodLabel}</h3>
        </div>
        <div className="ren-card__body">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Kpi
              label="Начислено всего"
              value={fmtRub(snap.totals.accTotal)}
              sub={`ОСАГО ${fmtRub(snap.totals.accOsago)} · КАСКО ${fmtRub(snap.totals.accKasko)}`}
            />
            <Kpi label="Списано всего" value={fmtRub(snap.totals.spendTotal)} highlight />
            <Kpi label="Утилизация" value={fmtPct(snap.totals.utilPct)} sub="списано ÷ начислено" />
            <Kpi
              label="Кросс скидка"
              value={fmtRub(snap.totals.spendCrossDiscount)}
              sub={`${snap.totals.crossDiscountCnt.toLocaleString('ru-RU')} полисов`}
            />
            <Kpi
              label="Кросс повыш. КВ"
              value={fmtRub(snap.totals.spendCrossKv)}
              sub={`${snap.totals.crossKvCnt.toLocaleString('ru-RU')} полисов`}
            />
            <Kpi
              label="КАСКО (кошелёк + скоринг)"
              value={fmtRub(snap.totals.spendKasko)}
              sub={`${snap.totals.kaskoSpendCnt} полисов`}
            />
            <Kpi
              label="ОСАГО пролонгация (ползунок)"
              value={fmtRub(snap.totals.spendOsagoSlider)}
              sub={`${snap.totals.osagoSliderCnt.toLocaleString('ru-RU')} в окне дат`}
            />
          </div>
          <p className="text-xs ren-text-secondary mt-4">
            Строк в срезе (все статусы): ОСАГО {snap.meta.rowsOsagoAllStatuses.toLocaleString('ru-RU')},
            КАСКО {snap.meta.rowsKaskoAllStatuses.toLocaleString('ru-RU')}.
            Ползунок в файле: {snap.meta.sliderDataRange}. {snap.meta.osago2025Note}.
          </p>
        </div>
      </div>

      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)]">
          <h3 className="ren-card__title text-sm">Механики начисления и списания и даты запуска</h3>
        </div>
        <div className="ren-card__body">
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
                  <td className="py-1.5 text-right tabular-nums font-medium">
                    {fmtDateRu(startByKey[key as keyof typeof startByKey])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <MetricsTable title="Итого без разбивки по регионам" rows={[{ region: 'Вся сеть', ...snap.totals }]} />

      <MetricsTable
        title="Топ-3: Москва, Санкт-Петербург, Регионы"
        rows={snap.top3 as unknown as RowTotals[]}
        onToggleRegions={snap.top3.some(r => r.rollup === 'regions') ? () => setRegionsOpen(o => !o) : undefined}
        regionsOpen={regionsOpen}
      />

      {regionsOpen &&
        (snap.top3 as unknown as RowTotals[])
          .filter(r => r.rollup === 'regions' && r.children?.length)
          .flatMap(r => r.children as RowTotals[])
          .map(r => <MetricsTable key={String(r.region)} title="" rows={[r]} compact />)}

      <div className="ren-card">
        <div className="ren-card__header">
          <h3 className="ren-card__title text-sm">Методология</h3>
        </div>
        <div className="ren-card__body text-xs ren-text-secondary space-y-2">
          <p>Единица — рублёвый эквивалент рен-бонусов. Исключены PolicyAnnulled, PolicyTerminated; Seller / Продавец (не субучётки).</p>
          <p>Субагенты схлопнуты в HeadPartnerCB. Окно отчёта: {snap.periodLabel}.</p>
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
    <div className="ren-kpi border border-[var(--stroke-divider)] rounded-lg p-3">
      <p className="ren-kpi__label text-[10px] uppercase tracking-wide">{label}</p>
      <p className={`ren-kpi__value text-lg ${highlight ? 'ren-text-brand' : ''}`}>{value}</p>
      {sub && <p className="text-[10px] ren-text-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

function MetricsTable({
  title,
  rows,
  compact,
  onToggleRegions,
  regionsOpen,
}: {
  title: string
  rows: RowTotals[]
  compact?: boolean
  onToggleRegions?: () => void
  regionsOpen?: boolean
}) {
  return (
    <div className={`ren-card ${compact ? 'ml-4 border-l-2 border-[var(--stroke-divider)]' : ''}`}>
      {title ? (
        <div className="ren-card__header border-b border-[var(--stroke-divider)]">
          <h3 className="ren-card__title text-sm">{title}</h3>
        </div>
      ) : null}
      <div className="ren-card__body overflow-auto">
        <table className="ren-table w-full text-xs">
          <thead>
            <tr>
              <th className="text-left">Срез</th>
              {COL_KEYS.map(c => (
                <th key={c.key} className="text-right whitespace-nowrap">{c.short}</th>
              ))}
              <th className="text-right">Начисл. всего</th>
              <th className="text-right">Списано</th>
              <th className="text-right">Утилизация</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={String(row.region)}>
                <td className="font-medium">
                  {row.rollup === 'regions' && onToggleRegions ? (
                    <button type="button" onClick={onToggleRegions} className="ren-link text-left">
                      {regionsOpen ? '▾' : '▸'} {String(row.region)}
                    </button>
                  ) : (
                    String(row.region)
                  )}
                </td>
                {COL_KEYS.map(c => (
                  <td key={c.key} className="text-right tabular-nums">
                    {fmtRub(valForKey(row, c.key))}
                  </td>
                ))}
                <td className="text-right tabular-nums font-semibold">{fmtRub(Number(row.accTotal))}</td>
                <td className="text-right tabular-nums font-semibold ren-text-brand">
                  {fmtRub(Number(row.spendTotal))}
                </td>
                <td className="text-right tabular-nums">{fmtPct(row.utilPct as number | null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}