import { useMemo } from 'react'
import { STATUSES_SNAPSHOT } from '../../data/statusesSnapshot'
import { fmtRub, type MechanicKey } from '../../utils/loyaltyBalances'
import AvgBonusMetricsCard, { type AvgBonusSnapshot } from '../AvgBonusMetricsCard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowTotals = any
const fmtN = (n: number) => n.toLocaleString('ru-RU')

function fmtDateRu(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Строки метрик: подпись + ключи в объекте среза */
type MetricRowDef = {
  id: string
  label: string
  amountKey: string
  emphasis?: boolean
  isPct?: boolean
}

const METRIC_ROWS: MetricRowDef[] = [
  { id: 'accOsago', label: 'Начисление ОСАГО ФЛ', amountKey: 'accOsago' },
  { id: 'accKasko', label: 'Начисление КАСКО ФЛ', amountKey: 'accKasko' },
  { id: 'accTotal', label: 'Начислено всего', amountKey: 'accTotal', emphasis: true },
  { id: 'sd', label: 'Списание · кросс скидка (бесполис.)', amountKey: 'spendCrossDiscount' },
  { id: 'skv', label: 'Списание · кросс повыш. КВ', amountKey: 'spendCrossKv' },
  { id: 'ska', label: 'Списание КАСКО ФЛ', amountKey: 'spendKasko' },
  { id: 'sos', label: 'Списание ОСАГО пролонгация', amountKey: 'spendOsagoSlider' },
  { id: 'st', label: 'Списано всего', amountKey: 'spendTotal', emphasis: true },
  { id: 'util', label: 'Утилизация', amountKey: 'utilPct', isPct: true },
]

const SPEND_ROW_IDS = new Set(['sd', 'skv', 'ska', 'sos', 'st'])

/** Проценты на вкладке — только целые числа */
function fmtPctWhole(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${Math.round(v)}%`
}

function cellAmount(row: RowTotals, key: string, isPct?: boolean): string {
  if (isPct) return fmtPctWhole(row[key] as number | null)
  return fmtRub(Number(row[key] ?? 0))
}

function metricSharePct(row: RowTotals, m: MetricRowDef): number | null {
  if (m.isPct) return row.utilPct as number | null
  if (m.id === 'accTotal' || m.id === 'st') return 100
  const baseKey = SPEND_ROW_IDS.has(m.id) ? 'spendTotal' : 'accTotal'
  const base = Number(row[baseKey] ?? 0)
  if (base <= 0) return null
  return (Number(row[m.amountKey] ?? 0) / base) * 100
}

type MechanicSpendRow = {
  partners: number
  pctOfAccrualBase: number | null
  pctOfSpenders: number | null
}

type PartnerPeriodSlice = {
  region?: string
  periodLabel: string
  accrualPartners: number
  issuedPartners?: number
  activePartners?: number
  accrualSharePct: number | null
  spendPartners: number
  accrualBaseForSpend: number
  spendSharePct: number | null
  spendByMechanic?: {
    cross: MechanicSpendRow
    kasko: MechanicSpendRow
    osagoSlider: MechanicSpendRow
    noteMutual?: string
  }
}

type MechanicNthItem = {
  events: number
  baseIssuedOsago?: number
  baseIssuedKasko?: number
  everyNthClient: number | null
}

type SpendNthRegionRow = {
  region: string
  mechanics: Record<'cross' | 'osagoSlider' | 'kaskoFl', MechanicNthItem>
}

const MECH_NTH_LINES: { key: 'cross' | 'osagoSlider' | 'kaskoFl'; label: string }[] = [
  { key: 'cross', label: 'Кросс-Каско бесп. (скидка / КВ)' },
  { key: 'osagoSlider', label: 'ОСАГО ФЛ пролонгация' },
  { key: 'kaskoFl', label: 'Каско ФЛ' },
]

const MECHANIC_SPEND_LINES: { key: 'cross' | 'kasko' | 'osagoSlider'; label: string }[] = [
  { key: 'cross', label: 'в т.ч. кросс (скидка СП / повыш. КВ)' },
  { key: 'kasko', label: 'в т.ч. Каско ФЛ' },
  { key: 'osagoSlider', label: 'в т.ч. ОСАГО пролонгация (ползунок)' },
]

function PartnerSliceMetricCell({
  numerator,
  denominator,
  pct,
  networkColumn,
}: {
  numerator: number
  denominator: number
  pct: number | null
  networkColumn?: boolean
}) {
  return (
    <td
      className={`text-right tabular-nums text-[11px]${networkColumn ? ' statuses-table__col-network' : ''}`}
    >
      <span className="font-medium">
        {fmtN(numerator)} <span className="ren-text-secondary">/ {fmtN(denominator)}</span>
      </span>
      <div className="text-[10px] ren-text-brand font-semibold mt-0.5">{fmtPctWhole(pct)}</div>
    </td>
  )
}

function PartnerWindowRegionTable({
  title,
  slices,
  isFirst,
}: {
  title: string
  slices: PartnerPeriodSlice[]
  isFirst?: boolean
}) {
  const periodLabel = slices[0]?.periodLabel ?? ''
  return (
    <>
      <p
        className={`text-xs font-semibold ren-text-brand px-3 ${
          isFirst ? 'pt-2' : 'pt-3 border-t border-[var(--stroke-divider)]'
        }`}
      >
        {title}{' '}
        <span className="font-normal ren-text-secondary">({periodLabel})</span>
      </p>
      <table className="statuses-table statuses-table--slice w-full">
        <thead>
          <tr>
            <th className="text-left">Показатель</th>
            {slices.map(s => (
              <th
                key={String(s.region)}
                className={`text-right text-[11px]${isNetworkSlice(s.region) ? ' statuses-table__col-network' : ''}`}
              >
                {String(s.region ?? '—')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-left">
              Партнёров с начислением РБ (&gt;0 раз)
              <span className="block text-[10px] ren-text-secondary font-normal">
                оформивших ОСАГО и/или Каско ФЛ
              </span>
            </td>
            {slices.map(s => {
              const issued = s.issuedPartners ?? s.activePartners ?? 0
              return (
                <PartnerSliceMetricCell
                  key={String(s.region)}
                  numerator={s.accrualPartners}
                  denominator={issued}
                  pct={s.accrualSharePct}
                  networkColumn={isNetworkSlice(s.region)}
                />
              )
            })}
          </tr>
          <tr>
            <td className="text-left">
              Партнёров со списанием (&gt;0 раз)
              <span className="block text-[10px] ren-text-secondary font-normal">с накоплением</span>
            </td>
            {slices.map(s => (
              <PartnerSliceMetricCell
                key={String(s.region)}
                numerator={s.spendPartners}
                denominator={s.accrualBaseForSpend}
                pct={s.spendSharePct}
                networkColumn={isNetworkSlice(s.region)}
              />
            ))}
          </tr>
          {MECHANIC_SPEND_LINES.map(({ key, label }) => (
            <tr key={key}>
              <td className="text-left pl-3 text-[11px] ren-text-secondary">{label}</td>
              {slices.map(s => {
                const row = s.spendByMechanic?.[key]
                if (!row) {
                  return (
                    <td key={String(s.region)} className="text-right text-gray-300">
                      —
                    </td>
                  )
                }
                return (
                  <PartnerSliceMetricCell
                    key={String(s.region)}
                    numerator={row.partners}
                    denominator={s.accrualBaseForSpend}
                    pct={row.pctOfAccrualBase}
                    networkColumn={isNetworkSlice(s.region)}
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function SpendNthMechanicTable({
  title,
  rows,
  isFirst,
}: {
  title: string
  rows: SpendNthRegionRow[]
  isFirst?: boolean
}) {
  return (
    <>
      <p
        className={`text-xs font-semibold ren-text-brand px-3 ${
          isFirst ? 'pt-3' : 'pt-3 border-t border-[var(--stroke-divider)]'
        }`}
      >
        {title}
      </p>
      <table className="statuses-table statuses-table--slice w-full">
        <thead>
          <tr>
            <th className="text-left">Механика списания</th>
            {rows.map(r => (
              <th
                key={r.region}
                className={`text-right text-[11px]${isNetworkSlice(r.region) ? ' statuses-table__col-network' : ''}`}
              >
                {r.region}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MECH_NTH_LINES.map(line => (
            <tr key={line.key}>
              <td className="text-left text-[11px]">{line.label}</td>
              {rows.map(r => {
                const m = r.mechanics[line.key]
                const base = m.baseIssuedKasko ?? m.baseIssuedOsago ?? 0
                return (
                  <td
                    key={r.region}
                    className={`text-right tabular-nums text-[11px]${
                      isNetworkSlice(r.region) ? ' statuses-table__col-network' : ''
                    }`}
                  >
                    <span className="font-semibold ren-text-brand">
                      {m.everyNthClient != null ? `${m.everyNthClient}-му` : '—'}
                    </span>
                    <div className="text-[10px] ren-text-secondary font-normal mt-0.5">
                      {fmtN(m.events)} / {fmtN(base)}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function partnerTop3Slices(
  snap: typeof STATUSES_SNAPSHOT,
  key: 'fullPeriodByTop3' | 'rolling12MonthsByTop3' | 'rolling3MonthsByTop3',
  fallback: PartnerPeriodSlice,
): PartnerPeriodSlice[] {
  const rows = (snap.partnerMetrics as Record<string, unknown>)[key] as PartnerPeriodSlice[] | undefined
  if (rows?.length) return rows
  return [{ region: 'Вся сеть', ...fallback }]
}

function isNetworkSlice(region: unknown): boolean {
  return String(region) === 'Вся сеть'
}

function PeriodMetricCell({
  row,
  m,
  networkColumn,
}: {
  row: RowTotals
  m: MetricRowDef
  networkColumn?: boolean
}) {
  const share = metricSharePct(row, m)
  return (
    <td
      className={`text-right tabular-nums${networkColumn ? ' statuses-table__col-network' : ''}`}
    >
      <span className={m.emphasis ? 'font-semibold ren-text-brand' : 'font-medium'}>
        {cellAmount(row, m.amountKey, m.isPct)}
      </span>
      {!m.isPct ? (
        <div className="text-[10px] ren-text-secondary font-normal mt-0.5">{fmtPctWhole(share)}</div>
      ) : null}
    </td>
  )
}

export default function StatusesTab() {
  const snap = STATUSES_SNAPSHOT

  const startByKey = useMemo(() => snap.mechanicStarts, [])
  const totalRow = useMemo(() => ({ region: 'Вся сеть', ...snap.totals }), [snap.totals])
  const sliceRows = snap.top3 as unknown as RowTotals[]
  const periodSlices = useMemo(
    () => [totalRow, ...sliceRows] as RowTotals[],
    [totalRow, sliceRows],
  )

  const spendProductRows = useMemo(
    () =>
      [
        {
          label: 'ОСАГО пролонгация (ползунок)',
          amount: snap.spendByProduct.osagoProlongation,
          startKey: 'spendOsagoSlider' as MechanicKey,
        },
        {
          label: 'Каско ФЛ',
          amount: snap.spendByProduct.kaskoWalletScoring,
          startKey: 'spendKasko' as MechanicKey,
        },
        {
          label: 'Кросс · скидка СП (бесполисные)',
          amount: snap.spendByProduct.crossBespolisDiscount,
          startKey: 'spendCrossDiscount' as MechanicKey,
        },
        {
          label: 'Кросс · повыш. КВ (бесполисные)',
          amount: snap.spendByProduct.crossBespolisKv,
          startKey: 'spendCrossKv' as MechanicKey,
        },
        { label: 'Обучение', amount: snap.spendByProduct.training, startKey: null },
      ] as const,
    [snap.spendByProduct],
  )

  const spendNth = (
    snap as unknown as {
      spendNthByMechanic?: {
        fullPeriodByTop3: SpendNthRegionRow[]
        rolling12MonthsByTop3?: SpendNthRegionRow[]
        rolling3MonthsByTop3: SpendNthRegionRow[]
        periodFull?: string
        periodRolling12?: string
        periodRolling3?: string
        noteSlider3m?: string
      }
    }
  ).spendNthByMechanic

  return (
    <div className="space-y-5 max-w-full">
      <p className="text-sm ren-text-secondary">
        Предрасчёт из xlsx ({snap.generatedAt}). Филиалы: B2Partners — {snap.agentFilialMapSize.toLocaleString('ru-RU')} кешбуков.
      </p>

      {/* 1. Итого за период — одна таблица вместо плиток */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
          <h3 className="ren-card__title text-sm">За всё время ({snap.periodLabel})</h3>
        </div>
        <div className="ren-card__body p-0">
          <table className="statuses-table statuses-table--slice w-full">
            <thead>
              <tr>
                <th className="text-left">Показатель</th>
                {periodSlices.map(s => {
                  const net = isNetworkSlice(s.region)
                  return (
                    <th
                      key={String(s.region)}
                      className={`text-right text-[11px]${net ? ' statuses-table__col-network' : ''}`}
                    >
                      {String(s.region)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(m => (
                <tr key={m.id} className={m.emphasis ? 'statuses-table__row--emphasis' : ''}>
                  <td className="text-left">{m.label}</td>
                  {periodSlices.map(s => (
                    <PeriodMetricCell
                      key={String(s.region)}
                      row={s}
                      m={m}
                      networkColumn={isNetworkSlice(s.region)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] ren-text-secondary px-3 py-2 border-t border-[var(--stroke-divider)]">
            Строки в выгрузке: ОСАГО {fmtN(snap.meta.rowsOsagoAllStatuses)}, КАСКО {fmtN(snap.meta.rowsKaskoAllStatuses)}.
            Ползунок: {snap.meta.sliderDataRange}. {snap.meta.osago2025Note}
          </p>
        </div>
      </div>

      {/* Спискание по продуктам (₽) */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
          <h3 className="ren-card__title text-sm">Потрачено РБ по продуктам · {snap.periodLabel}</h3>
        </div>
        <div className="ren-card__body p-0">
          <table className="statuses-table w-full">
            <thead>
              <tr>
                <th className="text-left">Продукт / механика</th>
                <th className="text-right w-28">Дата запуска</th>
                <th className="text-right w-36">Потрачено всего, ₽</th>
              </tr>
            </thead>
            <tbody>
              {spendProductRows.map(row => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="text-right tabular-nums text-[11px]">
                    {row.startKey ? fmtDateRu(startByKey[row.startKey]) : '—'}
                  </td>
                  <td className="text-right tabular-nums font-medium">{fmtRub(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] ren-text-secondary px-3 py-2 border-t border-[var(--stroke-divider)]">
            {snap.spendByProduct.note}
          </p>
        </div>
      </div>

      {/* Партнёры — чеклист слайда */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
          <h3 className="ren-card__title text-sm">Партнёры и РБ</h3>
          <p className="text-[11px] ren-text-secondary font-normal mt-1">
            {snap.partnerMetrics.method ??
              'Начисление: ≥1 РБ по ОСАГО и/или Каско ФЛ / оформили ОСАГО и/или Каско. Списание: ≥1 по любой механике / с накоплением.'}{' '}
            Кешбук HeadPartnerCB, без Seller / Продавец.
          </p>
        </div>
        <div className="ren-card__body p-0 space-y-0">
          <PartnerWindowRegionTable
            title="За всё время"
            isFirst
            slices={partnerTop3Slices(
              snap,
              'fullPeriodByTop3',
              snap.partnerMetrics.fullPeriod as PartnerPeriodSlice,
            )}
          />
          <PartnerWindowRegionTable
            title="Скользящий год"
            slices={partnerTop3Slices(
              snap,
              'rolling12MonthsByTop3',
              snap.partnerMetrics.rolling12Months as PartnerPeriodSlice,
            )}
          />
          <PartnerWindowRegionTable
            title="Скользящие 3 мес"
            slices={partnerTop3Slices(
              snap,
              'rolling3MonthsByTop3',
              snap.partnerMetrics.rolling3Months as PartnerPeriodSlice,
            )}
          />
          {snap.partnerMetrics.fullPeriod.spendByMechanic?.noteMutual ? (
            <p className="text-[10px] ren-text-secondary px-3 py-2 border-t border-[var(--stroke-divider)]">
              {snap.partnerMetrics.fullPeriod.spendByMechanic.noteMutual}
            </p>
          ) : null}
        </div>
      </div>

      {/* Как партнёры используют бонусы */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
          <h3 className="ren-card__title text-sm">Как партнёры используют бонусы · {snap.periodLabel}</h3>
        </div>
        <div className="ren-card__body p-0">
          {spendNth?.fullPeriodByTop3?.length ? (
            <>
              <SpendNthMechanicTable
                isFirst
                title={`Каждому N-му клиенту · за всё время (${spendNth.periodFull ?? snap.periodLabel})`}
                rows={spendNth.fullPeriodByTop3}
              />
              {spendNth.rolling12MonthsByTop3?.length ? (
                <SpendNthMechanicTable
                  title={`Каждому N-му клиенту · скользящий год (${spendNth.periodRolling12 ?? ''})`}
                  rows={spendNth.rolling12MonthsByTop3}
                />
              ) : null}
              <p className="text-[10px] ren-text-secondary px-3 pt-1">
                Дробь: списаний по механике / оформленных полисов (ОСАГО для кросса и ползунка, Каско ФЛ для
                кошелька).
              </p>
              <SpendNthMechanicTable
                title={`Каждому N-му клиенту · скользящие 3 мес (${spendNth.periodRolling3 ?? ''})`}
                rows={spendNth.rolling3MonthsByTop3 ?? []}
              />
              {spendNth.noteSlider3m ? (
                <p className="text-[10px] ren-text-secondary px-3 py-2">{spendNth.noteSlider3m}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {(snap as unknown as { avgBonus?: AvgBonusSnapshot }).avgBonus ? (
        <AvgBonusMetricsCard data={(snap as unknown as { avgBonus: AvgBonusSnapshot }).avgBonus} />
      ) : null}

    </div>
  )
}