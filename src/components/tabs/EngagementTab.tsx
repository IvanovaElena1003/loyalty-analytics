import { useMemo } from 'react'
import type { RawRow } from '../../types'
import {
  computeSection1, computeSection2, computeSection3,
  downloadXlsx,
  type Section1Result, type Section2Result, type Section3Result,
} from '../../utils/engagement'

interface Props { rawRows: RawRow[] }

// ─── Форматирование ───────────────────────────────────────────────────────────
const fmtN  = (n: number) => Math.round(n).toLocaleString('ru-RU')
const fmtF1 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
const fmtPct = (n: number | null, d?: number) => {
  if (n == null) return '—'
  if (d != null) return d === 0 ? '—' : `${fmtF1((n / d) * 100)}%`
  return `${fmtF1(n)}%`
}
const fmtSign = (n: number, isPp = false) => {
  const s = fmtF1(Math.abs(n))
  const suffix = isPp ? ' п.п.' : ''
  return `${n >= 0 ? '+' : '−'}${s}${suffix}`
}
const deltaClass = (n: number) =>
  n > 0 ? 'text-green-600 font-semibold' : n < 0 ? 'text-red-600 font-semibold' : 'text-gray-400'

// ─── Цвет ячейки удержания ────────────────────────────────────────────────────
function retentionCls(pct: number): string {
  if (pct >= 60) return 'bg-green-100 text-green-800'
  if (pct >= 30) return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-700'
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div>
        <h2 className="text-base font-bold text-gray-800">{title}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
      </div>
    </div>
  )
}

// ─── Section 1 view ───────────────────────────────────────────────────────────
function Section1View({ data }: { data: Section1Result }) {
  const { byRole, grandTotal, grandTried, allNotTried } = data
  const grandNotTried = grandTotal - grandTried

  if (grandTotal === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
        Нет агентов с хотя бы одним оформленным полисом. Проверьте наличие поля RenId в данных.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left">Роль</th>
              <th className="px-4 py-2.5 text-right">Агентов всего</th>
              <th className="px-4 py-2.5 text-right">Попробовали баллы</th>
              <th className="px-4 py-2.5 text-right">Ещё не попробовали</th>
              <th className="px-4 py-2.5 text-right">% не попробовали</th>
            </tr>
          </thead>
          <tbody>
            {byRole.map(r => {
              const notTried = r.total - r.tried
              return (
                <tr key={r.role} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-700 font-medium">{r.role}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtN(r.total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-600">{fmtN(r.tried)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {notTried > 0 ? (
                      <button
                        onClick={() => downloadXlsx(r.notTriedAgents as unknown as Record<string, unknown>[], `not_tried_${r.role}.xlsx`)}
                        className="text-amber-600 font-semibold hover:underline inline-flex items-center gap-1"
                        title="Скачать список агентов"
                      >
                        {fmtN(notTried)}
                        <span className="text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-normal">↓ xlsx</span>
                      </button>
                    ) : <span className="text-gray-300">0</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {fmtPct(notTried, r.total)}
                  </td>
                </tr>
              )
            })}

            {/* ИТОГО */}
            <tr className="border-t-2 border-blue-200 bg-blue-50 font-semibold">
              <td className="px-4 py-2.5 text-blue-800">ИТОГО</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtN(grandTotal)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{fmtN(grandTried)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {grandNotTried > 0 ? (
                  <button
                    onClick={() => downloadXlsx(allNotTried as unknown as Record<string, unknown>[], 'not_tried_all.xlsx')}
                    className="text-amber-700 hover:underline inline-flex items-center gap-1"
                  >
                    {fmtN(grandNotTried)}
                    <span className="text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-normal">↓ xlsx</span>
                  </button>
                ) : <span className="text-gray-400">0</span>}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-blue-700">
                {fmtPct(grandNotTried, grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Section 2 view ───────────────────────────────────────────────────────────
function Section2View({ data }: { data: Section2Result }) {
  const { cohorts, maxOffset, medianByOffset } = data
  const offsets = Array.from({ length: maxOffset }, (_, i) => i)

  if (cohorts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
        Нет когорт с ≥ 5 агентами, использовавшими баллы.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b-2 border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide sticky left-0 bg-gray-50 min-w-[160px]">
                  Когорта (месяц 1-го использования)
                </th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[60px]">
                  Агентов
                </th>
                {offsets.map(mo => (
                  <th key={mo} className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[80px]">
                    M+{mo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map(c => (
                <tr key={c.cohortKey} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 sticky left-0 bg-white font-medium text-gray-700">
                    {c.cohortLabel}
                  </td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-gray-500">
                    {fmtN(c.agentCount)}
                  </td>
                  {offsets.map(mo => {
                    const val = c.retention[mo]
                    if (val == null) return (
                      <td key={mo} className="px-4 py-2.5 text-center text-gray-200 text-xs">—</td>
                    )
                    return (
                      <td key={mo} className={`px-4 py-2.5 text-center tabular-nums rounded-sm ${retentionCls(val)}`}>
                        {fmtF1(val)}%
                      </td>
                    )
                  })}
                </tr>
              ))}

              {/* Медиана по всем когортам */}
              <tr className="border-t-2 border-gray-300 bg-gray-100">
                <td className="px-4 py-2.5 sticky left-0 bg-gray-100 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Медиана по когортам
                </td>
                <td className="px-4 py-2.5 text-center text-gray-400 text-xs">—</td>
                {offsets.map(mo => {
                  const val = medianByOffset[mo]
                  if (val == null) return (
                    <td key={mo} className="px-4 py-2.5 text-center text-gray-300 text-xs">—</td>
                  )
                  return (
                    <td key={mo} className={`px-4 py-2.5 text-center tabular-nums font-semibold ${retentionCls(val)}`}>
                      {fmtF1(val)}%
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Легенда цветов */}
      <div className="flex items-center gap-4 text-xs text-gray-500 px-1">
        <span className="font-medium text-gray-600">Цвет ячейки:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-200 inline-block" /> ≥ 60% — хорошее удержание
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-yellow-200 inline-block" /> 30–59% — среднее
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-200 inline-block" /> &lt; 30% — низкое
        </span>
      </div>

      {/* Ключевые значения медианы */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map(mo => {
          const val = medianByOffset[mo]
          return (
            <div key={mo} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Медиана M+{mo}</p>
              <p className={`text-2xl font-bold mt-1 ${val == null ? 'text-gray-300' : val >= 60 ? 'text-green-600' : val >= 30 ? 'text-yellow-600' : 'text-red-600'}`}>
                {val != null ? `${fmtF1(val)}%` : '—'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">через {mo} мес. после старта</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Section 3 view ───────────────────────────────────────────────────────────
function Section3View({ data }: { data: Section3Result | null }) {
  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
        Недостаточно данных: нет агентов с ≥ 3 строками в обоих окнах (60 дней до и после первого использования).
      </div>
    )
  }

  const { beforeMed, afterMed, deltaMed, agentsIncluded, agentsTotal } = data

  const rows: {
    label: string
    before: number
    after: number
    delta: number
    isConversion: boolean
  }[] = [
    { label: 'Котировки',    before: beforeMed.quotations, after: afterMed.quotations, delta: deltaMed.quotations, isConversion: false },
    { label: 'Оформлено',    before: beforeMed.issued,     after: afterMed.issued,     delta: deltaMed.issued,     isConversion: false },
    { label: 'Конверсия',    before: beforeMed.conversion, after: afterMed.conversion, delta: deltaMed.conversion, isConversion: true  },
    { label: 'Кросс-Каско',  before: beforeMed.cross,      after: afterMed.cross,      delta: deltaMed.cross,      isConversion: false },
  ]

  return (
    <div className="space-y-4">
      {/* Мета */}
      <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-2.5 border border-gray-200">
        <span>
          Агентов в анализе: <strong>{fmtN(agentsIncluded)}</strong> из {fmtN(agentsTotal)} с первым использованием бонусов.
        </span>
        <span className="text-gray-400">
          Исключены агенты с &lt; 3 строк в одном из окон (60 дней до / после T₀).
        </span>
      </div>

      {/* Таблица */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left">Метрика</th>
              <th className="px-4 py-2.5 text-right">До (медиана, 60 дн.)</th>
              <th className="px-4 py-2.5 text-right">После (медиана, 60 дн.)</th>
              <th className="px-4 py-2.5 text-right">Изменение</th>
              <th className="px-4 py-2.5 text-right">% изменения</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const changePct = r.before !== 0
                ? (r.delta / Math.abs(r.before)) * 100
                : null

              return (
                <tr key={r.label} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-700">{r.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {r.isConversion ? `${fmtF1(r.before)}%` : fmtF1(r.before)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-800 font-medium">
                    {r.isConversion ? `${fmtF1(r.after)}%` : fmtF1(r.after)}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${deltaClass(r.delta)}`}>
                    {fmtSign(r.delta, r.isConversion)}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${changePct != null ? deltaClass(changePct) : 'text-gray-400'}`}>
                    {changePct != null ? fmtSign(changePct) + '%' : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Предупреждение */}
      <p className="text-xs text-gray-400 px-1">
        Анализ показывает корреляцию, а не причинно-следственную связь.
        Рост может быть вызван сезонностью или другими факторами.
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EngagementTab({ rawRows }: Props) {
  const s1 = useMemo(() => computeSection1(rawRows), [rawRows])
  const s2 = useMemo(() => computeSection2(rawRows), [rawRows])
  const s3 = useMemo(() => computeSection3(rawRows), [rawRows])

  return (
    <div className="space-y-10">

      {/* ── Раздел 1 ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          n={1}
          title="Кто ещё не попробовал баллы"
          desc="Агент считается «попробовавшим», если хотя бы у одной его строки LoyaltyPointsInLK > 0. В анализ входят только агенты с минимум 1 оформленным полисом (State = PolicyIssued). Нажмите на число «не попробовали» для скачивания списка."
        />
        <Section1View data={s1} />
      </section>

      {/* ── Раздел 2 ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          n={2}
          title="Удержание после первого использования"
          desc="Когортный анализ: агенты группируются по месяцу первого использования бонусов (T₀). Для каждой когорты показывается доля агентов, активных с бонусами в M+0, M+1, … M+4 месяцах после T₀. Когорты с менее чем 5 агентами скрыты."
        />
        <Section2View data={s2} />
      </section>

      {/* ── Раздел 3 ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          n={3}
          title="До и после первого использования бонусов"
          desc="Сравниваются медианные показатели агента за 60 дней до T₀ и 60 дней после T₀. «Изменение» — медиана попарных дельт (after − before) по всем агентам, а не разность медиан."
        />
        <Section3View data={s3} />
      </section>

    </div>
  )
}
