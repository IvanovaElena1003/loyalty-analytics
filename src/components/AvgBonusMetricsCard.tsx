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

export default function AvgBonusMetricsCard({ data }: { data: AvgBonusSnapshot }) {
  const n = Math.max(data.monthCount, 1)

  const tableRows = [
    {
      label: `Баланс кошелька · все · ${fmtN(data.allPartnersCount)} партнёров, с нулями`,
      total: data.allPartnersCount > 0 ? fmtRbInt(data.balanceMeanAll) : '—',
      avg: '—',
      snapshot: true,
    },
    {
      label: `Баланс · остаток > 0 · ${fmtN(data.positiveBalanceCount)} партнёров`,
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
          Баланс — снимок по выгрузке; начисления и списания — ср. арифметическое за {n} мес. с полисами
        </p>
      </div>
      <div className="ren-card__body p-0">
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
                <td className="text-left text-[11px]">{r.label}</td>
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