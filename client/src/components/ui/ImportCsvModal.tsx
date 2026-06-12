import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import { parseCsv } from '../../lib/parseCsv'
import { toast } from './Toast'
import { Modal } from './Modal'
import { Upload, FileText, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Spinner } from './Spinner'

interface Props {
  isOpen: boolean
  onClose: () => void
  entity: 'contacts' | 'companies'
  invalidateKeys: string[][]
  templateHeaders: string
  templateExample: string
}

type ImportResult = { created: number; skipped: number; total: number }

export function ImportCsvModal({ isOpen, onClose, entity, invalidateKeys, templateHeaders, templateExample }: Props) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)

  const mutation = useMutation<ImportResult, Error, Record<string, string>[]>({
    mutationFn: async (data) => {
      const res = await api.post(`/${entity}/import/csv`, { rows: data })
      return res.data.data as ImportResult
    },
    onSuccess: (result) => {
      invalidateKeys.forEach(k => qc.invalidateQueries({ queryKey: k }))
      toast.success(`Import terminé : ${result.created} créé(s), ${result.skipped} ignoré(s)`)
      handleClose()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      toast.error(msg || "Erreur lors de l'import")
    },
  })

  const handleFile = (file: File) => {
    setFileError(null)
    setRows(null)
    if (!file.name.endsWith('.csv')) { setFileError('Fichier CSV requis (.csv)'); return }
    if (file.size > 2 * 1024 * 1024) { setFileError('Fichier trop volumineux (max 2 Mo)'); return }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCsv(text)
      if (parsed.length === 0) { setFileError('Aucune ligne trouvée dans le fichier'); return }
      if (parsed.length > 500) { setFileError('Maximum 500 lignes par import'); return }
      setRows(parsed)
    }
    reader.readAsText(file, 'UTF-8')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleClose = () => {
    setRows(null)
    setFileName('')
    setFileError(null)
    if (inputRef.current) inputRef.current.value = ''
    onClose()
  }

  const downloadTemplate = () => {
    const bom = '\uFEFF'
    const csv = bom + templateHeaders + '\n' + templateExample
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `template-import-${entity}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal open={isOpen} onClose={handleClose} title={`Importer des ${entity === 'contacts' ? 'contacts' : 'entreprises'}`}>
      <div className="space-y-4">
        {/* Template download */}
        <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <FileText className="w-4 h-4 flex-shrink-0" />
            <span>Téléchargez le modèle CSV pour préparer vos données</span>
          </div>
          <button onClick={downloadTemplate} className="text-xs font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2 flex-shrink-0 ml-2">
            Modèle
          </button>
        </div>

        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            fileError ? 'border-red-300 bg-red-50' : rows ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-primary-300 hover:bg-primary-50/30'
          }`}
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {rows ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700">{fileName}</p>
              <p className="text-xs text-emerald-600">{rows.length} ligne(s) prête(s) à importer</p>
              <button onClick={e => { e.stopPropagation(); setRows(null); setFileName(''); if (inputRef.current) inputRef.current.value = '' }}
                className="text-xs text-slate-400 hover:text-slate-600 underline">
                Changer de fichier
              </button>
            </div>
          ) : fileError ? (
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-600">{fileError}</p>
              <p className="text-xs text-slate-400">Cliquez pour sélectionner un autre fichier</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">Glissez un fichier CSV ici</p>
              <p className="text-xs text-slate-400">ou cliquez pour parcourir</p>
            </div>
          )}
        </div>

        {/* Info */}
        <p className="text-xs text-slate-400">
          Formats acceptés : CSV (virgule ou point-virgule, UTF-8). Max 500 lignes.
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={handleClose} className="btn btn-secondary">Annuler</button>
          <button
            onClick={() => rows && mutation.mutate(rows)}
            disabled={!rows || mutation.isPending}
            className="btn btn-primary"
          >
            {mutation.isPending ? <><Spinner className="w-4 h-4" /> Import en cours…</> : `Importer ${rows ? `(${rows.length})` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
