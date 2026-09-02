import { useState, useCallback, useEffect } from 'react'
import { parseWorkbook, aggregate } from './utils/aggregate'
import type { AggregateResult, RawRow } from './types'
import UploadTab from './components/tabs/UploadTab'
import FunnelTab from './components/tabs/FunnelTab'
import MethodologyTab from './components/tabs/MethodologyTab'
import DistributionTab from './components/tabs/DistributionTab'
import AnomaliesTab from './components/tabs/AnomaliesTab'
import KeyMetricsTab from './components/tabs/KeyMetricsTab'
import LoginScreen, { type AuthSession } from './components/LoginScreen'
import { isFullMode } from './config/mode'
import { loadMainRowsFromDB, loadAgentRowsFromDB, saveMainRowsToDB, saveAgentRowsToDB } from './lib/db'

const DB_ENABLED = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

type Tab = 'upload' | 'funnel' | 'distribution' | 'keymetrics' | 'methodology' | 'anomalies'

const TABS_FULL: { id: Tab; label: string; needsData?: true }[] = [
  { id: 'upload',       label: 'Загрузка' },
  { id: 'funnel',       label: 'Воронка',        needsData: true },
  { id: 'distribution', label: 'Распределение',  needsData: true },
  { id: 'keymetrics',   label: 'Ключевые метрики', needsData: true },
  { id: 'methodology',  label: 'Методология' },
  { id: 'anomalies',    label: 'Тех. вкладка',    needsData: true },
]

const TABS_LIMITED: { id: Tab; label: string; needsData?: true }[] = [
  { id: 'keymetrics', label: 'Ключевые метрики', needsData: true },
]

const TABS = isFullMode ? TABS_FULL : TABS_LIMITED

function Spinner({ filename }: { filename: string }) {
  const isDb = filename.startsWith('Загружаем данные из базы')
  if (isDb) {
    return (
      <div className="fixed inset-0 bg-[var(--bg-content)] flex flex-col items-center justify-center gap-8 z-50">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 rounded-full border-4 ren-spinner opacity-30" />
            <div className="absolute inset-0 rounded-full border-4 ren-spinner border-t-transparent animate-spin" />
          </div>
          <div className="text-center">
            <p className="ren-text-brand font-semibold text-lg">Загружаем данные</p>
            <p className="ren-text-secondary text-sm mt-1">Это займёт несколько секунд</p>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 ren-spinner opacity-30" />
        <div className="absolute inset-0 rounded-full border-4 ren-spinner border-t-transparent animate-spin" />
      </div>
      <div className="text-center">
        <p className="font-medium ren-text-brand">Обрабатываю файл…</p>
        <p className="ren-text-secondary text-sm mt-1 max-w-xs">{filename}</p>
        <p className="ren-text-secondary text-xs mt-2">Для большого файла может занять 10–30 секунд</p>
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
  const [agentRows, setAgentRows]     = useState<RawRow[] | null>(null)
  const [agentFilename, setAgentFilename] = useState<string | undefined>()
  const [dbSaving, setDbSaving] = useState(false)
  const [session, setSession] = useState<AuthSession | null>(isFullMode ? { role: 'director' } : null)

  useEffect(() => {
    if (!DB_ENABLED) return
    let cancelled = false
    setLoading(true)
    setLoadingName('Загружаем данные из базы…')
    ;(async () => {
      try {
        const [mainRows, agRows] = await Promise.all([
          loadMainRowsFromDB(),
          loadAgentRowsFromDB(),
        ])
        if (cancelled) return
        if (mainRows && mainRows.length > 0) {
          const agg = aggregate(mainRows)
          setResult(agg)
          setTab(isFullMode ? 'funnel' : 'keymetrics')
        }
        if (agRows && agRows.length > 0) {
          setAgentRows(agRows)
        }
      } catch {
        // DB unavailable — fall through to upload screen
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleFile = useCallback((data: ArrayBuffer, filename: string) => {
    setLoading(true)
    setLoadingName(filename)
    setError(null)
    setTimeout(() => {
      try {
        const rows = parseWorkbook(data)
        const agg  = aggregate(rows)
        setResult(agg)
        setTab(isFullMode ? 'funnel' : 'keymetrics')
        if (DB_ENABLED) {
          setDbSaving(true)
          saveMainRowsToDB(rows)
            .catch(e => setError(`БД: ${e instanceof Error ? e.message : String(e)}`))
            .finally(() => setDbSaving(false))
        }
      } catch (e) {
        setError(`Ошибка при разборе файла: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setLoading(false)
      }
    }, 50)
  }, [])

  const handleAgentFile = useCallback((data: ArrayBuffer, filename: string) => {
    try {
      const rows = parseWorkbook(data)
      setAgentRows(rows)
      setAgentFilename(filename)
      if (DB_ENABLED) {
        saveAgentRowsToDB(rows)
          .catch(e => setError(`БД (агент. сеть): ${e instanceof Error ? e.message : String(e)}`))
      }
    } catch (e) {
      setError(`Ошибка при разборе файла агентской сети: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  if (!isFullMode && !session) {
    return <LoginScreen onAuth={setSession} />
  }

  const lockedCurator = (!isFullMode && session?.role === 'curator') ? session.name : undefined

  return (
    <div className="ren-page">
      <header className="ren-header">
        <div className="ren-container">
          <div className="ren-header__inner">
            <div className="ren-header__brand">
              <img src="/renins-logo.svg" alt="Ренессанс страхование" className="ren-header__logo" />
              <div className="min-w-0">
                <p className="ren-header__title">Лояльность: ОСАГО ФЛ + Кросс Каско</p>
                {result && !loading && result.maxCreateDate && (
                  <p className="text-xs ren-text-secondary mt-0.5">
                    Данные по {new Date(result.maxCreateDate + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                )}
              </div>
              {result && !loading && (
                <span className="ren-badge hidden sm:inline-flex">
                  {result.totals.total_quotes.toLocaleString('ru-RU')} котировок
                </span>
              )}
              {dbSaving && (
                <span className="ren-badge animate-pulse">Сохраняем в БД…</span>
              )}
            </div>
            {!isFullMode && session && (
              <div className="flex items-center gap-3">
                <span className="text-xs ren-text-secondary">
                  {session.role === 'director' ? 'Директор' : session.name.split(' ').slice(0, 2).join(' ')}
                </span>
                <button type="button" onClick={() => setSession(null)} className="ren-btn ren-btn--ghost">Выйти</button>
              </div>
            )}
            {result && !loading && isFullMode && (
              <button
                type="button"
                onClick={() => { setResult(null); setTab('upload') }}
                className="ren-link"
              >
                Загрузить другой файл
              </button>
            )}
          </div>

          <nav className="ren-tabs">
            {TABS.map(t => {
              const disabled = !!t.needsData && !result
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { if (!disabled && !loading) setTab(t.id) }}
                  disabled={disabled || loading}
                  className={`ren-tab ${tab === t.id ? 'ren-tab--active' : ''}`}
                >
                  {t.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="ren-container py-6">
        {error && <div className="ren-alert">{error}</div>}

        {loading && <Spinner filename={loadingName} />}

        {!loading && isFullMode  && tab === 'upload'       && <UploadTab onFile={handleFile} onAgentFile={handleAgentFile} agentFilename={agentFilename} />}
        {!loading && tab === 'funnel'        && result && <FunnelTab result={result} />}
        {!loading && tab === 'distribution'  && result && <DistributionTab result={result} />}
        {!loading && tab === 'keymetrics'    && result && <KeyMetricsTab rawRows={result.rawRows} agentRows={agentRows ?? undefined} lockedCurator={lockedCurator} />}
        {!loading && tab === 'methodology'   && <MethodologyTab />}
        {!loading && tab === 'anomalies'     && result && <AnomaliesTab rawRows={result.rawRows} />}

        {!loading && !isFullMode && !result && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center ren-card ren-card__body max-w-md mx-auto">
            <p className="font-medium ren-text-brand">Данные обновляются</p>
            <p className="ren-text-secondary text-sm">Попробуйте обновить страницу чуть позже</p>
          </div>
        )}
      </main>
    </div>
  )
}
