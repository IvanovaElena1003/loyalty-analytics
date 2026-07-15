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
    <div className="fixed inset-0 bg-gray-50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔑</div>
          <h1 className="text-lg font-semibold text-gray-800">Лояльность: Ключевые метрики</h1>
          <p className="text-sm text-gray-400 mt-1">Войдите чтобы просмотреть данные</p>
        </div>

        <div className="flex rounded-lg border border-gray-200 mb-6 overflow-hidden">
          <button
            onClick={() => { setMode('curator'); setError('') }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'curator' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            Я куратор
          </button>
          <button
            onClick={() => { setMode('director'); setError('') }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'director' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            Я директор
          </button>
        </div>

        {mode === 'curator' ? (
          <div className="flex flex-col gap-4">
            {/* Curator search */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-500 mb-1">Куратор</label>
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
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {open && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                  {filtered.length === 0
                    ? <div className="px-3 py-2 text-sm text-gray-400">Не найдено</div>
                    : filtered.map(c => (
                      <button
                        key={c}
                        onMouseDown={() => {
                          setSelected(c)
                          setQuery('')
                          setOpen(false)
                          inputRef.current?.blur()
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${c === selected ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                      >
                        {c}
                      </button>
                    ))
                  }
                </div>
              )}
            </div>

            {/* Code */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Код доступа</label>
              <input
                type="text"
                placeholder="4 символа"
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitCurator()}
                maxLength={4}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && <p className="text-red-500 text-xs">{error}</p>}

            <button
              onClick={submitCurator}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Войти
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Код директора</label>
              <input
                type="password"
                placeholder="Введите код"
                value={dirCode}
                onChange={e => setDirCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitDirector()}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && <p className="text-red-500 text-xs">{error}</p>}

            <button
              onClick={submitDirector}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Войти как директор
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
