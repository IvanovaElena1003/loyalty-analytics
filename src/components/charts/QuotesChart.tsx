import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import type { MonthMetrics } from '../../types'

interface Props { months: MonthMetrics[] }

export default function QuotesChart({ months }: Props) {
  const data = months.map(m => ({
    label: m.label,
    'Без бонусов': m.quotes_no_bonus,
    'С бонусами': m.quotes_with_bonus,
    '% с бонусами': m.pct_quotes_bonus,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(val, name) => name === '% с бонусами' ? `${Number(val).toFixed(1)}%` : val} />
        <Legend />
        <Bar yAxisId="left" dataKey="Без бонусов" stackId="a" fill="#93c5fd" />
        <Bar yAxisId="left" dataKey="С бонусами" stackId="a" fill="#3b82f6" />
        <Line yAxisId="right" type="monotone" dataKey="% с бонусами" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
