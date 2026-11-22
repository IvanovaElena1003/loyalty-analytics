export type AvgBonusSnapshot = {
  monthCount: number
  balanceMeanAll: number
  balanceMeanPositive: number
  allPartnersCount: number
  positiveBalanceCount: number
  accrualTotal: number
  spendTotal: number
  spendDiscount: number
  spendKv: number
  avgAccrualPerMonth: number
  avgSpendPerMonth: number
  avgDiscountPerMonth: number
  avgKvPerMonth: number
}

const fmtN = (v: number) => Math.round(v).toLocaleString('ru-RU')
const fmtRbInt = (v: number) =>
  Number.isFinite(v) ? `${fmtN(Math.round(v))} РБ` : '—'
const fmtDec1 = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmtRbCompact = (v: number) => {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1_000_000) return `${fmtDec1(v / 1_000_000)}М`
  return fmtRbInt(v)
}
const fmtPct1 = (v: number) =>
  Number.isFinite(v)
    ? v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '—'

function AvgCard({
  title,
  value,
  sub,
  value2,
}: {
  title: string
  value: string
  sub?: string
  value2?: string
}) {
  return (
    <div className="ren-card ren-card__body flex flex-col gap-0.5">
      <p className="text-xs ren-text-brand font-medium uppercase tracking-wide leading-tight">{title}</p>
      <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5 tabular-nums">{value}</p>
      {value2 && <p className="text-sm font-semibold ren-text-secondary">{value2}</p>}
      {sub && <p className="text-xs ren-text-secondary mt-0.5 leading-snug">{sub}</p>}
    </div>
  )
}

export default function AvgBonusMetricsCard({ data }: { data: AvgBonusSnapshot }) {
  const n = Math.max(data.monthCount, 1)
  const spendShareOfAccrual =
    data.avgAccrualPerMonth > 0 ? (data.avgSpendPerMonth / data.avgAccrualPerMonth) * 100 : 0

  const tableRows = [
    {
      label: 'Баланс кошелька · все',
      total: data.allPartnersCount > 0 ? fmtRbInt(data.balanceMeanAll) : '—',
      avg: '—',
      snapshot: true,
    },
    {
      label: 'Баланс · остаток > 0',
      total: data.positiveBalanceCount > 0 ? fmtRbInt(data.balanceMeanPositive) : '—',
      avg: '—',
      snapshot: true,
    },
    {
      label: 'Начисления',
      total: fmtRbCompact(data.accrualTotal),
      avg: fmtRbCompact(data.avgAccrualPerMonth),
      snapshot: false,
    },
    {
      label: 'Списания',
      total: fmtRbCompact(data.spendTotal),
      avg: fmtRbCompact(data.avgSpendPerMonth),
      snapshot: false,
    },
  ]

  return (
    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
        <h3 className="ren-card__title text-sm uppercase tracking-wide">Средние показатели Рен-бонусов</h3>
        <p className="ren-card__subtitle text-[11px]">
          Среднее арифметическое по {n} месяцам наблюдений
        </p>
      </div>
      <div className="p-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AvgCard
          title="Ср. баланс в кошельке"
          value={fmtRbInt(data.balanceMeanAll)}
          sub={`${fmtN(data.allPartnersCount)} партнёров · с нулями`}
        />
        <AvgCard
          title="Ср. баланс в кошельке"
          value={fmtRbInt(data.balanceMeanPositive)}
          sub={`${fmtN(data.positiveBalanceCount)} · остаток > 0`}
        />
        <AvgCard
          title="Ср. начислений / мес."
          value={fmtRbCompact(data.avgAccrualPerMonth)}
          sub="за месяц"
        />
        <AvgCard
          title="Ср. списаний итого / мес."
          value={fmtRbCompact(data.avgSpendPerMonth)}
          value2={`${fmtPct1(spendShareOfAccrual)}% от начислений`}
        />
      </div>
      <div className="border-t border-[var(--stroke-divider)]">
        <table className="statuses-table w-full">
          <thead>
            <tr>
              <th className="text-left">Показатель</th>
              <th className="text-right">Итого</th>
              <th className="text-right">Ср. / мес.</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(r => (
              <tr key={r.label}>
                <td className="text-left">{r.label}</td>
                <td className="text-right tabular-nums font-medium">{r.total}</td>
                <td
                  className={`text-right tabular-nums ${
                    r.snapshot ? 'ren-text-secondary' : 'ren-text-brand font-semibold'
                  }`}
                >
                  {r.avg}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}