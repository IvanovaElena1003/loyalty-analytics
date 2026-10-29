import { useMemo, useState } from 'react'
import type { RawRow } from '../types'
import { downloadXlsx } from '../utils/engagement'
import {
  computeCrossImpactSepOct,
  crossImpactToXlsxRow,
  type CrossImpactRow,
} from '../utils/crossImpactSepOct'

const TOP_N = 10

function fmtConv(v: number): string {
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
}

function fmtPp(v: number): string {
  const sign = v > 0 ? '+' : ''
  return sign + v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtImpact(v: number): string {
  const sign = v > 0 ? '+' : ''
  return sign + v.toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function downloadSection(rows: CrossImpactRow[], filename: string) {
  const out = rows.map((r, i) => crossImpactToXlsxRow(r, i + 1))
  downloadXlsx(out, filename)
}

function ImpactTable({
  rows,
  variant,
}: {
  rows: CrossImpactRow[]
  variant: 'down' | 'up'
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm ren-text-secondary px-4 py-6">Нет партнёров в этой группе для текущих фильтров.</p>
    )
  }

  const top = rows.slice(0, TOP_N)
  const negative = variant === 'down'

  return (
    <div className="overflow-x-auto">
      <table className="ren-table w-full text-sm min-w-[960px]">
        <thead className="border-b border-[var(--stroke-divider)]">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Cashbook</th>
            <th className="px-3 py-2 text-left">Партнёр</th>
            <th className="px-3 py-2 text-left">Куратор</th>
            <th className="px-3 py-2 text-left">Филиал</th>
            <th className="px-3 py-2 text-left">КП</th>
            <th className="px-3 py-2 text-right">ОСАГО сен</th>
            <th className="px-3 py-2 text-right">ОСАГО окт</th>
            <th className="px-3 py-2 text-right">Conv сен</th>
            <th className="px-3 py-2 text-right">Conv окт</th>
            <th className="px-3 py-2 text-right">Δ conv</th>
            <th className="px-3 py-2 text-right">Влияние, п.п.</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r, i) => (
            <tr key={r.cashbook} className="border-t border-[var(--stroke-divider)]">
              <td className="px-3 py-2 text-[var(--text-tertiary)]">{i + 1}</td>
              <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.cashbook}</td>
              <td className="px-3 py-2 max-w-[200px]">
                <span className="line-clamp-2" title={r.name}>{r.name}</span>
                <span className="block text-[10px] ren-text-secondary">{r.mediatorType}</span>
              </td>
              <td className="px-3 py-2 text-xs max-w-[140px] line-clamp-2" title={r.curator}>{r.curator}</td>
              <td className="px-3 py-2 text-xs whitespace-nowrap">{r.filial}</td>
              <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">{r.salesChannel}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.osSep.toLocaleString('ru-RU')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.osOct.toLocaleString('ru-RU')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtConv(r.convSep)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtConv(r.convOct)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${negative ? 'text-red-600' : 'text-emerald-700'}`}>
                {fmtPp(r.deltaConvPp)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.impactPp < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {fmtImpact(r.impactPp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CrossImpactSepOctBlock({
  rawRows,
  agentRows,
}: {
  rawRows: RawRow[]
  agentRows?: RawRow[]
}) {
  const [methodologyOpen, setMethodologyOpen] = useState(false)

  const { declined, improved, summary } = useMemo(() => {
    const result = computeCrossImpactSepOct(rawRows, agentRows)
    const declined = result.rows
      .filter(r => r.deltaConvPp < 0)
      .sort((a, b) => a.impactPp - b.impactPp)
    const improved = result.rows
      .filter(r => r.deltaConvPp > 0)
      .sort((a, b) => b.impactPp - a.impactPp)
    return { declined, improved, summary: result }
  }, [rawRows, agentRows])

  if (summary.totalOsSep === 0) return null

  const fmtPct = (v: number) =>
    v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'

  return (
    <div className="space-y-5">
      <div className="ren-card">
        <div className="ren-card__header space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="ren-card__title">Сентябрь → октябрь: вклад партнёров в conv кросса</h3>
              <p className="ren-card__subtitle">
                Сравнение как в выгрузке all_regions: сентябрь целиком, октябрь без 08, 12, 14 и 22.10.
                Сначала те, у кого conv упала; затем — выросла.
              </p>
            </div>
            <div className="ren-kpi shrink-0 text-right">
              <p className="ren-kpi__value text-lg">{fmtPct(summary.convSep)} → {fmtPct(summary.convOct)}</p>
              <p className="ren-kpi__label">
                Δ {fmtPp(summary.deltaConvPp)} п.п. · ОСАГО {summary.totalOsSep.toLocaleString('ru-RU')} / {summary.totalOsOct.toLocaleString('ru-RU')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMethodologyOpen(o => !o)}
            className="ren-link flex items-center gap-1"
          >
            <span>{methodologyOpen ? '▾' : '▸'}</span>
            <span>Как считается</span>
          </button>
          {methodologyOpen && (
            <div className="text-xs ren-text-brand space-y-1 border-t border-[var(--stroke-divider)] pt-2">
              <p><strong>ОСАГО</strong> — PolicyIssued, без PolicyAnnulled / PolicyTerminated.</p>
              <p><strong>Кросс</strong> — CrossIsBought = Да на оформленных полисах.</p>
              <p><strong>Conv партнёра</strong> — кросс / ОСАГО в месяце; если в октябре 0 полисов — conv окт = 0%.</p>
              <p><strong>Влияние, п.п.</strong> = (ОСАГО партнёра в сент / всего ОСАГО в сент) × (conv окт − conv сент).</p>
              <p>Учитываются фильтры агентской сети выше на странице.</p>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--stroke-divider)]">
          <div className="ren-card__header flex items-center justify-between gap-3 py-3">
            <div>
              <h4 className="font-semibold text-[var(--text-primary)]">Conv снизилась</h4>
              <p className="text-xs ren-text-secondary">{declined.length} партнёров · сортировка по влиянию (сильнее всего вниз)</p>
            </div>
            <button
              type="button"
              disabled={declined.length === 0}
              onClick={() => downloadSection(declined, 'cross_impact_sep_oct_declined.xlsx')}
              className="ren-btn ren-btn--primary shrink-0 text-xs"
            >
              ↓ xlsx (все {declined.length})
            </button>
          </div>
          <ImpactTable rows={declined} variant="down" />
          {declined.length > TOP_N && (
            <p className="text-xs ren-text-secondary px-4 py-2 border-t border-[var(--stroke-divider)]">
              Показаны топ-{TOP_N} из {declined.length}.
            </p>
          )}
        </div>

        <div className="border-t border-[var(--stroke-divider)]">
          <div className="ren-card__header flex items-center justify-between gap-3 py-3">
            <div>
              <h4 className="font-semibold text-[var(--text-primary)]">Conv выросла</h4>
              <p className="text-xs ren-text-secondary">{improved.length} партнёров · сортировка по влиянию (сильнее всего вверх)</p>
            </div>
            <button
              type="button"
              disabled={improved.length === 0}
              onClick={() => downloadSection(improved, 'cross_impact_sep_oct_improved.xlsx')}
              className="ren-btn ren-btn--primary shrink-0 text-xs"
            >
              ↓ xlsx (все {improved.length})
            </button>
          </div>
          <ImpactTable rows={improved} variant="up" />
          {improved.length > TOP_N && (
            <p className="text-xs ren-text-secondary px-4 py-2 border-t border-[var(--stroke-divider)]">
              Показаны топ-{TOP_N} из {improved.length}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
