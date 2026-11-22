export type AvgBonusSnapshot = {
  balanceMeanAll: number
  balanceMeanPositive: number
  allPartnersCount: number
  positiveBalanceCount: number
  monthCount?: number
  accrualTotal?: number
  spendTotal?: number
  spendDiscount?: number
  spendKv?: number
  avgAccrualPerMonth?: number
  avgSpendPerMonth?: number
  avgDiscountPerMonth?: number
  avgKvPerMonth?: number
  balanceNote?: string
}

const fmtN = (v: number) => Math.round(v).toLocaleString('ru-RU')
const fmtRbInt = (v: number) =>
  Number.isFinite(v) ? `${fmtN(Math.round(v))} РБ` : '—'

export default function AvgBonusMetricsCard({ data }: { data: AvgBonusSnapshot }) {
  const rows = [
    {
      label: `Все партнёры · ${fmtN(data.allPartnersCount)} кешбуков (с нулями)`,
      value: data.allPartnersCount > 0 ? fmtRbInt(data.balanceMeanAll) : '—',
    },
    {
      label: `Остаток > 0 · ${fmtN(data.positiveBalanceCount)} кешбуков`,
      value: data.positiveBalanceCount > 0 ? fmtRbInt(data.balanceMeanPositive) : '—',
    },
  ]

  return (
    <div className="ren-card">
      <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
        <h3 className="ren-card__title text-sm">Средний остаток Рен-бонусов · на текущий момент</h3>
      </div>
      <div className="ren-card__body p-0">
        <table className="statuses-table w-full">
          <thead>
            <tr>
              <th className="text-left">База</th>
              <th className="text-right w-36">Ср. остаток</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label}>
                <td className="text-left text-[11px]">{r.label}</td>
                <td className="text-right tabular-nums font-semibold ren-text-brand">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}