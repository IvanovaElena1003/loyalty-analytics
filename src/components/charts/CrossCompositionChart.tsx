import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts'
import type { MonthMetrics } from '../../types'

interface Props { months: MonthMetrics[] }

// Рендер подписи % внутри сегмента (скрываем при малой высоте)
function makeLabelRenderer(color: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function LabelRenderer(props: any) {
    const { x, y, width, height, value } = props as {
      x: number; y: number; width: number; height: number; value: number
    }
    if (height < 18 || value == null || value === 0) return null
    return (
      <text
        x={x + width / 2}
        y={y + height / 2}
        dy={4}
        textAnchor="middle"
        fill={color}
        fontSize={11}
        fontWeight={600}
      >
        {value}%
      </text>
    )
  }
}

const labelBase    = makeLabelRenderer('#4b5563')   // серый — тёмный текст
const labelDisc    = makeLabelRenderer('#ffffff')   // фиолетовый — белый текст
const labelKV      = makeLabelRenderer('#ffffff')   // янтарный — белый текст

export default function CrossCompositionChart({ months }: Props) {
  const data = months.map(m => {
    const total = (m.cross_base + m.cross_discount + m.cross_incr_kv) || 1
    return {
      label: m.label,
      'Базовый': m.cross_base,
      'Скидка (бонусы)': m.cross_discount,
      'Повышенное КВ': m.cross_incr_kv,
      'base%': Math.round(m.cross_base / total * 100),
      'disc%': Math.round(m.cross_discount / total * 100),
      'kv%':   Math.round(m.cross_incr_kv  / total * 100),
    }
  })

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any, item: any) => {
            const pctKey = name === 'Базовый' ? 'base%' : name === 'Скидка (бонусы)' ? 'disc%' : 'kv%'
            const p = item?.payload?.[pctKey] ?? ''
            return [`${Number(value).toLocaleString('ru-RU')} (${p}%)`, name]
          }}
        />
        <Legend />
        <Bar dataKey="Базовый" stackId="a" fill="#d1d5db">
          <LabelList dataKey="base%" content={labelBase} />
        </Bar>
        <Bar dataKey="Скидка (бонусы)" stackId="a" fill="#a78bfa">
          <LabelList dataKey="disc%" content={labelDisc} />
        </Bar>
        <Bar dataKey="Повышенное КВ" stackId="a" fill="#f59e0b">
          <LabelList dataKey="kv%" content={labelKV} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
