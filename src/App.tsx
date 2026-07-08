import { useState, useCallback } from 'react'
import { parseWorkbook, aggregate } from './utils/aggregate'
import type { AggregateResult } from './types'
import UploadTab from './components/tabs/UploadTab'
import FunnelTab from './components/tabs/FunnelTab'
import MethodologyTab from './components/tabs/MethodologyTab'
import DistributionTab from './components/tabs/DistributionTab'
import AnomaliesTab from './components/tabs/AnomaliesTab'
import KeyMetricsTab from './components/tabs/KeyMetricsTab'
import { isFullMode } from './config/mode'

type Tab = 'upload' | 'funnel' | 'distribution' | 'keymetrics' | 'methodology' | 'anomalies'

const TABS_FULL: { id: Tab; label: string; needsData?: true }[] = [
  { id: 'upload',       label: '📂 Загрузка' },
  { id: 'funnel',       label: '📊 Воронка',        needsData: true },
  { id: 'distribution', label: '📈 Распределение',  needsData: true },
  { id: 'keymetrics',   label: '🔑 Ключевые метрики', needsData: true },
  { id: 'methodology',  label: 'Методология' },
  { id: 'anomalies',    label: '🔧 Тех. вкладка',    needsData: true },
]

const TABS_LIMITED: { id: Tab; label: string; needsData?: true }[] = [
  { id: 'upload',     label: '📂 Загрузка' },
  { id: 'keymetrics', label: '🔑 Ключевые метрики', needsData: true },
]

const TABS = isFullMode ? TABS_FULL : TABS_LIMITED

function Spinner({ filename }: { filename: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
        <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-gray-700 font-medium">Обрабатываю файл…</p>
        <p className="text-gray-400 text-sm mt-1 max-w-xs">{filename}</p>
        <p className="text-gray-400 text-xs mt-2">Для большого файла может занять 10–30 секунд</p>
      </div>
    </div>
  )
}

export default function App() {
  const [tab, setTab]       = useState<Tab>('upload')
  const [result, setResult] = useState<AggregateResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [loadingName, setLoadingName] = useState('')
  const [error, setError]   = useState<string | null>(null)

  const handleFile = useCallback((data: ArrayBuffer, filename: string) => {
    setLoading(true)
    setLoadingName(filename)
    setError(null)
    setTimeout(() => {
      try {
        const rows = parseWorkbook(data)
        const agg  = aggregate(rows)
        setResult(agg)
        setTab('funnel')
      } catch (e) {
        setError(`Ошибка при разборе файла: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setLoading(false)
      }
    }, 50)
  }, [])

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-800 text-sm">Лояльность: ОСАГО ФЛ + Кросс Каско от бесполисных</span>
              {result && !loading && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {result.totals.total_quotes.toLocaleString('ru-RU')} котировок
                </span>
              )}
              {result && !loading && result.maxCreateDate && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  Данные по {new Date(result.maxCreateDate + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              )}
            </div>
            {result && !loading && (
              <button
                onClick={() => { setResult(null); setTab('upload') }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Загрузить другой файл
              </button>
            )}
          </div>

          <nav className="flex gap-0 -mb-px">
            {TABS.map(t => {
              const disabled = !!t.needsData && !result
              return (
                <button
                  key={t.id}
                  onClick={() => { if (!disabled && !loading) setTab(t.id) }}
                  disabled={disabled || loading}
                  className={`
                    px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                    ${tab === t.id
                      ? 'border-blue-600 text-blue-600'
                      : disabled || loading
                        ? 'border-transparent text-gray-300 cursor-not-allowed'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                  `}
                >
                  {t.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {loading && <Spinner filename={loadingName} />}

        {!loading && tab === 'upload'        && <UploadTab onFile={handleFile} />}
        {!loading && tab === 'funnel'        && result && <FunnelTab result={result} />}
        {!loading && tab === 'distribution'  && result && <DistributionTab result={result} />}
        {!loading && tab === 'keymetrics'    && result && <KeyMetricsTab rawRows={result.rawRows} />}
        {!loading && tab === 'methodology'   && <MethodologyTab />}
        {!loading && tab === 'anomalies'     && result && <AnomaliesTab rawRows={result.rawRows} />}

        {!loading && !isFullMode && result && tab === 'upload' && (
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            <p className="text-lg font-medium text-gray-500">Аналитика загружена</p>
            <p className="text-sm mt-1">Разделы этой версии дашборда появятся здесь</p>
          </div>
        )}
      </main>
    </div>
  )
}
