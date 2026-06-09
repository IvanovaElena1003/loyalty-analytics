import { useMemo, useState } from 'react'
import type { RawRow } from '../../types'
import {
  computeSection1, computeSection2, computeSection3, computeSection4,
  downloadXlsx,
  type Section1Result, type Section2Result, type Section3Result, type Section4Result, type Section4AgentRow,
  type Section1Mode, type T0Mode,
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
              <th className="px-4 py-2.5 text-right">Попробовали Рен-бонусы</th>
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
        Нет когорт с ≥ 5 агентами, использовавшими Рен-бонусы.
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

// ─── Методология (разворачиваемый блок) ──────────────────────────────────────
function MethodologyBox({ title = 'Как читать этот отчёт', items }: { title?: string; items: string[] }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5 space-y-1.5">
      <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">{title}</p>
      {items.map((item, i) => (
        <p key={i} className="text-sm text-amber-900 flex gap-2 leading-snug">
          <span className="text-amber-400 shrink-0 font-bold mt-0.5">•</span>
          <span dangerouslySetInnerHTML={{ __html: item }} />
        </p>
      ))}
    </div>
  )
}

// ─── Вывод по строке таблицы Section 3 ───────────────────────────────────────
function s3Insight(label: string, delta: number, before: number, isConversion: boolean): {
  icon: string; text: string; action: string; cls: string
} {
  const relThreshold = 0.1  // 10% от исходного значения
  const absConvThreshold = 0.5  // 0.5 п.п. для конверсии
  const significant = isConversion
    ? Math.abs(delta) >= absConvThreshold
    : before === 0 ? Math.abs(delta) >= 0.3 : Math.abs(delta) / before >= relThreshold

  if (!significant) {
    return { icon: '→', text: 'Существенных изменений нет', action: 'Стабильный показатель', cls: 'text-gray-400' }
  }
  const up = delta > 0

  const map: Record<string, { upText: string; upAction: string; downText: string; downAction: string }> = {
    'Котировки': {
      upText:    'Агент активнее котирует',
      upAction:  'Сегмент для тиражирования опыта',
      downText:  'Котировок стало меньше',
      downAction:'Проверить нагрузку и мотивацию',
    },
    'Оформлено': {
      upText:    'Больше оформленных полисов',
      upAction:  'Масштабировать лучшую практику',
      downText:  'Меньше оформлений',
      downAction:'Исследовать барьеры в сегменте',
    },
    'Конверсия': {
      upText:    'Конверсия выросла — агент лучше доводит',
      upAction:  'Изучить и распространить приём',
      downText:  'Конверсия снизилась',
      downAction:'Изучить причины отказов клиентов',
    },
    'Кросс-Каско': {
      upText:    'Больше КК — программа работает',
      upAction:  'Подтвердить мотивирующий эффект',
      downText:  'КК меньше — проверить сезонность',
      downAction:'Сравнить с когортами без бонусов',
    },
  }
  const entry = map[label] ?? {
    upText: 'Улучшение', upAction: 'Изучить', downText: 'Снижение', downAction: 'Изучить',
  }
  return up
    ? { icon: '↑', text: entry.upText,   action: entry.upAction,   cls: 'text-green-700' }
    : { icon: '↓', text: entry.downText, action: entry.downAction, cls: 'text-red-600' }
}

// ─── Section 3 view ───────────────────────────────────────────────────────────
function Section3View({ data, t0Mode }: { data: Section3Result | null; t0Mode: T0Mode }) {
  const t0Def = t0Mode === 'spending'
    ? 'T₀ = дата первого <b>списания</b> Рен-бонусов этим агентом (первый полис КК с KV или скидкой)'
    : 'T₀ = дата первого <b>начисления</b> Рен-бонусов этому агенту (первая строка с LoyaltyPointsInLK > 0)'

  if (!data) {
    return (
      <div className="space-y-4">
        <MethodologyBox items={[
          t0Def,
          'Окно «До T₀» = 60 дней ДО даты T₀ (не включая T₀). Окно «После T₀» = 60 дней ПОСЛЕ T₀ (начиная с T₀).',
          'Если у агента меньше 3 строк хотя бы в одном окне — он исключается из анализа.',
        ]} />
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
          Недостаточно данных: нет агентов с ≥ 3 строками в обоих окнах (60 дней до и после T₀).
        </div>
      </div>
    )
  }

  const { beforeMed, afterMed, deltaMed, agentsIncluded, agentsTotal } = data

  const rows: { label: string; before: number; after: number; delta: number; isConversion: boolean }[] = [
    { label: 'Котировки',   before: beforeMed.quotations, after: afterMed.quotations, delta: deltaMed.quotations, isConversion: false },
    { label: 'Оформлено',   before: beforeMed.issued,     after: afterMed.issued,     delta: deltaMed.issued,     isConversion: false },
    { label: 'Конверсия',   before: beforeMed.conversion, after: afterMed.conversion, delta: deltaMed.conversion, isConversion: true  },
    { label: 'Кросс-Каско', before: beforeMed.cross,      after: afterMed.cross,      delta: deltaMed.cross,      isConversion: false },
  ]

  return (
    <div className="space-y-4">
      {/* Методология */}
      <MethodologyBox items={[
        t0Def,
        '«До T₀ (60 дн.)» — окно 60 дней ДО T₀. «После T₀ (60 дн.)» — окно 60 дней ПОСЛЕ T₀ (включая T₀).',
        'В каждом окне считаются: <b>котировки</b> (все строки агента), <b>оформлено</b> (State = PolicyIssued), <b>конверсия</b> = оформлено / котировки, <b>Кросс-Каско</b> (CrossIsBought = Да).',
        'В таблице — <b>медианы по всем агентам</b>. «Изменение» = медиана попарных дельт (после − до по каждому агенту) — это точнее, чем вычитать медианы.',
        'Агент исключается, если в одном из окон < 3 строк — слишком мало данных для сравнения.',
      ]} />

      {/* Мета */}
      <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-2.5 border border-gray-200">
        Агентов в анализе: <strong>{fmtN(agentsIncluded)}</strong> из {fmtN(agentsTotal)} с T₀ в данных.
        Исключены: {fmtN(agentsTotal - agentsIncluded)} (мало строк в окне).
      </div>

      {/* Таблица */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left">Метрика</th>
              <th className="px-4 py-2.5 text-right">
                <span className="block">До T₀</span>
                <span className="block text-[10px] font-normal normal-case text-gray-400">медиана, 60 дн.</span>
              </th>
              <th className="px-4 py-2.5 text-right">
                <span className="block">После T₀</span>
                <span className="block text-[10px] font-normal normal-case text-gray-400">медиана, 60 дн.</span>
              </th>
              <th className="px-4 py-2.5 text-right">Изменение</th>
              <th className="px-4 py-2.5 text-right">% изм.</th>
              <th className="px-4 py-2.5 text-left min-w-[200px]">Вывод</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const changePct = r.before !== 0 ? (r.delta / Math.abs(r.before)) * 100 : null
              const insight = s3Insight(r.label, r.delta, r.before, r.isConversion)

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
                  <td className={`px-4 py-2.5 ${insight.cls}`}>
                    <span className="font-bold mr-1">{insight.icon}</span>
                    <span className="text-xs">{insight.text}</span>
                    <span className="block text-[11px] text-gray-400 mt-0.5">{insight.action}</span>
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

// ─── Section 4 view ───────────────────────────────────────────────────────────
function Section4View({ data, t0Mode }: { data: Section4Result | null; t0Mode: T0Mode }) {
  const t0Def = t0Mode === 'spending'
    ? 'T₀ = дата первого <b>списания</b> Рен-бонусов этим агентом (первый полис КК с KV или скидкой)'
    : 'T₀ = дата первого <b>начисления</b> Рен-бонусов этому агенту (первая строка с LoyaltyPointsInLK > 0)'

  const methodology = [
    t0Def,
    '«<b>До T₀ (60 дн.)</b>» — сколько полисов (State = PolicyIssued) оформил агент за 60 дней ДО своего T₀.',
    '«<b>После T₀ (60 дн.)</b>» — сколько полисов оформил за 60 дней ПОСЛЕ T₀ (включая день T₀).',
    '«<b>Прирост</b>» = После − До. Положительный → агент участил продажи после знакомства с программой.',
    'В анализ попадают только агенты с ≥ 3 строками в каждом окне (иначе статистика ненадёжна).',
    'В таблице ниже — только те, у кого Прирост > 0. Для скачивания всех трёх групп переключите режим.',
  ]

  if (!data) {
    return (
      <div className="space-y-4">
        <MethodologyBox items={methodology} />
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
          Недостаточно данных: нет агентов с ≥ 3 строками в обоих окнах (60 дней до и после T₀).
        </div>
      </div>
    )
  }

  const { agentsTotal, agentsAnalyzed, agentsIncreased, agentsSame, agentsDecreased, increasedRows } = data

  return (
    <div className="space-y-4">
      {/* Методология */}
      <MethodologyBox items={methodology} />

      {/* Мета */}
      <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-2.5 border border-gray-200">
        Агентов с T₀ в данных: <strong>{fmtN(agentsTotal)}</strong>.{' '}
        В анализ вошли: <strong>{fmtN(agentsAnalyzed)}</strong> (≥ 3 строки в обоих окнах).{' '}
        Исключены: {fmtN(agentsTotal - agentsAnalyzed)}.
      </div>

      {/* Три карточки */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Участили продажи ↑</p>
          <p className="text-3xl font-bold text-green-700 mt-1">{fmtN(agentsIncreased)}</p>
          <p className="text-sm text-green-500 mt-0.5">{fmtPct(agentsIncreased, agentsAnalyzed)} от аналитики</p>
          <p className="text-xs text-green-400 mt-1">После &gt; До</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Без изменений →</p>
          <p className="text-3xl font-bold text-gray-700 mt-1">{fmtN(agentsSame)}</p>
          <p className="text-sm text-gray-400 mt-0.5">{fmtPct(agentsSame, agentsAnalyzed)} от аналитики</p>
          <p className="text-xs text-gray-400 mt-1">После = До</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-xs text-red-500 font-medium uppercase tracking-wide">Снизили продажи ↓</p>
          <p className="text-3xl font-bold text-red-600 mt-1">{fmtN(agentsDecreased)}</p>
          <p className="text-sm text-red-400 mt-0.5">{fmtPct(agentsDecreased, agentsAnalyzed)} от аналитики</p>
          <p className="text-xs text-red-300 mt-1">После &lt; До</p>
        </div>
      </div>

      {/* Список участивших */}
      {increasedRows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-green-50 border-b border-green-100 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-green-800">
              Агенты, участившие продажи после первого использования бонусов ({fmtN(increasedRows.length)})
            </h4>
            <button
              onClick={() => downloadXlsx(increasedRows as unknown as Record<string, unknown>[], 'increased_sales.xlsx')}
              className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-full transition-colors"
            >
              ↓ xlsx
            </button>
          </div>
          <div className="overflow-auto" style={{ maxHeight: '340px' }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 text-left">ФИО</th>
                  <th className="px-4 py-2.5 text-left">Роль</th>
                  <th className="px-4 py-2.5 text-right">
                    <span className="block">До T₀</span>
                    <span className="block text-[10px] font-normal normal-case text-gray-400">оформлено, 60 дн.</span>
                  </th>
                  <th className="px-4 py-2.5 text-right">
                    <span className="block">После T₀</span>
                    <span className="block text-[10px] font-normal normal-case text-gray-400">оформлено, 60 дн.</span>
                  </th>
                  <th className="px-4 py-2.5 text-right">
                    <span className="block">Прирост</span>
                    <span className="block text-[10px] font-normal normal-case text-gray-400">После − До</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(increasedRows as Section4AgentRow[]).map(r => (
                  <tr key={r.RenId} className="border-t border-gray-100 hover:bg-green-50/30 transition-colors">
                    <td className="px-4 py-2 text-gray-700">{r['ФИО']}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{r['Роль']}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-400">{r['Полисов до T₀ (60 дн.)']}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-700">{r['Полисов после T₀ (60 дн.)']}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-600 font-bold">
                      +{r['Прирост']}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 px-1">
        Анализ показывает корреляцию, а не причинно-следственную связь.
        Рост после T₀ может объясняться сезонностью или другими факторами.
      </p>
    </div>
  )
}

// ─── Вспомогательный компонент: переключатель режима ─────────────────────────
function FilterBar<T extends string | number>({
  label, options, value, onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
      <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide shrink-0 mr-1">
        {label}
      </span>
      {options.map(opt => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
            value === opt.value
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const S1_MODE_OPTIONS: { value: Section1Mode; label: string }[] = [
  { value: 'default',     label: 'Оформлен полис + любой бонус' },
  { value: 'all_agents',  label: 'Все агенты + любой бонус' },
  { value: 'issued_only', label: 'Бонус начислен по оформленному полису' },
]

const S1_MODE_DESC: Record<Section1Mode, string> = {
  default:     'Пул: агенты с ≥1 оформленным полисом (State = PolicyIssued). «Попробовал» = хотя бы одна строка с LoyaltyPointsInLK > 0 (не важно, по какому полису).',
  all_agents:  'Пул: все агенты в данных (без фильтра по оформлению). «Попробовал» = хотя бы одна строка с LoyaltyPointsInLK > 0.',
  issued_only: 'Пул: агенты с ≥1 оформленным полисом. «Попробовал» = хотя бы по одному PolicyIssued начислены Рен-бонусы (LoyaltyPointsInLK > 0 на строке с оформлением).',
}

const S2_THRESHOLD_OPTIONS = [
  { value: 1, label: '≥1 раза (любое)' },
  { value: 2, label: '≥2 раз' },
  { value: 3, label: '≥3 раз' },
]

const T0_MODE_OPTIONS: { value: T0Mode; label: string }[] = [
  { value: 'accrual',  label: 'T₀ = первое начисление (заработал)' },
  { value: 'spending', label: 'T₀ = первое списание (применил)' },
]

const T0_MODE_DESC: Record<T0Mode, string> = {
  accrual:  'T₀ = дата первой строки с LoyaltyPointsInLK > 0. Момент, когда агент впервые заработал Рен-бонусы.',
  spending: 'T₀ = дата первого полиса Кросс-Каско, где агент применил Рен-бонусы (ChargedToIncreasedKV ≠ 0 или FinalPrice ≠ PolicyPrice).',
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EngagementTab({ rawRows }: Props) {
  const [s1Mode,      setS1Mode]      = useState<Section1Mode>('default')
  const [s2Threshold, setS2Threshold] = useState<number>(1)
  const [t0Mode,      setT0Mode]      = useState<T0Mode>('accrual')

  const s1 = useMemo(() => computeSection1(rawRows, s1Mode),      [rawRows, s1Mode])
  const s2 = useMemo(() => computeSection2(rawRows, s2Threshold), [rawRows, s2Threshold])
  const s3 = useMemo(() => computeSection3(rawRows, t0Mode),      [rawRows, t0Mode])
  const s4 = useMemo(() => computeSection4(rawRows, t0Mode),      [rawRows, t0Mode])

  return (
    <div className="space-y-10">

      {/* ── Раздел 1 ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          n={1}
          title="Кто ещё не попробовал Рен-бонусы"
          desc={S1_MODE_DESC[s1Mode] + ' Нажмите на число «не попробовали» для скачивания списка.'}
        />
        <FilterBar
          label="Критерий «попробовал»:"
          options={S1_MODE_OPTIONS}
          value={s1Mode}
          onChange={setS1Mode}
        />
        <Section1View data={s1} />
      </section>

      {/* ── Раздел 2 ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          n={2}
          title="Удержание после первого использования"
          desc={`Когортный анализ: агенты группируются по месяцу первого использования Рен-бонусов. T₀ = месяц первой строки с LoyaltyPointsInLK > 0. Для каждой когорты показывается доля агентов, активных в M+0, M+1, … M+4 месяцах после T₀. Текущий порог активности: ${s2Threshold === 1 ? 'любое количество начислений' : `≥${s2Threshold} начисления в месяц`}. Когорты с < 5 агентами скрыты.`}
        />
        <FilterBar
          label="Активность в месяце:"
          options={S2_THRESHOLD_OPTIONS}
          value={s2Threshold}
          onChange={setS2Threshold}
        />
        <Section2View data={s2} />
      </section>

      {/* ── Раздел 3 ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          n={3}
          title="До и после первого использования бонусов"
          desc={`Сравниваются медианные показатели агента за 60 дней до T₀ и 60 дней после T₀. ${T0_MODE_DESC[t0Mode]} Разделы 3 и 4 используют одно и то же T₀.`}
        />
        <FilterBar
          label="Определение T₀ (разделы 3 и 4):"
          options={T0_MODE_OPTIONS}
          value={t0Mode}
          onChange={setT0Mode}
        />
        <Section3View data={s3} t0Mode={t0Mode} />
      </section>

      {/* ── Раздел 4 ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader
          n={4}
          title="Кто участил продажи после первых бонусов"
          desc={`Среди агентов с T₀ сравниваются оформленные полисы за 60 дней до и 60 дней после T₀. ${T0_MODE_DESC[t0Mode]} Фильтр T₀ управляет обоими разделами (3 и 4).`}
        />
        <Section4View data={s4} t0Mode={t0Mode} />
      </section>

    </div>
  )
}
