import type { AggregateResult, MonthMetrics } from '../../types'
import CrossChart from '../charts/CrossChart'
import CrossCompositionChart from '../charts/CrossCompositionChart'

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
      <td className="px-3 py-2 text-right">{fmt(m.cross_total)}</td>
      <td className="px-3 py-2 text-right">{fmt(m.cross_no_bonus)}</td>
      <td className="px-3 py-2 text-right">{fmt(m.cross_with_bonus)}</td>
      <td className="px-3 py-2 text-right text-blue-600">{fmtPct(m.conv_cross)}</td>
      <td className="px-3 py-2 text-right text-gray-500">{fmtPct(m.conv_cross_nb)}</td>
      <td className="px-3 py-2 text-right text-amber-600">{fmtPct(m.conv_cross_wb)}</td>
      <td className="px-3 py-2 text-right text-gray-400">{fmt(m.cross_base)}</td>
      <td className="px-3 py-2 text-right text-purple-500">{fmt(m.cross_discount)}</td>
      <td className="px-3 py-2 text-right text-amber-500">{fmt(m.cross_incr_kv)}</td>
    </tr>
  )
}

export default function CrossTab({ result }: Props) {
  const { months, totals } = result
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <StatCard
          title="Кросс всего"
          value={fmt(totals.cross_total)}
          sub={`${fmtPct(totals.conv_cross)} от оформл.`}
        />
        <StatCard
          title="С бонусами"
          value={fmt(totals.cross_with_bonus)}
          sub={`Конв. ${fmtPct(totals.conv_cross_wb)}`}
        />
        <StatCard
          title="Базовый"
          value={fmt(totals.cross_base)}
        />
        <StatCard
          title="Скидка (бонусы)"
          value={fmt(totals.cross_discount)}
        />
        <StatCard
          title="Повышенное КВ"
          value={fmt(totals.cross_incr_kv)}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-4">Кросс-продажи и конверсия по месяцам</h3>
        <CrossChart months={months} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-4">Состав Кросс-Каско по месяцам</h3>
        <CrossCompositionChart months={months} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3 text-left">Месяц</th>
                <th className="px-3 py-3 text-right">Кросс</th>
                <th className="px-3 py-3 text-right">Без бон.</th>
                <th className="px-3 py-3 text-right">С бон.</th>
                <th className="px-3 py-3 text-right">Конв.</th>
                <th className="px-3 py-3 text-right">Конв. без бон.</th>
                <th className="px-3 py-3 text-right">Конв. с бон.</th>
                <th className="px-3 py-3 text-right">Базовый</th>
                <th className="px-3 py-3 text-right">Скидка</th>
                <th className="px-3 py-3 text-right">Повыш. КВ</th>
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
