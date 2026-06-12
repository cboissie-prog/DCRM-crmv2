import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import { formatRelative } from '../../lib/utils'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import {
  Plus, Pencil, Trash2, Zap, AlertTriangle, CheckCircle2,
  XCircle, Clock, ChevronDown, ChevronUp, ScrollText,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Automation {
  id: string
  name: string
  description?: string
  trigger: string
  conditions: string
  actions: string
  isActive: boolean
  lastRunAt?: string
  successCount: number
  errorCount: number
  createdAt: string
}

interface AutomationLog {
  id: string
  triggeredBy?: string
  result?: string
  success: boolean
  createdAt: string
}

interface ActionDef { type: string; params: Record<string, string> }

// ── Config ─────────────────────────────────────────────────────────────────────

const TRIGGERS: Record<string, { label: string; description: string; category: 'event' | 'scheduled'; conditionFields: ConditionField[] }> = {
  TICKET_CREATED:            { label: 'Ticket créé',               description: 'Se déclenche dès qu\'un ticket est ouvert',                     category: 'event',     conditionFields: [{ key: 'priority', label: 'Priorité', type: 'multiselect', options: ['LOW','MEDIUM','HIGH','CRITICAL'] }, { key: 'category', label: 'Catégorie', type: 'text' }] },
  TICKET_RESOLVED:           { label: 'Ticket résolu',             description: 'Se déclenche quand un ticket passe en Résolu ou Fermé',          category: 'event',     conditionFields: [{ key: 'priority', label: 'Priorité', type: 'multiselect', options: ['LOW','MEDIUM','HIGH','CRITICAL'] }] },
  TICKET_ASSIGNED:           { label: 'Ticket assigné',            description: 'Se déclenche quand un ticket est assigné à un technicien',       category: 'event',     conditionFields: [] },
  TICKET_OVERDUE:            { label: 'Ticket en retard',          description: 'Se déclenche si un ticket reste ouvert trop longtemps',          category: 'scheduled', conditionFields: [{ key: 'hoursOpen', label: 'Heures sans mise à jour', type: 'number', placeholder: '24' }] },
  OPPORTUNITY_CREATED:       { label: 'Opportunité créée',         description: 'Se déclenche quand une opportunité est créée ou un lead converti', category: 'event',    conditionFields: [] },
  OPPORTUNITY_STAGE_CHANGED: { label: 'Étape opportunité changée', description: 'Se déclenche lors d\'un changement d\'étape dans le pipeline',   category: 'event',     conditionFields: [{ key: 'fromStage', label: 'Depuis l\'étape', type: 'text', placeholder: 'ex: QUALIFICATION' }, { key: 'toStage', label: 'Vers l\'étape', type: 'text', placeholder: 'ex: WON' }] },
  OPPORTUNITY_INACTIVE:      { label: 'Opportunité inactive',      description: 'Se déclenche si une opportunité n\'a pas bougé depuis N jours',  category: 'scheduled', conditionFields: [{ key: 'inactiveDays', label: 'Jours sans activité', type: 'number', placeholder: '15' }] },
  CONTRACT_EXPIRING:         { label: 'Contrat expirant',          description: 'Se déclenche N jours avant l\'expiration d\'un contrat',         category: 'scheduled', conditionFields: [{ key: 'daysBeforeExpiry', label: 'Jours avant expiration', type: 'number', placeholder: '30' }] },
  LEAD_SCORE_THRESHOLD:      { label: 'Score lead atteint',        description: 'Se déclenche quand un lead atteint un score minimum',            category: 'event',     conditionFields: [{ key: 'minScore', label: 'Score minimum', type: 'number', placeholder: '70' }] },
}

interface ConditionField {
  key:          string
  label:        string
  type:         'text' | 'number' | 'multiselect'
  options?:     string[]
  placeholder?: string
}

const ACTION_TYPES: Record<string, { label: string; description: string; paramFields: ParamField[] }> = {
  NOTIFY_USER:             { label: 'Notifier un utilisateur',  description: 'Envoie une notification in-app',        paramFields: [{ key: 'target',   label: 'Destinataire', type: 'select', options: [['assignee','Responsable du ticket/opportunité'],['creator','Créateur'],['role','Tous les utilisateurs d\'un rôle']] }, { key: 'role',    label: 'Rôle (si "Rôle")', type: 'select', options: [['ADMIN','Admin'],['MANAGER','Manager'],['COMMERCIAL','Commercial'],['TECHNICIEN','Technicien']], showIf: { key: 'target', value: 'role' } }, { key: 'message', label: 'Message personnalisé', type: 'text', placeholder: 'Optionnel' }] },
  NOTIFY_ROLE:             { label: 'Notifier un rôle entier',  description: 'Notifie tous les utilisateurs d\'un rôle', paramFields: [{ key: 'role', label: 'Rôle', type: 'select', options: [['ADMIN','Admin'],['MANAGER','Manager'],['COMMERCIAL','Commercial'],['TECHNICIEN','Technicien']] }, { key: 'message', label: 'Message', type: 'text', placeholder: 'Optionnel' }] },
  CREATE_ACTIVITY:         { label: 'Créer une activité',       description: 'Ajoute une activité sur le client',     paramFields: [{ key: 'title', label: 'Titre de l\'activité', type: 'text', placeholder: 'Relance client' }, { key: 'type', label: 'Type', type: 'select', options: [['CALL','Appel'],['EMAIL','Email'],['MEETING','Réunion'],['NOTE','Note'],['TASK','Tâche']] }] },
  CHANGE_TICKET_STATUS:    { label: 'Changer statut ticket',    description: 'Modifie le statut d\'un ticket',        paramFields: [{ key: 'status', label: 'Nouveau statut', type: 'select', options: [['IN_PROGRESS','En cours'],['WAITING_CLIENT','En attente client'],['RESOLVED','Résolu'],['CLOSED','Fermé']] }] },
  CHANGE_TICKET_PRIORITY:  { label: 'Changer priorité ticket',  description: 'Modifie la priorité d\'un ticket',      paramFields: [{ key: 'priority', label: 'Nouvelle priorité', type: 'select', options: [['LOW','Basse'],['MEDIUM','Moyenne'],['HIGH','Haute'],['CRITICAL','Critique']] }] },
}

interface ParamField {
  key:          string
  label:        string
  type:         'text' | 'select'
  options?:     [string, string][]
  placeholder?: string
  showIf?:      { key: string; value: string }
}

const PRIORITY_LABELS: Record<string, string> = { LOW: 'Basse', MEDIUM: 'Moyenne', HIGH: 'Haute', CRITICAL: 'Critique' }

const TEMPLATES: { name: string; trigger: string; conditions: Record<string, string | string[] | number>; actions: ActionDef[] }[] = [
  { name: 'Ticket critique → alerte manager', trigger: 'TICKET_CREATED', conditions: { priority: ['CRITICAL'] }, actions: [{ type: 'NOTIFY_ROLE', params: { role: 'MANAGER', message: 'Un ticket critique vient d\'être ouvert' } }] },
  { name: 'Ticket en retard 24h → rappel', trigger: 'TICKET_OVERDUE', conditions: { hoursOpen: 24 }, actions: [{ type: 'NOTIFY_USER', params: { target: 'assignee', message: 'Ce ticket n\'a pas été mis à jour depuis 24h' } }] },
  { name: 'Opportunité inactive 15j → tâche', trigger: 'OPPORTUNITY_INACTIVE', conditions: { inactiveDays: 15 }, actions: [{ type: 'CREATE_ACTIVITY', params: { title: 'Relance opportunité inactive', type: 'TASK' } }] },
  { name: 'Contrat expire dans 30j → notification', trigger: 'CONTRACT_EXPIRING', conditions: { daysBeforeExpiry: 30 }, actions: [{ type: 'NOTIFY_ROLE', params: { role: 'COMMERCIAL', message: 'Un contrat expire dans 30 jours' } }] },
  { name: 'Opportunité gagnée → notif équipe', trigger: 'OPPORTUNITY_STAGE_CHANGED', conditions: { toStage: 'WON' }, actions: [{ type: 'NOTIFY_ROLE', params: { role: 'MANAGER', message: 'Une opportunité a été gagnée !' } }] },
]

// ── Form state ─────────────────────────────────────────────────────────────────

interface FormState {
  name:        string
  description: string
  trigger:     string
  isActive:    boolean
  conditions:  Record<string, string | string[]>
  actions:     ActionDef[]
}

const emptyForm = (): FormState => ({
  name: '', description: '', trigger: '', isActive: true, conditions: {}, actions: [],
})

function formToPayload(f: FormState) {
  return {
    name:        f.name,
    description: f.description || undefined,
    trigger:     f.trigger,
    isActive:    f.isActive,
    conditions:  JSON.stringify(f.conditions),
    actions:     JSON.stringify(f.actions),
  }
}

function automationToForm(a: Automation): FormState {
  let conditions: Record<string, string | string[]> = {}
  let actions: ActionDef[] = []
  try { conditions = JSON.parse(a.conditions || '{}') } catch { /* */ }
  try { actions    = JSON.parse(a.actions    || '[]') } catch { /* */ }
  return { name: a.name, description: a.description ?? '', trigger: a.trigger, isActive: a.isActive, conditions, actions }
}

// ── Automation card ────────────────────────────────────────────────────────────

function AutomationCard({ a, onEdit, onDelete, onToggle, isToggling, onLogs }: {
  a: Automation
  onEdit:    () => void
  onDelete:  () => void
  onToggle:  () => void
  onLogs:    () => void
  isToggling: boolean
}) {
  const trig = TRIGGERS[a.trigger]
  let actions: ActionDef[] = []
  try { actions = JSON.parse(a.actions || '[]') } catch { /* */ }

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm transition-all hover:shadow-md ${a.isActive ? 'border-slate-200' : 'border-slate-100 opacity-70'}`}>
      <div className={`h-1 w-full ${a.isActive ? 'bg-violet-500' : 'bg-slate-200'}`} />
      <div className="p-5 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${a.isActive ? 'bg-violet-100' : 'bg-slate-100'}`}>
              <Zap className={`w-4 h-4 ${a.isActive ? 'text-violet-600' : 'text-slate-400'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{a.name}</p>
              {a.description && <p className="text-xs text-slate-500 truncate mt-0.5">{a.description}</p>}
            </div>
          </div>
          <button
            onClick={onToggle}
            disabled={isToggling}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 mt-0.5 ${a.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${a.isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>

        {/* Trigger */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Si</span>
          <span className="text-xs font-medium px-2.5 py-1 bg-violet-50 text-violet-700 rounded-full">
            {trig?.label ?? a.trigger}
          </span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${trig?.category === 'scheduled' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
            {trig?.category === 'scheduled' ? 'Planifié' : 'Événement'}
          </span>
        </div>

        {/* Actions */}
        <div className="space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Alors</span>
          <div className="flex flex-wrap gap-1">
            {actions.map((act, i) => (
              <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                {ACTION_TYPES[act.type]?.label ?? act.type}
              </span>
            ))}
          </div>
        </div>

        {/* Stats + actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{a.successCount}
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5 text-red-400" />{a.errorCount}
            </span>
            {a.lastRunAt && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />{formatRelative(a.lastRunAt)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onLogs} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="Voir les logs">
              <ScrollText className="w-3.5 h-3.5" />
            </button>
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary-600 transition-colors" title="Modifier">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Supprimer">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Automation Form ────────────────────────────────────────────────────────────

function AutomationForm({ form, setForm, onSubmit, isPending, onCancel, submitLabel }: {
  form:         FormState
  setForm:      React.Dispatch<React.SetStateAction<FormState>>
  onSubmit:     () => void
  isPending:    boolean
  onCancel:     () => void
  submitLabel:  string
}) {
  const trigConf = TRIGGERS[form.trigger]

  const setCondition = (key: string, value: string | string[]) =>
    setForm(f => ({ ...f, conditions: { ...f.conditions, [key]: value } }))

  const addAction = () =>
    setForm(f => ({ ...f, actions: [...f.actions, { type: 'NOTIFY_USER', params: { target: 'assignee' } }] }))

  const removeAction = (i: number) =>
    setForm(f => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }))

  const setActionType = (i: number, type: string) =>
    setForm(f => {
      const actions = [...f.actions]
      actions[i] = { type, params: {} }
      return { ...f, actions }
    })

  const setActionParam = (i: number, key: string, value: string) =>
    setForm(f => {
      const actions = [...f.actions]
      actions[i] = { ...actions[i], params: { ...actions[i].params, [key]: value } }
      return { ...f, actions }
    })

  return (
    <div className="space-y-5">
      {/* Base */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="label">Nom *</label>
          <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex : Ticket critique → alerte manager" />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optionnel" />
        </div>
      </div>

      {/* Trigger */}
      <div className="p-4 bg-violet-50/60 border border-violet-100 rounded-xl space-y-3">
        <p className="text-sm font-semibold text-violet-800">🔔 Déclencheur</p>
        <select
          className="input bg-white"
          value={form.trigger}
          onChange={e => setForm(f => ({ ...f, trigger: e.target.value, conditions: {} }))}
        >
          <option value="">— Choisir un déclencheur —</option>
          {[['event','Événements en temps réel'],['scheduled','Vérifications planifiées']] .map(([cat, catLabel]) => (
            <optgroup key={cat} label={catLabel}>
              {Object.entries(TRIGGERS).filter(([, v]) => v.category === cat).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {trigConf && <p className="text-xs text-violet-600">{trigConf.description}</p>}

        {/* Condition fields */}
        {trigConf && trigConf.conditionFields.length > 0 && (
          <div className="space-y-3 pt-1">
            <p className="text-xs font-semibold text-slate-500">Conditions (optionnelles)</p>
            {trigConf.conditionFields.map(field => (
              <div key={field.key}>
                <label className="label text-xs">{field.label}</label>
                {field.type === 'multiselect' && field.options ? (
                  <div className="flex flex-wrap gap-2">
                    {field.options.map(opt => {
                      const current = (form.conditions[field.key] as string[] | undefined) ?? []
                      const checked = current.includes(opt)
                      return (
                        <label key={opt} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-colors ${checked ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-600 hover:border-violet-300'}`}>
                          <input type="checkbox" className="sr-only" checked={checked} onChange={() => {
                            const next = checked ? current.filter(v => v !== opt) : [...current, opt]
                            setCondition(field.key, next)
                          }} />
                          {PRIORITY_LABELS[opt] ?? opt}
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    className="input bg-white text-sm"
                    type={field.type === 'number' ? 'number' : 'text'}
                    placeholder={field.placeholder}
                    value={(form.conditions[field.key] as string) ?? ''}
                    onChange={e => setCondition(field.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-emerald-800">⚡ Actions</p>
          <button type="button" onClick={addAction} className="text-xs text-emerald-700 font-medium hover:text-emerald-800 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Ajouter une action
          </button>
        </div>

        {form.actions.length === 0 && (
          <p className="text-xs text-emerald-600 text-center py-2">Aucune action — cliquez sur "Ajouter"</p>
        )}

        {form.actions.map((action, i) => {
          const actConf = ACTION_TYPES[action.type]
          return (
            <div key={i} className="bg-white border border-emerald-200 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <select
                  className="input flex-1 text-sm"
                  value={action.type}
                  onChange={e => setActionType(i, e.target.value)}
                >
                  {Object.entries(ACTION_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <button onClick={() => removeAction(i)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 flex-shrink-0">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
              {actConf?.description && <p className="text-xs text-slate-400">{actConf.description}</p>}
              {actConf?.paramFields.map(field => {
                if (field.showIf && action.params[field.showIf.key] !== field.showIf.value) return null
                return (
                  <div key={field.key}>
                    <label className="label text-xs">{field.label}</label>
                    {field.type === 'select' ? (
                      <select className="input text-sm" value={action.params[field.key] ?? ''} onChange={e => setActionParam(i, field.key, e.target.value)}>
                        <option value="">— Choisir —</option>
                        {field.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    ) : (
                      <input className="input text-sm" placeholder={field.placeholder} value={action.params[field.key] ?? ''} onChange={e => setActionParam(i, field.key, e.target.value)} />
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Active */}
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          type="button"
          onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
        </button>
        <span className="text-sm text-slate-700">Activer immédiatement</span>
      </label>

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !form.name || !form.trigger || form.actions.length === 0}
          className="btn-primary"
        >
          {isPending ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </div>
  )
}

// ── Logs panel ─────────────────────────────────────────────────────────────────

function LogsPanel({ automationId, onClose }: { automationId: string; onClose: () => void }) {
  const { data: logs = [], isLoading } = useQuery<AutomationLog[]>({
    queryKey: ['automation-logs', automationId],
    queryFn: async () => { const { data } = await api.get(`/automations/${automationId}/logs`); return data.data ?? [] },
    staleTime: 10_000,
  })

  return (
    <div className="space-y-3">
      {isLoading ? <PageSpinner /> : logs.length === 0 ? (
        <p className="text-center py-8 text-slate-400 text-sm">Aucune exécution enregistrée</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {logs.map(log => (
            <div key={log.id} className="flex items-start gap-3 py-3">
              {log.success
                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                : <XCircle    className="w-4 h-4 text-red-400    flex-shrink-0 mt-0.5" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700">{log.triggeredBy ?? 'Déclencheur inconnu'}</p>
                {log.result && log.result !== 'OK' && (
                  <p className="text-xs text-slate-500 truncate mt-0.5">{log.result}</p>
                )}
              </div>
              <span className="text-xs text-slate-400 flex-shrink-0">{formatRelative(log.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end pt-2 border-t border-slate-100">
        <button className="btn-secondary" onClick={onClose}>Fermer</button>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export function AutomationsPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)

  const [showCreate,   setShowCreate]   = useState(false)
  const [editingAuto,  setEditingAuto]  = useState<Automation | null>(null)
  const [deletingAuto, setDeletingAuto] = useState<Automation | null>(null)
  const [logsFor,      setLogsFor]      = useState<string | null>(null)
  const [formCreate,   setFormCreate]   = useState<FormState>(emptyForm())
  const [formEdit,     setFormEdit]     = useState<FormState>(emptyForm())
  const [showTemplates, setShowTemplates] = useState(false)

  const { data, isLoading } = useQuery<{ data: Automation[] }>({
    queryKey: ['automations'],
    queryFn: async () => { const { data } = await api.get('/automations'); return data },
    staleTime: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof formToPayload>) => api.post('/automations', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['automations'] }); setShowCreate(false); toast.success('Automatisation créée') },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof formToPayload> }) => api.put(`/automations/${id}`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['automations'] }); setEditingAuto(null); toast.success('Automatisation modifiée') },
    onError: () => toast.error('Erreur'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/automations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['automations'] }); setDeletingAuto(null); toast.success('Supprimée') },
    onError: () => toast.error('Erreur'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/automations/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
    onError: () => toast.error('Erreur'),
  })

  const automations = data?.data ?? []
  const active = automations.filter(a => a.isActive).length

  const openCreate = (template?: typeof TEMPLATES[0]) => {
    if (template) {
      setFormCreate({
        name: template.name, description: '', trigger: template.trigger, isActive: true,
        conditions: Object.fromEntries(
          Object.entries(template.conditions).map(([k, v]) => [k, Array.isArray(v) ? v : String(v)])
        ) as Record<string, string | string[]>,
        actions: template.actions,
      })
    } else {
      setFormCreate(emptyForm())
    }
    setShowCreate(true)
  }

  const openEdit = (a: Automation) => {
    setEditingAuto(a)
    setFormEdit(automationToForm(a))
  }

  if (user?.role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 fade-in">
        <AlertTriangle className="w-12 h-12 text-amber-400" />
        <p className="text-lg font-semibold text-slate-700">Accès refusé</p>
        <p className="text-sm text-slate-400">Cette page est réservée aux administrateurs.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header flex-wrap gap-3">
        <div>
          <h1 className="page-title">Automatisations</h1>
          <p className="page-subtitle">{automations.length} règle{automations.length !== 1 ? 's' : ''} · {active} active{active !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={() => openCreate()}>
          <Plus className="w-4 h-4" /> Nouvelle règle
        </button>
      </div>

      {isLoading ? <PageSpinner /> : (
        <>
          {automations.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Zap className="w-8 h-8 text-violet-400" />
              </div>
              <p className="font-medium text-slate-600 mb-1">Aucune automatisation configurée</p>
              <p className="text-sm mb-6">Créez votre première règle ou utilisez un modèle prédéfini</p>
              <button onClick={() => setShowTemplates(v => !v)} className="btn-secondary mx-auto flex items-center gap-2">
                {showTemplates ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Voir les modèles
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {automations.map(a => (
                <AutomationCard
                  key={a.id}
                  a={a}
                  onEdit={() => openEdit(a)}
                  onDelete={() => setDeletingAuto(a)}
                  onToggle={() => toggleMutation.mutate({ id: a.id, isActive: !a.isActive })}
                  onLogs={() => setLogsFor(a.id)}
                  isToggling={toggleMutation.isPending}
                />
              ))}
            </div>
          )}

          {/* Templates */}
          {(showTemplates || automations.length > 0) && (
            <div>
              <button
                onClick={() => setShowTemplates(v => !v)}
                className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 mb-3"
              >
                {showTemplates ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Modèles prédéfinis
              </button>
              {showTemplates && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {TEMPLATES.map(t => (
                    <div key={t.name} className="bg-white border border-dashed border-slate-300 rounded-2xl p-4 hover:border-violet-300 hover:bg-violet-50/30 transition-colors">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Zap className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{TRIGGERS[t.trigger]?.label}</p>
                        </div>
                      </div>
                      <button className="btn-secondary btn-sm w-full justify-center text-xs" onClick={() => openCreate(t)}>
                        Utiliser ce modèle
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle automatisation" size="lg">
        <AutomationForm
          form={formCreate}
          setForm={setFormCreate}
          onSubmit={() => createMutation.mutate(formToPayload(formCreate))}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          submitLabel="Créer"
        />
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editingAuto} onClose={() => setEditingAuto(null)} title="Modifier l'automatisation" size="lg">
        <AutomationForm
          form={formEdit}
          setForm={setFormEdit}
          onSubmit={() => editingAuto && editMutation.mutate({ id: editingAuto.id, payload: formToPayload(formEdit) })}
          isPending={editMutation.isPending}
          onCancel={() => setEditingAuto(null)}
          submitLabel="Enregistrer"
        />
      </Modal>

      {/* Logs Modal */}
      <Modal open={!!logsFor} onClose={() => setLogsFor(null)} title="Historique d'exécution" size="md">
        {logsFor && <LogsPanel automationId={logsFor} onClose={() => setLogsFor(null)} />}
      </Modal>

      {/* Delete Modal */}
      <Modal open={!!deletingAuto} onClose={() => setDeletingAuto(null)} title="Supprimer l'automatisation" size="sm">
        <p className="text-slate-600 mb-6">Supprimer <strong>{deletingAuto?.name}</strong> ? Cette action est irréversible.</p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingAuto(null)}>Annuler</button>
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
            onClick={() => deletingAuto && deleteMutation.mutate(deletingAuto.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
