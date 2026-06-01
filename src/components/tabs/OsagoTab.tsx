import type { AggregateResult, MonthMetrics } from '../../types'
import QuotesChart from '../charts/QuotesChart'
import IssuedChart from '../charts/IssuedChart'

interface Props { result: AggregateResult }

function fmt(n: number) { return n.toLocaleString('ru-RU') }
function fmtPct(n: number | null) { return n == null ? '—' : `${n.toFixed(1)}%` }

function StatCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{title}</p>
      <p className="text-3xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

function TableRow({ m, isTotal }: { m: MonthMetrics; isTotal?: boolean }) {
  const cls = isTotal ? 'font-semibold bg-gray-50' : 'hover:bg-gray-50'
  return (
    <tr className={`text-sm border-t border-gray-100 ${cls}`}>
      <td className="px-3 py-2 text-gray-700">{m.label}</td>
      <td className="px-3 py-2 text-right">{fmt(m.total_quotes)}</td>
      <td className="px-3 py-2 text-right">{fmt(m.quotes_no_bonus)}</td>
      <td className="px-3 py-2 text-right">{fmt(m.quotes_with_bonus)}</td>
      <td className="px-3 py-2 text-right text-amber-600">{fmtPct(m.pct_quotes_bonus)}</td>
      <td className="px-3 py-2 text-right">{fmt(m.issued_total)}</td>
      <td className="px-3 py-2 text-right">{fmt(m.issued_no_bonus)}</td>
      <td className="px-3 py-2 text-right">{fmt(m.issued_with_bonus)}</td>
      <td className="px-3 py-2 text-right text-red-500">{fmtPct(m.conversion)}</td>
      <td className="px-3 py-2 text-right text-purple-600">{fmtPct(m.pct_issued_bonus)}</td>
    </tr>
  )
}

export default function OsagoTab({ result }: Props) {
  const { months, totals } = result
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          title="Котировок всего"
          value={fmt(totals.total_quotes)}
        />
        <StatCard
          title="Котировок с бонусами"
          value={fmtPct(totals.pct_quotes_bonus)}
          sub={`${fmt(totals.quotes_with_bonus)} из ${fmt(totals.total_quotes)}`}
        />
        <StatCard
          title="Оформлено полисов"
          value={fmt(totals.issued_total)}
          sub={`Конверсия ${fmtPct(totals.conversion)}`}
        />
        <StatCard
          title="Оформлено с бонусами"
          value={fmtPct(totals.pct_issued_bonus)}
          sub={`${fmt(totals.issued_with_bonus)} из ${fmt(totals.issued_total)}`}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-4">Котировки по месяцам</h3>
        <QuotesChart months={months} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-4">Оформление по месяцам</h3>
        <IssuedChart months={months} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3 text-left">Месяц</th>
                <th className="px-3 py-3 text-right">Котировок</th>
                <th className="px-3 py-3 text-right">Без бонусов</th>
                <th className="px-3 py-3 text-right">С бонусами</th>
                <th className="px-3 py-3 text-right">% с бон.</th>
                <th className="px-3 py-3 text-right">Оформлено</th>
                <th className="px-3 py-3 text-right">Офор. без бон.</th>
                <th className="px-3 py-3 text-right">Офор. с бон.</th>
                <th className="px-3 py-3 text-right">Конверсия</th>
                <th className="px-3 py-3 text-right">% офор. с бон.</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => <TableRow key={m.sortKey} m={m} />)}
              <TableRow m={totals} isTotal />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
