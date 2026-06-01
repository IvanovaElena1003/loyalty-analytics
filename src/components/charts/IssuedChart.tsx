import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import type { MonthMetrics } from '../../types'

interface Props { months: MonthMetrics[] }

export default function IssuedChart({ months }: Props) {
  const data = months.map(m => ({
    label: m.label,
    'Без бонусов': m.issued_no_bonus,
    'С бонусами': m.issued_with_bonus,
    'Конверсия': m.conversion,
    '% оформл. с бонусами': m.pct_issued_bonus,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(val, name) =>
          name === 'Конверсия' || name === '% оформл. с бонусами'
            ? `${Number(val).toFixed(1)}%` : val
        } />
        <Legend />
        <Bar yAxisId="left" dataKey="Без бонусов" stackId="a" fill="#6ee7b7" />
        <Bar yAxisId="left" dataKey="С бонусами" stackId="a" fill="#10b981" />
        <Line yAxisId="right" type="monotone" dataKey="Конверсия" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
        <Line yAxisId="right" type="monotone" dataKey="% оформл. с бонусами" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} strokeDasharray="5 5" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
