import { useMemo } from 'react'
import type { AggregateResult, MonthMetrics } from '../../types'
import { computeSection1 } from '../../utils/engagement'

interface Props { result: AggregateResult }

// ─── Утилиты ─────────────────────────────────────────────────────────────────
const fmtPct  = (v: number, d = 1) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: d })}%`
const fmtN    = (v: number) => Math.round(v).toLocaleString('ru-RU')
const fmtSign = (v: number, suffix = ' п.п.') => {
  const abs = Math.abs(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  return `${v >= 0 ? '+' : '−'}${abs}${suffix}`
}

function avgOf(months: MonthMetrics[], key: keyof MonthMetrics): number {
  const vals = months.map(m => m[key] as number | null).filter((v): v is number => v !== null && isFinite(v))
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
}

type Dir = 'up' | 'down' | 'flat'

function trend(cur: number, prev: number, absThreshold = 0.5): Dir {
  if (prev === 0) return cur > 0 ? 'up' : 'flat'
  const abs = cur - prev
  if (Math.abs(abs) < absThreshold) return 'flat'
  if (cur > prev) return 'up'
  return 'down'
}

// ─── Типы инсайтов ────────────────────────────────────────────────────────────
interface MetricInsight {
  label: string
  cur: string
  prev: string
  delta: string
  dir: Dir
  goodDir: Dir          // 'up' = рост хорошо, 'down' = рост плохо
  detail: string
}

interface Recommendation {
  priority: 'high' | 'medium' | 'low'
  icon: string
  title: string
  body: string
  action: string
}

interface Segment {
  icon: string
  title: string
  desc: string
  howTo: string
}

// ─── Вычисление инсайтов ──────────────────────────────────────────────────────
function computeInsights(result: AggregateResult) {
  const { months, totals, rawRows } = result
  if (months.length === 0) return null

  // Разбиваем период на «до» и «после»
  const sorted = [...months].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  const n = sorted.length
  const mid = Math.ceil(n / 2)
  const recent  = sorted.slice(mid)    // вторая половина
  const earlier = sorted.slice(0, mid) // первая половина
  const hasTrend = earlier.length >= 1 && recent.length >= 1

  // ── Метрики ───────────────────────────────────────────────────────────────
  const metrics: MetricInsight[] = []

  function addMetric(
    label: string,
    key: keyof MonthMetrics,
    goodDir: Dir,
    detail: (cur: number, prev: number) => string,
    fmt: (v: number) => string = fmtPct,
    absThresh = 0.5,
  ) {
    const cur  = avgOf(recent, key)
    const prev = avgOf(earlier, key)
    const delta = cur - prev
    const dir   = hasTrend ? trend(cur, prev, absThresh) : 'flat'
    metrics.push({
      label,
      cur:   fmt(cur),
      prev:  fmt(prev),
      delta: fmtSign(delta, key === 'conversion' || key === 'pct_issued_bonus'
        || key === 'conv_cross' ? ' п.п.' : ''),
      dir,
      goodDir,
      detail: detail(cur, prev),
    })
  }

  addMetric(
    'Конверсия котировки → оформление',
    'conversion',
    'up',
    (c, p) => hasTrend
      ? `В последние месяцы ${c.toFixed(1)}%, ранее ${p.toFixed(1)}%`
      : `Средняя конверсия за период: ${c.toFixed(1)}%`,
    fmtPct,
    0.3,
  )

  addMetric(
    '% оформленных полисов с Рен-бонусами',
    'pct_issued_bonus',
    'up',
    (c, p) => hasTrend
      ? `Недавно ${c.toFixed(1)}%, ранее ${p.toFixed(1)}%`
      : `${c.toFixed(1)}% оформленных имеют начисление РБ`,
    fmtPct,
    0.5,
  )

  addMetric(
    'Конверсия в Кросс-Каско',
    'conv_cross',
    'up',
    (c, p) => hasTrend
      ? `КК: ${c.toFixed(1)}% от оформленных, ранее ${p.toFixed(1)}%`
      : `${c.toFixed(1)}% оформленных ОСАГО купили КК`,
    fmtPct,
    0.3,
  )

  // Начислений в месяц (абсолютное)
  const curAccrual  = avgOf(recent, 'bonus_accrued')
  const prevAccrual = avgOf(earlier, 'bonus_accrued')
  const dirAccrual  = hasTrend ? trend(curAccrual, prevAccrual, curAccrual * 0.05) : 'flat'
  metrics.push({
    label: 'Начислено Рен-бонусов / месяц',
    cur:   fmtN(curAccrual) + ' РБ',
    prev:  fmtN(prevAccrual) + ' РБ',
    delta: fmtSign(curAccrual - prevAccrual, ' РБ'),
    dir:   dirAccrual,
    goodDir: 'up',
    detail: hasTrend
      ? `Объём начислений ${dirAccrual === 'up' ? 'растёт' : dirAccrual === 'down' ? 'снижается' : 'стабилен'}`
      : `Среднее за период: ${fmtN(curAccrual)} РБ/мес`,
  })

  // Списаний в месяц
  const curSpend  = avgOf(recent, 'bonus_spent_total')
  const prevSpend = avgOf(earlier, 'bonus_spent_total')
  const dirSpend  = hasTrend ? trend(curSpend, prevSpend, curSpend * 0.05) : 'flat'
  metrics.push({
    label: 'Списано Рен-бонусов / месяц',
    cur:   fmtN(curSpend) + ' РБ',
    prev:  fmtN(prevSpend) + ' РБ',
    delta: fmtSign(curSpend - prevSpend, ' РБ'),
    dir:   dirSpend,
    goodDir: 'up',
    detail: hasTrend
      ? `Списания ${dirSpend === 'up' ? 'растут' : dirSpend === 'down' ? 'снижаются' : 'стабильны'}`
      : `Среднее за период: ${fmtN(curSpend)} РБ/мес`,
  })

  // Доля списаний от начислений
  const totalAccrued = totals.bonus_accrued
  const totalSpent   = totals.bonus_spent_total
  const spendRatio   = totalAccrued > 0 ? (totalSpent / totalAccrued) * 100 : 0

  // ── Вовлечённость агентов ─────────────────────────────────────────────────
  const s1 = computeSection1(rawRows, 'default')
  const triedPct = s1.grandTotal > 0 ? (s1.grandTried / s1.grandTotal) * 100 : 0
  const notTriedPct = 100 - triedPct

  // ── Рекомендации ─────────────────────────────────────────────────────────
  const recommendations: Recommendation[] = []

  // 1. Агенты, не пробовавшие РБ
  if (notTriedPct > 50) {
    recommendations.push({
      priority: 'high',
      icon: '🎯',
      title: `${fmtPct(notTriedPct)} агентов ещё не использовали Рен-бонусы`,
      body: `Из ${fmtN(s1.grandTotal)} агентов с оформленными полисами только ${fmtN(s1.grandTried)} хотя бы раз получили Рен-бонусы. ${fmtN(s1.grandTotal - s1.grandTried)} агентов — потенциал для роста.`,
      action: 'Вкладка Вовлечённость → Раздел 1 → скачать список → запустить адресную коммуникацию',
    })
  } else if (notTriedPct > 25) {
    recommendations.push({
      priority: 'medium',
      icon: '📢',
      title: `${fmtPct(notTriedPct)} агентов ещё не попробовали программу`,
      body: `${fmtN(s1.grandTotal - s1.grandTried)} агентов оформляют полисы, но не получали Рен-бонусы. Возможно, не осведомлены о программе.`,
      action: 'Запустить информационную рассылку. Список — в разделе Вовлечённость',
    })
  }

  // 2. Накопления сильно превышают списания
  if (spendRatio < 30 && totalAccrued > 0) {
    recommendations.push({
      priority: 'high',
      icon: '💰',
      title: `Партнёры накапливают, но почти не списывают (${fmtPct(spendRatio)} от начислений)`,
      body: `За весь период начислено ${fmtN(totalAccrued)} РБ, а списано только ${fmtN(totalSpent)} РБ. Большой накопленный баланс — нереализованная ценность программы.`,
      action: 'Запустить кампанию активации: напомнить агентам о балансе, добавить стимулы к использованию',
    })
  } else if (spendRatio < 60 && totalAccrued > 0) {
    recommendations.push({
      priority: 'medium',
      icon: '💸',
      title: `Использование бонусов ниже потенциала (${fmtPct(spendRatio)} от начислений)`,
      body: `Списывается ${fmtPct(spendRatio)} от всего, что начислено. Возможно, агенты не знают, как применять, или условия мешают.`,
      action: 'Упростить механику списания, добавить обучающий контент для агентов',
    })
  }

  // 3. Конверсия снижается
  const convMetric = metrics.find(m => m.label.includes('Конверсия котировки'))
  if (convMetric?.dir === 'down') {
    recommendations.push({
      priority: 'high',
      icon: '📉',
      title: 'Конверсия котировок в оформление снижается',
      body: `В последние месяцы конверсия ${convMetric.cur}, ранее была ${convMetric.prev}. Снижение на ${convMetric.delta}. Воронка теряет клиентов.`,
      action: 'Изучить вкладку Воронка → найти шаг с наибольшим отсевом → исследовать причины',
    })
  }

  // 4. % с РБ снижается
  const rbPctMetric = metrics.find(m => m.label.includes('% оформленных'))
  if (rbPctMetric?.dir === 'down') {
    recommendations.push({
      priority: 'medium',
      icon: '🔽',
      title: 'Доля полисов с начислением Рен-бонусов снижается',
      body: `Недавно: ${rbPctMetric.cur}, ранее: ${rbPctMetric.prev}. Меньше клиентов получают бонус при оформлении.`,
      action: 'Проверить условия начисления: нет ли технических блокировок. Изучить сегмент «без бонуса» в Аномалиях',
    })
  }

  // 5. КК снижается
  const crossMetric = metrics.find(m => m.label.includes('Кросс-Каско'))
  if (crossMetric?.dir === 'down') {
    recommendations.push({
      priority: 'medium',
      icon: '🚗',
      title: 'Конверсия в Кросс-Каско снижается',
      body: `КК: ${crossMetric.cur} от оформленных, ранее ${crossMetric.prev}. Агенты реже предлагают кросс-продукт.`,
      action: 'Запустить мотивационную программу для агентов по продаже КК. Изучить сегмент «с РБ» vs «без РБ»',
    })
  }

  // 6. Всё хорошо — но есть куда расти
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'low',
      icon: '✅',
      title: 'Ключевые метрики в норме',
      body: 'Конверсия, доля полисов с Рен-бонусами и вовлечённость агентов не показывают тревожных трендов.',
      action: 'Сфокусироваться на масштабировании: выявить топ-агентов и распространить их опыт',
    })
  }

  // 7. Рост — рекомендация по масштабированию
  if (convMetric?.dir === 'up' || rbPctMetric?.dir === 'up') {
    recommendations.push({
      priority: 'low',
      icon: '🚀',
      title: 'Положительный тренд — время масштабировать',
      body: `Метрики улучшаются. Зафиксируйте, какие практики дали результат.`,
      action: 'Выгрузить список «участивших продажи» (Вовлечённость → Раздел 4) и взять у них интервью',
    })
  }

  // ── Сегменты ─────────────────────────────────────────────────────────────
  const segments: Segment[] = [
    {
      icon: '🏦',
      title: 'Агенты с накопленным балансом > 0, без единого списания',
      desc: 'Партнёры, которые зарабатывают Рен-бонусы, но ни разу их не применили. Возможная причина: не понимают, как или забывают.',
      howTo: 'Фильтр в Распределении: партнёры с ненулевым балансом → сравнить с отчётом по списаниям',
    },
    {
      icon: '📊',
      title: 'Агенты, участившие продажи после первого РБ',
      desc: 'Сегмент, на котором программа работает. Их подход стоит изучить и тиражировать.',
      howTo: 'Вовлечённость → Раздел 4 → скачать xlsx → провести глубинные интервью',
    },
    {
      icon: '❄️',
      title: 'Агенты с ≥ 1 оформленным полисом, но нулевым РБ за последние 2 месяца',
      desc: 'Партнёры, которые когда-то участвовали в программе, но последнее время неактивны.',
      howTo: 'Вовлечённость → Раздел 2 (когортное удержание) → найти когорты с низким M+2/M+3',
    },
    {
      icon: '🔬',
      title: 'Аномальные строки: нулевые значения и двойные списания',
      desc: 'Строки с нулевым LoyaltyPointsInLK, или с одновременным KV и скидкой — могут искажать аналитику.',
      howTo: 'Аномалии → все дашборды → скачать xlsx для разбора с ИТ или операционной командой',
    },
    {
      icon: '💎',
      title: 'Топ-10% партнёров по объёму КК',
      desc: 'Самые активные агенты по Кросс-Каско. Изучить, какие инструменты и условия у них работают.',
      howTo: 'Распределение → В разрезе партнёров → отфильтровать верхний децил по сумме списаний',
    },
  ]

  // ── Итоговые KPI ─────────────────────────────────────────────────────────
  const kpis = {
    periodStart: sorted[0]?.label ?? '—',
    periodEnd:   sorted[n - 1]?.label ?? '—',
    months:      n,
    totalQuotes: totals.total_quotes,
    totalIssued: totals.issued_total,
    conversionOverall: totals.total_quotes > 0
      ? (totals.issued_total / totals.total_quotes) * 100 : 0,
    pctBonusOverall: totals.issued_total > 0
      ? (totals.issued_with_bonus / totals.issued_total) * 100 : 0,
    crossConvOverall: totals.issued_total > 0
      ? (totals.cross_total / totals.issued_total) * 100 : 0,
    triedPct,
    notTriedPct,
    totalAgents:   s1.grandTotal,
    totalAccrued,
    totalSpent,
    spendRatio,
  }

  return { metrics, recommendations, segments, kpis, hasTrend, periodEarlier: earlier, periodRecent: recent }
}

// ─── UI-компоненты ────────────────────────────────────────────────────────────
function DirIcon({ dir, goodDir }: { dir: Dir; goodDir: Dir }) {
  if (dir === 'flat') return <span className="text-gray-400 text-lg">→</span>
  const isGood = dir === goodDir
  if (dir === 'up')   return <span className={`text-lg ${isGood ? 'text-green-500' : 'text-red-500'}`}>↑</span>
  return <span className={`text-lg ${isGood ? 'text-green-500' : 'text-red-500'}`}>↓</span>
}

function dirBg(dir: Dir, goodDir: Dir): string {
  if (dir === 'flat') return 'bg-gray-50 border-gray-200'
  const isGood = dir === goodDir
  return isGood ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
}

function priorityBadge(p: 'high' | 'medium' | 'low') {
  if (p === 'high')   return 'bg-red-100 text-red-700 border-red-200'
  if (p === 'medium') return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-blue-50 text-blue-600 border-blue-200'
}
function priorityLabel(p: 'high' | 'medium' | 'low') {
  if (p === 'high')   return 'Высокий приоритет'
  if (p === 'medium') return 'Средний приоритет'
  return 'Низкий приоритет'
}

// ─── Главный компонент ────────────────────────────────────────────────────────
export default function InsightsTab({ result }: Props) {
  const data = useMemo(() => computeInsights(result), [result])

  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        Нет данных для анализа. Загрузите файл.
      </div>
    )
  }

  const { metrics, recommendations, segments, kpis, hasTrend } = data

  const improved = metrics.filter(m => m.dir !== 'flat' && m.dir === m.goodDir)
  const worsened = metrics.filter(m => m.dir !== 'flat' && m.dir !== m.goodDir)
  const stable   = metrics.filter(m => m.dir === 'flat')

  return (
    <div className="space-y-8">

      {/* ── Шапка ────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg">
        <h2 className="text-xl font-bold mb-1">Сводные выводы по программе лояльности</h2>
        <p className="text-blue-100 text-sm">
          Период: {kpis.periodStart} — {kpis.periodEnd} · {kpis.months} мес.
          {hasTrend && ' · Показан тренд (первая половина → вторая половина периода)'}
        </p>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Котировок всего', value: fmtN(kpis.totalQuotes) },
            { label: 'Оформлено полисов', value: fmtN(kpis.totalIssued) },
            { label: 'Конверсия (всего)', value: fmtPct(kpis.conversionOverall) },
            { label: '% полисов с РБ', value: fmtPct(kpis.pctBonusOverall) },
          ].map(k => (
            <div key={k.label} className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
              <p className="text-xs text-blue-100">{k.label}</p>
              <p className="text-2xl font-bold mt-0.5">{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Вовлечённость агентов ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Агентов охвачено программой</p>
          <p className="text-3xl font-bold text-blue-700 mt-2">{fmtPct(kpis.triedPct)}</p>
          <p className="text-sm text-gray-500 mt-1">
            {fmtN(kpis.totalAgents - (kpis.totalAgents * kpis.notTriedPct / 100))} из {fmtN(kpis.totalAgents)} использовали РБ
          </p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, kpis.triedPct)}%` }} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Начислено РБ (всего)</p>
          <p className="text-3xl font-bold text-emerald-700 mt-2">{fmtN(kpis.totalAccrued)}</p>
          <p className="text-sm text-gray-500 mt-1">Конверсия КК: {fmtPct(kpis.crossConvOverall)}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Списано / начислено</p>
          <p className={`text-3xl font-bold mt-2 ${kpis.spendRatio < 30 ? 'text-red-600' : kpis.spendRatio < 60 ? 'text-amber-600' : 'text-emerald-700'}`}>
            {fmtPct(kpis.spendRatio)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Списано {fmtN(kpis.totalSpent)} из {fmtN(kpis.totalAccrued)} РБ
          </p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${kpis.spendRatio < 30 ? 'bg-red-400' : kpis.spendRatio < 60 ? 'bg-amber-400' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, kpis.spendRatio)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Тренд: три колонки ───────────────────────────────────────────── */}
      {hasTrend && (
        <div>
          <h3 className="text-base font-bold text-gray-800 mb-3">
            Тренд: первая половина периода → вторая половина
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Улучшилось */}
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">✅</span>
                <h4 className="font-bold text-green-800 text-sm uppercase tracking-wide">
                  Улучшилось{improved.length > 0 && ` (${improved.length})`}
                </h4>
              </div>
              {improved.length === 0
                ? <p className="text-sm text-green-400 italic">Нет улучшений в данном периоде</p>
                : improved.map(m => (
                  <div key={m.label} className="bg-white/70 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700 leading-tight">{m.label}</span>
                      <span className="text-green-600 font-bold text-xs whitespace-nowrap">{m.delta}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{m.detail}</p>
                  </div>
                ))
              }
            </div>

            {/* Ухудшилось */}
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">❌</span>
                <h4 className="font-bold text-red-800 text-sm uppercase tracking-wide">
                  Ухудшилось{worsened.length > 0 && ` (${worsened.length})`}
                </h4>
              </div>
              {worsened.length === 0
                ? <p className="text-sm text-red-300 italic">Явных ухудшений не выявлено</p>
                : worsened.map(m => (
                  <div key={m.label} className="bg-white/70 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700 leading-tight">{m.label}</span>
                      <span className="text-red-600 font-bold text-xs whitespace-nowrap">{m.delta}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{m.detail}</p>
                  </div>
                ))
              }
            </div>

            {/* Стабильно */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">→</span>
                <h4 className="font-bold text-gray-600 text-sm uppercase tracking-wide">
                  Стабильно{stable.length > 0 && ` (${stable.length})`}
                </h4>
              </div>
              {stable.length === 0
                ? <p className="text-sm text-gray-300 italic">—</p>
                : stable.map(m => (
                  <div key={m.label} className="bg-white/70 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700 leading-tight">{m.label}</span>
                      <span className="text-gray-400 text-xs whitespace-nowrap">{m.cur}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{m.detail}</p>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Детализация всех метрик ──────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-bold text-gray-800 mb-3">Детализация по метрикам</h3>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
              <tr>
                <th className="px-4 py-2.5 text-left">Метрика</th>
                {hasTrend && <th className="px-4 py-2.5 text-right">Ранее</th>}
                <th className="px-4 py-2.5 text-right">{hasTrend ? 'Недавно' : 'Текущее'}</th>
                {hasTrend && <th className="px-4 py-2.5 text-right">Изменение</th>}
                <th className="px-4 py-2.5 text-left">Вывод</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => {
                const isGood = m.dir === 'flat' || m.dir === m.goodDir
                return (
                  <tr key={m.label} className={`border-t border-gray-100 ${dirBg(m.dir, m.goodDir)} hover:opacity-90`}>
                    <td className="px-4 py-2.5 font-medium text-gray-700">{m.label}</td>
                    {hasTrend && <td className="px-4 py-2.5 text-right tabular-nums text-gray-400 text-xs">{m.prev}</td>}
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{m.cur}</td>
                    {hasTrend && (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${m.dir === 'flat' ? 'text-gray-400' : isGood ? 'text-green-700' : 'text-red-600'}`}>
                          <DirIcon dir={m.dir} goodDir={m.goodDir} />
                          {m.delta}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-xs text-gray-500">{m.detail}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Рекомендации ─────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-bold text-gray-800 mb-3">💡 Рекомендации</h3>
        <div className="space-y-3">
          {recommendations
            .sort((a, b) => {
              const ord = { high: 0, medium: 1, low: 2 }
              return ord[a.priority] - ord[b.priority]
            })
            .map((r, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <span className="text-2xl shrink-0 mt-0.5">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${priorityBadge(r.priority)}`}>
                        {priorityLabel(r.priority)}
                      </span>
                      <h4 className="text-sm font-bold text-gray-800">{r.title}</h4>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{r.body}</p>
                    <div className="mt-2.5 flex items-start gap-2 bg-blue-50 rounded-lg px-3 py-2">
                      <span className="text-blue-500 shrink-0 text-xs font-bold mt-0.5">→ Действие:</span>
                      <span className="text-xs text-blue-800">{r.action}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* ── Сегменты для исследования ─────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-bold text-gray-800 mb-3">🔍 Сегменты для исследования</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {segments.map((s, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0">{s.icon}</span>
                <div>
                  <h4 className="text-sm font-bold text-gray-800 leading-snug">{s.title}</h4>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{s.desc}</p>
                  <div className="mt-2.5 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-400 font-semibold">Как найти: </span>
                    <span className="text-xs text-gray-600">{s.howTo}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400 px-1 pb-4">
        Выводы и рекомендации формируются автоматически на основе данных в файле.
        Тренд сравнивает первую и вторую половины загруженного периода.
        Анализ показывает корреляции, а не причинно-следственные связи.
      </p>
    </div>
  )
}
