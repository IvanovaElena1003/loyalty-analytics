import { useMemo, useState } from 'react'
import { STATUSES_SNAPSHOT } from '../../data/statusesSnapshot'
import {
  MECHANIC_LABELS,
  fmtPct,
  fmtRub,
  type MechanicKey,
} from '../../utils/loyaltyBalances'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowTotals = any

const fmtN = (n: number) => n.toLocaleString('ru-RU')

function fmtDateRu(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Строки метрик: подпись + ключи в объекте среза */
type MetricRowDef = {
  id: string
  label: string
  amountKey: string
  countKey?: string
  countSuffix?: string
  emphasis?: boolean
  isPct?: boolean
}

const METRIC_ROWS: MetricRowDef[] = [
  { id: 'accOsago', label: 'Начисление ОСАГО ФЛ', amountKey: 'accOsago' },
  { id: 'accKasko', label: 'Начисление КАСКО ФЛ', amountKey: 'accKasko' },
  { id: 'accTotal', label: 'Начислено всего', amountKey: 'accTotal', emphasis: true },
  { id: 'sd', label: 'Списание · кросс скидка (бесполис.)', amountKey: 'spendCrossDiscount', countKey: 'crossDiscountCnt', countSuffix: 'полисов' },
  { id: 'skv', label: 'Списание · кросс повыш. КВ', amountKey: 'spendCrossKv', countKey: 'crossKvCnt', countSuffix: 'полисов' },
  { id: 'ska', label: 'Списание КАСКО ФЛ', amountKey: 'spendKasko', countKey: 'kaskoSpendCnt', countSuffix: 'полисов' },
  { id: 'sos', label: 'Списание ОСАГО пролонгация', amountKey: 'spendOsagoSlider', countKey: 'osagoSliderCnt', countSuffix: 'в окне дат' },
  { id: 'st', label: 'Списано всего', amountKey: 'spendTotal', emphasis: true },
  { id: 'util', label: 'Утилизация', amountKey: 'utilPct', isPct: true },
]

function cellAmount(row: RowTotals, key: string, isPct?: boolean): string {
  if (isPct) return fmtPct(row[key] as number | null)
  return fmtRub(Number(row[key] ?? 0))
}

function noteForRow(row: RowTotals, countKey?: string, suffix?: string): string {
  if (!countKey) return ''
  const n = Number(row[countKey] ?? 0)
  if (!n) return ''
  return `${fmtN(n)} ${suffix ?? ''}`
}

export default function StatusesTab() {
  const snap = STATUSES_SNAPSHOT
  const [regionsOpen, setRegionsOpen] = useState(false)

  const startByKey = useMemo(() => snap.mechanicStarts, [])
  const totalRow = { region: 'Вся сеть', ...snap.totals }
  const sliceRows = snap.top3 as unknown as RowTotals[]

  const regionChildren = useMemo(
    () =>
      sliceRows
        .filter(r => r.rollup === 'regions' && r.children?.length)
        .flatMap(r => r.children as RowTotals[]),
    [sliceRows],
  )

  return (
    <div className="space-y-5 max-w-full">
      <p className="text-sm ren-text-secondary">
        Предрасчёт из xlsx ({snap.generatedAt}). Филиалы: B2Partners — {snap.agentFilialMapSize.toLocaleString('ru-RU')} кешбуков.
      </p>

      {/* 1. Итого за период — одна таблица вместо плиток */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
          <h3 className="ren-card__title text-sm">Итого за период · {snap.periodLabel}</h3>
        </div>
        <div className="ren-card__body p-0">
          <table className="statuses-table w-full">
            <thead>
              <tr>
                <th className="text-left">Показатель</th>
                <th className="text-right w-32">Сумма / %</th>
                <th className="text-right w-28">Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(m => (
                <tr key={m.id} className={m.emphasis ? 'statuses-table__row--emphasis' : ''}>
                  <td className="text-left">{m.label}</td>
                  <td className="text-right tabular-nums font-medium">
                    {cellAmount(totalRow, m.amountKey, m.isPct)}
                  </td>
                  <td className="text-right text-[var(--text-secondary)] text-[11px]">
                    {noteForRow(totalRow, m.countKey, m.countSuffix)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] ren-text-secondary px-3 py-2 border-t border-[var(--stroke-divider)]">
            Строки в выгрузке: ОСАГО {fmtN(snap.meta.rowsOsagoAllStatuses)}, КАСКО {fmtN(snap.meta.rowsKaskoAllStatuses)}.
            Ползунок: {snap.meta.sliderDataRange}. {snap.meta.osago2025Note}
          </p>
        </div>
      </div>

      {/* 2. Даты запуска */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
          <h3 className="ren-card__title text-sm">Механики и даты запуска</h3>
        </div>
        <div className="ren-card__body p-0">
          <table className="statuses-table w-full">
            <thead>
              <tr>
                <th className="text-left">Механика</th>
                <th className="text-right w-28">Дата</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(MECHANIC_LABELS) as MechanicKey[]).map(key => (
                <tr key={key}>
                  <td className="text-left">{MECHANIC_LABELS[key]}</td>
                  <td className="text-right tabular-nums">{fmtDateRu(startByKey[key as keyof typeof startByKey])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Москва / СПб / Регионы — метрики строками, без горизонтального скролла */}
      <div className="ren-card">
        <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
          <h3 className="ren-card__title text-sm">Сравнение: вся сеть и топ-3</h3>
        </div>
        <div className="ren-card__body p-0">
          <table className="statuses-table statuses-table--slice w-full">
            <thead>
              <tr>
                <th className="text-left">Показатель</th>
                <th className="text-right">Вся сеть</th>
                {sliceRows.map(s => (
                  <th key={String(s.region)} className="text-right">
                    {s.rollup === 'regions' ? (
                      <button type="button" className="ren-link font-medium" onClick={() => setRegionsOpen(o => !o)}>
                        {regionsOpen ? '▾' : '▸'} {String(s.region)}
                      </button>
                    ) : (
                      String(s.region)
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(m => (
                <tr key={m.id} className={m.emphasis ? 'statuses-table__row--emphasis' : ''}>
                  <td className="text-left">{m.label}</td>
                  <td className="text-right tabular-nums">{cellAmount(totalRow, m.amountKey, m.isPct)}</td>
                  {sliceRows.map(s => (
                    <td key={String(s.region)} className="text-right tabular-nums">
                      {cellAmount(s, m.amountKey, m.isPct)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Детализация регионов — только начисл / списано / утилизация */}
      {regionsOpen && regionChildren.length > 0 && (
        <div className="ren-card">
          <div className="ren-card__header border-b border-[var(--stroke-divider)] py-2">
            <h3 className="ren-card__title text-sm">Регионы · детализация по филиалам</h3>
          </div>
          <div className="ren-card__body p-0 max-h-[min(50vh,420px)] overflow-y-auto overflow-x-hidden">
            <table className="statuses-table w-full">
              <thead className="sticky top-0 bg-[var(--bg-bg-secondary)] z-10">
                <tr>
                  <th className="text-left">Филиал</th>
                  <th className="text-right">Начислено</th>
                  <th className="text-right">Списано</th>
                  <th className="text-right w-20">Утилиз.</th>
                </tr>
              </thead>
              <tbody>
                {regionChildren.map(r => (
                  <tr key={String(r.region)}>
                    <td className="text-left font-medium">{String(r.region)}</td>
                    <td className="text-right tabular-nums">{fmtRub(Number(r.accTotal))}</td>
                    <td className="text-right tabular-nums ren-text-brand">{fmtRub(Number(r.spendTotal))}</td>
                    <td className="text-right tabular-nums">{fmtPct(r.utilPct as number | null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="ren-card ren-card__body text-xs ren-text-secondary">
        <p className="font-semibold ren-text-brand mb-1">Методология</p>
        <p>Рублёвый эквивалент РБ. Seller / Продавец исключены; субучётки → HeadPartnerCB. Окно: {snap.periodLabel}.</p>
      </div>
    </div>
  )
}