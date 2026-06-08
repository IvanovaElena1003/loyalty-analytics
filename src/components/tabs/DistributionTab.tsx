import type { AggregateResult, DistributionData, DistributionBucket } from '../../types'

interface Props { result: AggregateResult }

// ─── Расчёт распределения ────────────────────────────────────────────────────
function computeDist(values: number[]): DistributionData {
  if (values.length === 0) return { count: 0, mean: 0, std: 0, buckets: [] }

  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const std = Math.sqrt(variance)

  const bounds = [
    { label: 'range-0', from: -Infinity,      to: mean - 2 * std },
    { label: 'range-1', from: mean - 2 * std, to: mean - std },
    { label: 'range-2', from: mean - std,      to: mean },
    { label: 'range-3', from: mean,            to: mean + std },
    { label: 'range-4', from: mean + std,      to: mean + 2 * std },
    { label: 'range-5', from: mean + 2 * std,  to: Infinity },
  ]

  const buckets: DistributionBucket[] = bounds.map(b => {
    const count = values.filter(v => v > b.from && v <= b.to).length
    return { ...b, count, pct: (count / values.length) * 100 }
  })

  return { count: values.length, mean, std, buckets }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtN  = (v: number) => Math.round(v).toLocaleString('ru-RU')
const fmtF  = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
const fmtF0 = (v: number) => Math.max(0, v).toLocaleString('ru-RU', { maximumFractionDigits: 1 })

// Человекочитаемое название диапазона с фактическими значениями
const RANGE_NAMES = [
  'Значительно ниже среднего',
  'Ниже среднего',
  'Немного ниже среднего',
  'Немного выше среднего',
  'Выше среднего',
  'Значительно выше среднего',
]

function humanLabel(b: DistributionBucket, i: number, unit: string): string {
  const desc = RANGE_NAMES[i] ?? ''
  if (b.from <= 0 && b.to === Infinity) return desc
  if (b.from <= 0) return `до ${fmtN(Math.floor(b.to))} ${unit}`
  if (b.to === Infinity) return `от ${fmtN(Math.ceil(Math.max(0, b.from)))} ${unit}`
  return `${fmtN(Math.ceil(Math.max(0, b.from)))} – ${fmtN(Math.floor(b.to))} ${unit}`
}

// ─── Цвета столбцов гистограммы ──────────────────────────────────────────────
const BAR_COLORS = [
  'bg-blue-200',
  'bg-blue-300',
  'bg-blue-500',
  'bg-blue-500',
  'bg-blue-300',
  'bg-blue-200',
]

// ─── Один блок распределения ─────────────────────────────────────────────────
function DistBlock({
  title,
  subtitle,
  dist,
  unit,
}: {
  title: string
  subtitle: string
  dist: DistributionData
  unit: string
}) {
  if (dist.count === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
        Нет данных для «{title}»
      </div>
    )
  }

  const maxCount = Math.max(...dist.buckets.map(b => b.count), 1)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Заголовок */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>

      {/* Параметры */}
      <div className="px-5 py-3 flex flex-wrap gap-6 border-b border-gray-100 bg-blue-50/40">
        <div>
          <span className="text-xs text-gray-500">Всего событий</span>
          <p className="text-lg font-bold text-gray-800">{fmtN(dist.count)}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Среднее значение</span>
          <p className="text-lg font-bold text-blue-700">{fmtF(dist.mean)} {unit}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Типичный разброс (±)</span>
          <p className="text-lg font-bold text-gray-700">{fmtF(dist.std)} {unit}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Нижняя граница нормы</span>
          <p className="text-lg font-bold text-gray-600">{fmtF0(dist.mean - dist.std)} {unit}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Верхняя граница нормы</span>
          <p className="text-lg font-bold text-gray-600">{fmtF(dist.mean + dist.std)} {unit}</p>
        </div>
      </div>

      {/* Мини-гистограмма */}
      <div className="px-5 py-4 flex items-end gap-2" style={{ height: '112px' }}>
        {dist.buckets.map((b, i) => {
          const barH = maxCount > 0 ? Math.round((b.count / maxCount) * 80) : 0
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-gray-500 tabular-nums">{fmtN(b.count)}</span>
              <div
                className={`w-full rounded-t-sm ${BAR_COLORS[i] ?? 'bg-blue-400'}`}
                style={{ height: `${barH}px`, minHeight: b.count > 0 ? '4px' : '0' }}
              />
            </div>
          )
        })}
      </div>

      {/* Таблица диапазонов */}
      <div className="overflow-x-auto border-t border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Диапазон {unit === 'баллов' ? 'Рен-бонусов' : 'списания'}</th>
              <th className="px-4 py-2 text-left text-gray-400 font-normal">Характеристика</th>
              <th className="px-4 py-2 text-right">Событий</th>
              <th className="px-4 py-2 text-right">% от итого</th>
              <th className="px-4 py-2 text-left w-40">Доля</th>
            </tr>
          </thead>
          <tbody>
            {dist.buckets.map((b, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  {humanLabel(b, i, unit)}
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-400">
                  {RANGE_NAMES[i]}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtN(b.count)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-blue-600 font-medium">
                  {fmtF(b.pct)}%
                </td>
                <td className="px-4 py-2.5">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${BAR_COLORS[i] ?? 'bg-blue-400'}`}
                      style={{ width: `${b.pct}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────
export default function DistributionTab({ result }: Props) {
  const { accrualValues, spendingValues } = result

  const accrualDist  = computeDist(accrualValues)
  const spendingDist = computeDist(spendingValues)

  return (
    <div className="space-y-6">

      {/* Пояснение */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>Как читать таблицы распределения.</strong>&nbsp;
        Каждое событие (полис / котировка) попадает в один из шести диапазонов — от «значительно ниже среднего»
        до «значительно выше среднего». Диапазоны строятся вокруг среднего значения с учётом типичного разброса:
        около 68% событий обычно попадает в два центральных диапазона, около 95% — в четыре из шести.
      </div>

      {/* Блок 1: Накопления */}
      <DistBlock
        title="Рен-бонусы: распределение по балансу (накопленные баллы)"
        subtitle="Учитываются оформленные полисы (State = PolicyIssued) с ненулевым балансом Рен-бонусов. Значение = LoyaltyPointsInLK."
        dist={accrualDist}
        unit="баллов"
      />

      {/* Блок 2: Списания */}
      <DistBlock
        title="Рен-бонусы: распределение по сумме списания"
        subtitle="Учитываются строки, где Кросс-Каско куплен и были списаны бонусы (скидка или повышенное КВ). Значение = суммарное списание по строке."
        dist={spendingDist}
        unit="руб."
      />

      {/* Сравнительная таблица */}
      {accrualDist.count > 0 && spendingDist.count > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <h3 className="font-semibold text-gray-700 text-sm">Сравнение: накопления vs списания</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2 text-left">Показатель</th>
                <th className="px-4 py-2 text-right">Накопления (баллы)</th>
                <th className="px-4 py-2 text-right">Списания (руб.)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Всего событий',            fmtN(accrualDist.count),                                              fmtN(spendingDist.count)],
                ['Среднее значение',         fmtF(accrualDist.mean)                     + ' баллов',               fmtF(spendingDist.mean)                    + ' руб.'],
                ['Типичный разброс (±)',      fmtF(accrualDist.std)                      + ' баллов',               fmtF(spendingDist.std)                     + ' руб.'],
                ['Нижняя граница нормы',     fmtF0(accrualDist.mean - accrualDist.std)  + ' баллов',               fmtF0(spendingDist.mean - spendingDist.std) + ' руб.'],
                ['Верхняя граница нормы',    fmtF(accrualDist.mean  + accrualDist.std)  + ' баллов',               fmtF(spendingDist.mean  + spendingDist.std) + ' руб.'],
              ].map(([label, acc, spend], i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-600">{label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-blue-700">{acc}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-amber-700">{spend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
