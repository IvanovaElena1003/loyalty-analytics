import { useState, useRef, useEffect } from 'react'
import { CURATOR_CODES, DIRECTOR_CODE } from '../lib/credentials'

const CURATORS = Object.keys(CURATOR_CODES).filter(c => c !== '@ТЕСТ @').sort()

export type AuthSession =
  | { role: 'director' }
  | { role: 'curator'; name: string }

interface Props {
  onAuth: (session: AuthSession) => void
}

export default function LoginScreen({ onAuth }: Props) {
  const [mode, setMode] = useState<'curator' | 'director'>('curator')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [code, setCode] = useState('')
  const [dirCode, setDirCode] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query.length >= 2
    ? CURATORS.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : CURATORS.slice(0, 8)

  useEffect(() => { setError('') }, [selected, code, dirCode, mode])

  function submitCurator() {
    if (!selected) { setError('Выберите куратора'); return }
    if (!code.trim()) { setError('Введите код'); return }
    if (CURATOR_CODES[selected] !== code.trim()) { setError('Неверный код'); return }
    onAuth({ role: 'curator', name: selected })
  }

  function submitDirector() {
    if (dirCode.trim() !== DIRECTOR_CODE) { setError('Неверный код директора'); return }
    onAuth({ role: 'director' })
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 px-4" style={{ background: 'var(--bg-bg-secondary)' }}>
      <div className="ren-card w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <img src="/renins-logo.svg" alt="Ренессанс страхование" className="h-8 mx-auto mb-4" />
          <h1 className="ren-card__title text-lg">Лояльность: ключевые метрики</h1>
          <p className="ren-card__subtitle">Войдите, чтобы просмотреть данные</p>
        </div>

        <div className="ren-segmented w-full mb-6">
          <button
            type="button"
            onClick={() => { setMode('curator'); setError('') }}
            className={`ren-segmented__btn flex-1 w-1/2 ${mode === 'curator' ? 'ren-segmented__btn--active' : ''}`}
          >
            Я куратор
          </button>
          <button
            type="button"
            onClick={() => { setMode('director'); setError('') }}
            className={`ren-segmented__btn flex-1 w-1/2 ${mode === 'director' ? 'ren-segmented__btn--active' : ''}`}
          >
            Я директор
          </button>
        </div>

        {mode === 'curator' ? (
          <div className="flex flex-col gap-4">
            <div className="relative">
              <label className="ren-label">Куратор</label>
              <input
                ref={inputRef}
                type="text"
                placeholder="Начните вводить имя…"
                value={selected || query}
                onChange={e => {
                  setQuery(e.target.value)
                  setSelected('')
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                className="ren-input"
              />
              {open && (
                <div className="absolute z-10 w-full mt-1 ren-card max-h-52 overflow-y-auto shadow-lg">
                  {filtered.length === 0
                    ? <div className="px-3 py-2 text-sm ren-text-secondary">Не найдено</div>
                    : filtered.map(c => (
                      <button
                        key={c}
                        type="button"
                        onMouseDown={() => {
                          setSelected(c)
                          setQuery('')
                          setOpen(false)
                          inputRef.current?.blur()
                        }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-brand-primary-00)] ${c === selected ? 'ren-text-brand font-medium' : ''}`}
                      >
                        {c}
                      </button>
                    ))
                  }
                </div>
              )}
            </div>

            <div>
              <label className="ren-label">Код доступа</label>
              <input
                type="text"
                placeholder="4 символа"
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitCurator()}
                maxLength={4}
                className="ren-input font-mono tracking-widest"
              />
            </div>

            {error && <p className="ren-field-error">{error}</p>}

            <button type="button" onClick={submitCurator} className="ren-btn ren-btn--primary w-full py-3">
              Войти
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="ren-label">Код директора</label>
              <input
                type="password"
                placeholder="Введите код"
                value={dirCode}
                onChange={e => setDirCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitDirector()}
                className="ren-input font-mono"
              />
            </div>

            {error && <p className="ren-field-error">{error}</p>}

            <button type="button" onClick={submitDirector} className="ren-btn ren-btn--primary w-full py-3">
              Войти как директор
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
