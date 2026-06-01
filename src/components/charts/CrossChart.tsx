import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import type { MonthMetrics } from '../../types'

interface Props { months: MonthMetrics[] }

export default function CrossChart({ months }: Props) {
  const data = months.map(m => ({
    label: m.label,
    'Без бонусов': m.cross_no_bonus,
    'С бонусами': m.cross_with_bonus,
    'Конв. общая': m.conv_cross,
    'Конв. без бонусов': m.conv_cross_nb,
    'Конв. с бонусами': m.conv_cross_wb,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} domain={[0, 30]} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(val, name) =>
          ['Конв. общая', 'Конв. без бонусов', 'Конв. с бонусами'].includes(String(name))
            ? `${Number(val).toFixed(1)}%` : val
        } />
        <Legend />
        <Bar yAxisId="left" dataKey="Без бонусов" stackId="a" fill="#fca5a5" />
        <Bar yAxisId="left" dataKey="С бонусами" stackId="a" fill="#ef4444" />
        <Line yAxisId="right" type="monotone" dataKey="Конв. общая" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 4 }} />
        <Line yAxisId="right" type="monotone" dataKey="Конв. без бонусов" stroke="#6b7280" strokeWidth={2} dot={{ r: 4 }} strokeDasharray="4 4" />
        <Line yAxisId="right" type="monotone" dataKey="Конв. с бонусами" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} strokeDasharray="4 4" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
