import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Upload, FileText, AlertCircle, CheckCircle2, ArrowLeft, ArrowRight,
  Download, Loader2,
} from 'lucide-react'
import api from '../../lib/api'
import { parseCsv } from '../../lib/parseCsv'
import { useReferences } from '../../hooks/useReferences'
import { useUsersList } from '../../hooks/useApi'
import { useAuthStore } from '../../store/authStore'
import { toast } from './Toast'
import { Modal } from './Modal'
import {
  CRM_FIELDS, autoDetectMapping, loadSavedMapping, saveMapping,
  type CrmField,
} from '../../lib/csvMapping'

interface Props {
  open: boolean
  onClose: () => void
  /** Pipeline pré-sélectionné pour les paramètres communs (ex. pipeline courant de la page) */
  defaultPipelineId?: string
}

interface ImportPipelineStage { id: string; key: string; name: string; order: number; isWon: boolean; isLost: boolean }
interface ImportPipeline { id: string; name: string; isDefault: boolean; stages: ImportPipelineStage[] }

type Step = 'file' | 'mapping' | 'review' | 'result'

interface ImportResult {
  created: { companies: number; contacts: number; opportunities: number }
  skipped: number
  errors: { row: number; reason: string }[]
}

const MAX_ROWS = 500
const MAX_SIZE = 2 * 1024 * 1024

export function ImportProspectsModal({ open, onClose, defaultPipelineId }: Props) {
  const qc = useQueryClient()
  const refs = useReferences()
  const { user } = useAuthStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Partial<Record<CrmField, string>>>({})
  const [pipelineId, setPipelineId] = useState<string>(defaultPipelineId ?? '')
  const [stage, setStage] = useState<string>('')
  const [source, setSource] = useState<string>('COLD_CALL')
  const [assignedToId, setAssignedToId] = useState<string>(user?.id ?? '')
  const [result, setResult] = useState<ImportResult | null>(null)

  const { data: pipelines = [] } = useQuery<ImportPipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data.data ?? [] },
    enabled: open,
    staleTime: 60_000,
  })
  const { data: users = [] } = useUsersList({ enabled: open })

  const selectedPipeline = pipelines.find(p => p.id === pipelineId) ?? pipelines.find(p => p.isDefault) ?? pipelines[0]
  const openStages = useMemo(
    () => [...(selectedPipeline?.stages ?? [])].sort((a, b) => a.order - b.order).filter(s => !s.isWon && !s.isLost),
    [selectedPipeline],
  )

  // Initialise pipeline/stage une fois les pipelines chargées — ajustement pendant le rendu
  // (pattern React recommandé), pas dans un effet : ce n'est pas une synchronisation avec un
  // système externe, juste une valeur dérivée des données qui viennent d'arriver.
  if (pipelines.length > 0 && !pipelineId) {
    const def = pipelines.find(p => p.isDefault) ?? pipelines[0]
    setPipelineId(def.id)
  }
  if (openStages.length > 0 && !stage) {
    setStage(openStages[0].key)
  }

  const resetAll = () => {
    setStep('file')
    setFileName('')
    setFileError(null)
    setHeaders([])
    setRawRows([])
    setMapping({})
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleClose = () => {
    resetAll()
    onClose()
  }

  // ── Étape 1 : fichier ──────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    setFileError(null)
    if (!file.name.toLowerCase().endsWith('.csv')) { setFileError('Fichier CSV requis (.csv)'); return }
    if (file.size > MAX_SIZE) { setFileError('Fichier trop volumineux (max 2 Mo)'); return }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCsv(text)
      if (parsed.length === 0) { setFileError('Aucune ligne trouvée dans le fichier'); return }
      if (parsed.length > MAX_ROWS) { setFileError(`Maximum ${MAX_ROWS} lignes par import (${parsed.length} trouvées)`); return }
      const hdrs = Object.keys(parsed[0])
      setHeaders(hdrs)
      setRawRows(parsed)
      const saved = loadSavedMapping(hdrs)
      setMapping(saved ?? autoDetectMapping(hdrs))
    }
    reader.readAsText(file, 'UTF-8')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const downloadTemplate = () => {
    const bom = '﻿'
    const headerLine = CRM_FIELDS.map(f => f.label).join(';')
    const exampleLine = [
      'DCB Technologies', 'Jean', 'Dupont', '0102030405', 'jean.dupont@exemple.fr',
      'Renouvellement parc informatique', '1200', 'Lyon', '69001', 'https://exemple.fr', '12345678900012', 'Rappeler après 14h',
    ].join(';')
    const blob = new Blob([bom + headerLine + '\n' + exampleLine], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'modele-import-prospects.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Étape 2 : correspondance ───────────────────────────────────────────────
  const setFieldMapping = (field: CrmField, header: string) => {
    setMapping(prev => ({ ...prev, [field]: header || undefined }))
  }

  // Entreprise OU contact (prénom/nom) : un particulier qui monte sa boutique n'a pas encore de société
  const companyMapped = !!mapping.companyName || !!mapping.firstName || !!mapping.lastName
  const missingCompanyCount = useMemo(() => {
    const has = (r: Record<string, string>, key?: string) => !!key && !!r[key]?.trim()
    return rawRows.filter(r => !has(r, mapping.companyName) && !has(r, mapping.firstName) && !has(r, mapping.lastName)).length
  }, [rawRows, mapping.companyName, mapping.firstName, mapping.lastName])

  // ── Étape 3 : import ───────────────────────────────────────────────────────
  const mappedRows = useMemo(() => {
    return rawRows.map(row => {
      const out: Record<string, string> = {}
      for (const field of CRM_FIELDS) {
        const header = mapping[field.key]
        if (header) out[field.key] = row[header] ?? ''
      }
      return out
    })
  }, [rawRows, mapping])

  const importMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/pipeline/opportunities/import/csv', {
        pipelineId: pipelineId || undefined,
        stage: stage || undefined,
        source: source || undefined,
        assignedToId: assignedToId || undefined,
        rows: mappedRows,
      })
      return data.data as ImportResult
    },
    onSuccess: (data) => {
      saveMapping(headers, mapping)
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      setResult(data)
      setStep('result')
      toast.success('Import terminé', `${data.created.opportunities} opportunité(s) créée(s), ${data.skipped} ligne(s) ignorée(s).`)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      toast.error(msg || "Erreur lors de l'import")
    },
  })

  const downloadSkippedReport = () => {
    if (!result) return
    const bom = '﻿'
    const header = ['Ligne', 'Raison', ...CRM_FIELDS.map(f => f.label)].join(';')
    const lines = result.errors.map(e => {
      // `e.row` est l'index 0-based de la ligne dans le tableau envoyé au serveur ;
      // on affiche un numéro de ligne 1-based, plus naturel pour l'utilisateur.
      const row = mappedRows[e.row] ?? {}
      const cells = [String(e.row + 1), e.reason, ...CRM_FIELDS.map(f => row[f.key] ?? '')]
      return cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')
    })
    const blob = new Blob([bom + header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'import-prospects-lignes-ignorees.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const titles: Record<Step, string> = {
    file: 'Importer des prospects — 1. Fichier',
    mapping: 'Importer des prospects — 2. Correspondance',
    review: 'Importer des prospects — 3. Récapitulatif',
    result: 'Importer des prospects — Résultat',
  }

  return (
    <Modal open={open} onClose={handleClose} title={titles[step]} size="lg">
      <div className="space-y-4">
        {/* ── Étape 1 : fichier ──────────────────────────────────────────── */}
        {step === 'file' && (
          <>
            <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-blue-700">
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span>Téléchargez le modèle CSV pour préparer vos données</span>
              </div>
              <button onClick={downloadTemplate} className="text-xs font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2 flex-shrink-0 ml-2">
                Modèle
              </button>
            </div>

            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                fileError ? 'border-red-300 bg-red-50' : rawRows.length ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-primary-300 hover:bg-primary-50/30'
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
              {rawRows.length > 0 ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  <p className="text-sm font-medium text-emerald-700">{fileName}</p>
                  <p className="text-xs text-emerald-600">{rawRows.length} ligne(s) prête(s) à importer</p>
                  <button onClick={e => { e.stopPropagation(); setHeaders([]); setRawRows([]); setFileName(''); if (inputRef.current) inputRef.current.value = '' }}
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

            {rawRows.length > 0 && (
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <p className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-100">Aperçu (5 premières lignes)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        {headers.map(h => <th key={h} className="px-2 py-1.5 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rawRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {headers.map(h => <td key={h} className="px-2 py-1.5 text-slate-600 whitespace-nowrap max-w-40 truncate">{row[h]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400">
              Formats acceptés : CSV (virgule ou point-virgule, UTF-8, BOM toléré). Max {MAX_ROWS} lignes, 2 Mo.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-secondary" onClick={handleClose}>Annuler</button>
              <button className="btn-primary" disabled={rawRows.length === 0} onClick={() => setStep('mapping')}>
                Suivant <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        {/* ── Étape 2 : correspondance ───────────────────────────────────── */}
        {step === 'mapping' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CRM_FIELDS.map(field => (
                <div key={field.key} className="form-group">
                  <label className="label">{field.label}{field.required && ' *'}</label>
                  <select
                    className="input"
                    value={mapping[field.key] ?? ''}
                    onChange={e => setFieldMapping(field.key, e.target.value)}
                  >
                    <option value="">— Ignorer —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {!companyMapped && (
              <p className="text-xs text-red-600 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> Associez au moins le champ Entreprise, ou Prénom/Nom du contact, à une colonne du fichier.
              </p>
            )}

            <hr className="border-slate-100" />

            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Paramètres communs</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="form-group">
                <label className="label">Pipeline</label>
                <select className="input" value={pipelineId} onChange={e => { setPipelineId(e.target.value); setStage('') }}>
                  {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Étape de départ</label>
                <select className="input" value={stage} onChange={e => setStage(e.target.value)}>
                  {openStages.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Source</label>
                <select className="input" value={source} onChange={e => setSource(e.target.value)}>
                  {refs.options('lead_source').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Commercial assigné</label>
                <select className="input" value={assignedToId} onChange={e => setAssignedToId(e.target.value)}>
                  <option value="">— Non assigné —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                </select>
              </div>
            </div>

            <div className="flex justify-between gap-3 pt-2">
              <button className="btn-secondary" onClick={() => setStep('file')}>
                <ArrowLeft className="w-4 h-4" /> Retour
              </button>
              <button className="btn-primary" disabled={!companyMapped} onClick={() => setStep('review')}>
                Suivant <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        {/* ── Étape 3 : récapitulatif ────────────────────────────────────── */}
        {step === 'review' && (
          <>
            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-1 text-sm">
              <p className="text-slate-700">
                <strong>{rawRows.length}</strong> ligne(s) au total
                {missingCompanyCount > 0 && (
                  <>, dont <strong className="text-amber-600">{missingCompanyCount}</strong> sans entreprise ni contact (ignorée{missingCompanyCount > 1 ? 's' : ''})</>
                )}
                .
              </p>
              <p className="text-slate-500 text-xs">
                Pipeline « {selectedPipeline?.name} » · étape « {openStages.find(s => s.key === stage)?.name ?? stage} » ·
                source « {refs.label('lead_source', source)} »
                {assignedToId && <> · assigné à {users.find(u => u.id === assignedToId)?.firstName} {users.find(u => u.id === assignedToId)?.lastName}</>}
              </p>
            </div>
            <div className="flex justify-between gap-3 pt-2">
              <button className="btn-secondary" onClick={() => setStep('mapping')}>
                <ArrowLeft className="w-4 h-4" /> Retour
              </button>
              <button className="btn-primary" disabled={importMutation.isPending} onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Importer {rawRows.length} ligne(s)
              </button>
            </div>
          </>
        )}

        {/* ── Résultat ───────────────────────────────────────────────────── */}
        {step === 'result' && result && (
          <>
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1 text-sm">
              <p className="text-emerald-800 font-medium">Import terminé</p>
              <p className="text-emerald-700">
                {result.created.opportunities} opportunité(s) créée(s)
                ({result.created.companies} entreprise(s), {result.created.contacts} contact(s))
              </p>
              {result.skipped > 0 && <p className="text-amber-700">{result.skipped} ligne(s) ignorée(s)</p>}
            </div>

            {result.errors.length > 0 && (
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <p className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-100">Lignes ignorées</p>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-2 py-1.5 text-left font-medium text-slate-500">Ligne</th>
                        <th className="px-2 py-1.5 text-left font-medium text-slate-500">Raison</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-600">{e.row + 1}</td>
                          <td className="px-2 py-1.5 text-slate-600">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-3 py-2 border-t border-slate-100">
                  <button onClick={downloadSkippedReport} className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700">
                    <Download className="w-3.5 h-3.5" /> Télécharger le rapport CSV
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-primary" onClick={handleClose}>Terminer</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
