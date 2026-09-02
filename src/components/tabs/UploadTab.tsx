import { useCallback, useState } from 'react'

interface Props {
  onFile: (data: ArrayBuffer, filename: string) => void
  onAgentFile?: (data: ArrayBuffer, filename: string) => void
  agentFilename?: string
}

function DropZone({
  onFile,
  label,
  sub,
  optional,
  loadedFilename,
}: {
  onFile: (data: ArrayBuffer, filename: string) => void
  label: string
  sub: string
  optional?: boolean
  loadedFilename?: string
}) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handle = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xlsb|xls)$/i)) {
      setError('Поддерживаются xlsx / xlsb / xls')
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
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handle(file)
  }, [handle])

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handle(file)
    e.target.value = ''
  }, [handle])

  const zoneClass = loadedFilename
    ? 'ren-dropzone ren-dropzone--loaded'
    : dragging
      ? 'ren-dropzone ren-dropzone--dragging'
      : 'ren-dropzone'

  return (
    <label
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={zoneClass}
    >
      <div className="text-4xl">{loadedFilename ? '✓' : '📂'}</div>
      <div className="text-center">
        {loadedFilename
          ? <>
              <p className="ren-text-brand font-medium text-sm">{loadedFilename}</p>
              <p className="ren-text-secondary text-xs mt-0.5">Загружен · нажмите чтобы заменить</p>
            </>
          : <>
              <p className="text-[var(--text-primary)] font-medium text-sm">{label}</p>
              <p className="ren-text-secondary text-xs mt-0.5">{sub}</p>
            </>
        }
      </div>
      <input type="file" accept=".xlsx,.xlsb,.xls" className="hidden" onChange={onInputChange} />
      {!loadedFilename && (
        <span className={`ren-btn text-xs ${optional ? 'ren-btn--secondary' : 'ren-btn--primary'}`}>
          Выбрать файл
        </span>
      )}
      {error && <p className="ren-field-error">{error}</p>}
    </label>
  )
}

export default function UploadTab({ onFile, onAgentFile, agentFilename }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold ren-text-brand mb-2">Аналитика лояльности ОСАГО ФЛ</h1>
        <p className="ren-text-secondary text-sm">Загрузите детализацию котировок из ЛК партнёра</p>
      </div>

      <DropZone
        onFile={onFile}
        label="Перетащите файл сюда или нажмите для выбора"
        sub="Поддерживаются форматы: xlsx, xlsb, xls"
      />

      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold ren-text-brand">Агентская сеть</span>
          <span className="text-sm ren-text-secondary">(опционально)</span>
        </div>
        <DropZone
          onFile={onAgentFile ?? (() => {})}
          label="Перетащите файл агентской сети или нажмите"
          sub="xlsx / xlsb / xls"
          optional
          loadedFilename={agentFilename}
        />
        <p className="text-xs ren-text-secondary mt-2 px-1">
          Загрузите для фильтров по Дивизиону, Филиалу, Управлению, КП, Куратору, Посреднику.
          Файл должен содержать колонку <code className="ren-bg-brand-soft px-1 rounded">subj_id</code> — она сопоставляется с&nbsp;CashbookId основного файла.
        </p>
      </div>

      <p className="text-xs ren-text-secondary max-w-sm text-center">
        Файлы обрабатываются локально в браузере — никуда не отправляются
      </p>
    </div>
  )
}
