import { useCallback, useState } from 'react'

interface Props {
  onFile: (data: ArrayBuffer, filename: string) => void
}

export default function UploadTab({ onFile }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError('Поддерживаются только файлы .xlsx')
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = e => {
      if (e.target?.result instanceof ArrayBuffer) onFile(e.target.result, file.name)
    }
    reader.readAsArrayBuffer(file)
  }, [onFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-gray-800 mb-2">Аналитика лояльности ОСАГО ФЛ</h1>
        <p className="text-gray-500 text-sm">Загрузите детализацию котировок из ЛК партнёра</p>
      </div>

      <label
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`
          w-full max-w-lg border-2 border-dashed rounded-2xl p-12
          flex flex-col items-center gap-4 cursor-pointer transition-all
          ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'}
        `}
      >
        <div className="text-5xl">📊</div>
        <div className="text-center">
          <p className="text-gray-700 font-medium">Перетащите .xlsx файл сюда</p>
          <p className="text-gray-400 text-sm mt-1">или нажмите для выбора</p>
        </div>
        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onInputChange} />
        <span className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
          Выбрать файл
        </span>
      </label>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <p className="text-xs text-gray-400 max-w-sm text-center">
        Файл обрабатывается локально в браузере — никуда не отправляется
      </p>
    </div>
  )
}
