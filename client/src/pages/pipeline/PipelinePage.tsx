import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import { useForm, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Euro, TrendingUp, Trophy,
  MoreHorizontal, Edit2, Trash2, ChevronRight,
  Building2, User, Calendar, X, Settings, GripVertical,
  ChevronDown, Pencil, Bell, BellOff, FileText, CalendarCheck, Phone, Zap,
} from 'lucide-react'
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatDate, cn } from '../../lib/utils'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import type { Opportunity, Contact, Company, User as UserType } from '../../types'

interface PipelineStage {
  id: string
  pipelineId: string
  key: string
  name: string
  color: string
  order: number
  isWon: boolean
  isLost: boolean
}

interface Pipeline {
  id: string
  name: string
  description?: string
  color: string
  isDefault: boolean
  stages: PipelineStage[]
  _count?: { opportunities: number }
}

// ─── Schéma de validation ────────────────────────────────────────────────────
const opportunitySchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  stage: z.string().min(1, 'Stage requis'),
  value: z.coerce.number().min(0, 'Valeur invalide'),
  probability: z.coerce.number().min(0).max(100, 'Entre 0 et 100'),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
  assignedToId: z.string().optional(),
})
type OpportunityForm = z.infer<typeof opportunitySchema>

// ─── Helpers couleurs dynamiques ─────────────────────────────────────────────
function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}
function stageBg(color: string) { return { background: `rgba(${hexToRgb(color)}, 0.08)`, borderColor: `rgba(${hexToRgb(color)}, 0.3)` } }
function stageDot(color: string) { return { background: color } }
function stageDropBg(color: string) { return { background: `rgba(${hexToRgb(color)}, 0.18)` } }

// ─── Tags config ─────────────────────────────────────────────────────────────
interface OppTag { type: string; scheduledAt?: string }

const TAG_CONFIG: Record<string, {
  label: string
  className: string
  icon: React.ElementType
  needsDate?: boolean
  appointmentType?: string
  durationMin?: number
}> = {
  DEVIS: { label: 'Devis envoyé',   className: 'bg-blue-50 text-blue-600 border-blue-100',          icon: FileText },
  RDV:   { label: 'RDV planifié',   className: 'bg-emerald-50 text-emerald-600 border-emerald-100',  icon: CalendarCheck, needsDate: true, appointmentType: 'CLIENT_MEETING', durationMin: 60 },
  APPEL: { label: 'Appel planifié', className: 'bg-violet-50 text-violet-600 border-violet-100',     icon: Phone,         needsDate: true, appointmentType: 'CALL',           durationMin: 30 },
}

function parseTags(tags?: string | null): OppTag[] {
  if (!tags) return []
  try { return JSON.parse(tags) } catch { return [] }
}
function removeTag(tags: OppTag[], type: string): OppTag[] {
  return tags.filter(t => t.type !== type)
}
function hasTag(tags: OppTag[], type: string): boolean {
  return tags.some(t => t.type === type)
}
function getTag(tags: OppTag[], type: string): OppTag | undefined {
  return tags.find(t => t.type === type)
}

// ─── Composant Card ───────────────────────────────────────────────────────────
interface OpportunityCardProps {
  opportunity: Opportunity
  index: number
  stages: PipelineStage[]
  onEdit: (opp: Opportunity) => void
  onDelete: (id: string) => void
  onStageChange: (id: string, stage: string) => void
  onQuickUpdate: (id: string, data: Record<string, unknown>) => void
  onScheduleTag: (oppId: string, tagType: string, scheduledAt: string) => void
}

function OpportunityCard({ opportunity: opp, index, stages, onEdit, onDelete, onStageChange, onQuickUpdate, onScheduleTag }: OpportunityCardProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showStageDropdown, setShowStageDropdown] = useState(false)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [actionsMenuPos, setActionsMenuPos] = useState<{ bottom: number; right: number } | null>(null)
  const [showReminderPicker, setShowReminderPicker] = useState(false)
  const [reminderValue, setReminderValue] = useState(opp.remindAt ? opp.remindAt.slice(0, 16) : '')
  const [datePicker, setDatePicker] = useState<{ type: string; value: string } | null>(null)
  const actionsButtonRef = useRef<HTMLButtonElement>(null)

  const oppTags = parseTags(opp.tags)

  const handleTagClick = (tagType: string) => {
    const cfg = TAG_CONFIG[tagType]
    if (hasTag(oppTags, tagType)) {
      // Retirer le tag
      onQuickUpdate(opp.id, { tags: JSON.stringify(removeTag(oppTags, tagType)) })
    } else if (cfg.needsDate) {
      // Ouvrir le date picker
      const existing = getTag(oppTags, tagType)
      setDatePicker({ type: tagType, value: existing?.scheduledAt?.slice(0, 16) ?? '' })
    } else {
      // Toggle simple (DEVIS)
      onQuickUpdate(opp.id, { tags: JSON.stringify([...oppTags, { type: tagType }]) })
    }
    setShowActionsMenu(false)
  }

  const handleSaveDatePicker = () => {
    if (!datePicker?.value) return
    onScheduleTag(opp.id, datePicker.type, datePicker.value)
    setDatePicker(null)
  }

  const handleSaveReminder = () => {
    onQuickUpdate(opp.id, { remindAt: reminderValue || null, _createAppointment: reminderValue ? { type: 'OTHER', title: `Rappel — ${opp.title}`, scheduledAt: reminderValue, contactId: opp.contactId } : undefined })
    setShowReminderPicker(false)
  }

  return (
    <Draggable draggableId={opp.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={cn(
            'bg-white rounded-xl border border-slate-200 p-4 shadow-sm cursor-grab select-none',
            'transition-shadow hover:shadow-md',
            snapshot.isDragging && 'shadow-2xl rotate-1 cursor-grabbing ring-2 ring-primary-400',
            (showActionsMenu || showReminderPicker || showMenu || showStageDropdown) && 'z-50',
          )}
        >
          {/* Header card */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <h4 className="text-sm font-semibold text-slate-900 leading-tight">{opp.title}</h4>
            <div className="relative flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(v => !v); setShowStageDropdown(false) }}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showMenu && (
                <div
                  className="absolute right-0 top-7 z-30 bg-white rounded-xl shadow-xl border border-slate-100 min-w-44 py-1"
                  onMouseLeave={() => setShowMenu(false)}
                >
                  <button
                    onClick={() => { onEdit(opp); setShowMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Modifier
                  </button>
                  <button
                    onClick={() => { setShowStageDropdown(true); setShowMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <ChevronRight className="w-3.5 h-3.5" /> Changer de stage
                  </button>
                  <hr className="my-1 border-slate-100" />
                  <button
                    onClick={() => { onDelete(opp.id); setShowMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Supprimer
                  </button>
                </div>
              )}
              {showStageDropdown && (
                <div className="absolute right-0 top-7 z-30 bg-white rounded-xl shadow-xl border border-slate-100 min-w-44 py-1">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Changer de stage</span>
                    <button onClick={() => setShowStageDropdown(false)}><X className="w-3.5 h-3.5 text-slate-400" /></button>
                  </div>
                  {stages.map(s => (
                    <button
                      key={s.key}
                      onClick={() => { onStageChange(opp.id, s.key); setShowStageDropdown(false) }}
                      className={cn(
                        'flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-slate-50',
                        opp.stage === s.key ? 'text-primary-700 font-semibold' : 'text-slate-700',
                      )}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={stageDot(s.color)} />
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Infos contact / entreprise */}
          <div className="space-y-1 mb-3">
            {opp.company && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="truncate">{opp.company.name}</span>
              </div>
            )}
            {opp.contact && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="truncate">{opp.contact.firstName} {opp.contact.lastName}</span>
              </div>
            )}
            {opp.expectedCloseDate && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{formatDate(opp.expectedCloseDate)}</span>
              </div>
            )}
          </div>

          {/* Tags actifs */}
          {(oppTags.length > 0 || opp.remindAt) && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {oppTags.map(tag => {
                const cfg = TAG_CONFIG[tag.type]
                if (!cfg) return null
                const Icon = cfg.icon
                return (
                  <span
                    key={tag.type}
                    className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', cfg.className, cfg.needsDate && 'cursor-pointer')}
                    onClick={cfg.needsDate ? (e) => { e.stopPropagation(); setDatePicker({ type: tag.type, value: tag.scheduledAt?.slice(0, 16) ?? '' }); setShowReminderPicker(false) } : undefined}
                    title={cfg.needsDate ? 'Cliquer pour modifier' : undefined}
                  >
                    <Icon className="w-3 h-3" />
                    {cfg.label}
                    {tag.scheduledAt && (
                      <span className="opacity-70">
                        {new Date(tag.scheduledAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </span>
                )
              })}
              {opp.remindAt && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-pointer',
                    new Date(opp.remindAt) <= new Date()
                      ? 'bg-red-50 text-red-600 border-red-100'
                      : 'bg-amber-50 text-amber-600 border-amber-100',
                  )}
                  onClick={(e) => { e.stopPropagation(); setShowReminderPicker(v => !v) }}
                  title="Cliquer pour modifier"
                >
                  <Bell className="w-3 h-3" />
                  {new Date(opp.remindAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}

          {/* Footer : valeur + proba */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <span className="text-sm font-bold text-slate-900">{formatCurrency(opp.value)}</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="w-16 bg-slate-100 rounded-full h-1.5">
                  <div className="bg-primary-500 h-1.5 rounded-full" style={{ width: `${opp.probability}%` }} />
                </div>
                <span className="text-xs text-slate-500">{opp.probability}%</span>
              </div>
              {/* Bouton Actions */}
              <button
                ref={actionsButtonRef}
                onClick={(e) => {
                  e.stopPropagation()
                  if (showActionsMenu) { setShowActionsMenu(false); return }
                  const rect = actionsButtonRef.current!.getBoundingClientRect()
                  setActionsMenuPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right })
                  setShowActionsMenu(true)
                  setShowReminderPicker(false)
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-50 border border-slate-200 text-slate-500 hover:bg-primary-50 hover:border-primary-200 hover:text-primary-600 transition-colors"
              >
                <Zap className="w-3 h-3" /> Actions
              </button>
              {showActionsMenu && actionsMenuPos && createPortal(
                <div
                  style={{ position: 'fixed', bottom: actionsMenuPos.bottom, right: actionsMenuPos.right }}
                  className="z-[9999] bg-white rounded-xl shadow-2xl border border-slate-100 min-w-52 py-1"
                  onMouseLeave={() => setShowActionsMenu(false)}
                >
                  <div className="px-3 py-1.5 border-b border-slate-100">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Actions rapides</span>
                  </div>
                  {Object.entries(TAG_CONFIG).map(([key, cfg]) => {
                    const Icon = cfg.icon
                    const active = hasTag(oppTags, key)
                    return (
                      <button
                        key={key}
                        onClick={() => handleTagClick(key)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {active ? `Retirer "${cfg.label}"` : cfg.label}
                        {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                      </button>
                    )
                  })}
                  <hr className="my-1 border-slate-100" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowReminderPicker(v => !v); setShowActionsMenu(false) }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Bell className="w-3.5 h-3.5 text-amber-500" />
                    {opp.remindAt ? 'Modifier le rappel' : 'À rappeler'}
                    {opp.remindAt && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                  </button>
                  {opp.remindAt && (
                    <button
                      onClick={() => { onQuickUpdate(opp.id, { remindAt: null }); setShowActionsMenu(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-400 hover:bg-slate-50"
                    >
                      <BellOff className="w-3.5 h-3.5" /> Supprimer le rappel
                    </button>
                  )}
                </div>,
                document.body
              )}
            </div>
          </div>

          {/* Reminder picker inline */}
          {showReminderPicker && (
            <div className="mt-2 p-2.5 bg-amber-50 border border-amber-100 rounded-lg" onClick={e => e.stopPropagation()}>
              <p className="text-xs text-amber-700 font-medium mb-1.5">Date et heure du rappel</p>
              <div className="flex gap-1.5">
                <input
                  type="datetime-local"
                  value={reminderValue}
                  onChange={e => setReminderValue(e.target.value)}
                  className="text-xs border border-amber-200 rounded-lg px-2 py-1 bg-white flex-1 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
                <button onClick={handleSaveReminder} className="px-2.5 py-1 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600">OK</button>
                <button onClick={() => setShowReminderPicker(false)} className="px-2 py-1 text-xs bg-white text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Date picker RDV / APPEL */}
          {datePicker && (
            <div
              className={cn(
                'mt-2 p-2.5 border rounded-lg',
                datePicker.type === 'RDV' ? 'bg-emerald-50 border-emerald-100' : 'bg-violet-50 border-violet-100',
              )}
              onClick={e => e.stopPropagation()}
            >
              <p className={cn('text-xs font-medium mb-1.5', datePicker.type === 'RDV' ? 'text-emerald-700' : 'text-violet-700')}>
                {datePicker.type === 'RDV' ? 'Date et heure du RDV' : 'Date et heure de l\'appel'}
              </p>
              <div className="flex gap-1.5">
                <input
                  type="datetime-local"
                  value={datePicker.value}
                  onChange={e => setDatePicker(d => d ? { ...d, value: e.target.value } : null)}
                  className={cn(
                    'text-xs border rounded-lg px-2 py-1 bg-white flex-1 focus:outline-none focus:ring-1',
                    datePicker.type === 'RDV' ? 'border-emerald-200 focus:ring-emerald-400' : 'border-violet-200 focus:ring-violet-400',
                  )}
                />
                <button
                  onClick={handleSaveDatePicker}
                  disabled={!datePicker.value}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium text-white rounded-lg disabled:opacity-40',
                    datePicker.type === 'RDV' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-violet-500 hover:bg-violet-600',
                  )}
                >
                  OK
                </button>
                <button onClick={() => setDatePicker(null)} className="px-2 py-1 text-xs bg-white text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}

// ─── Modale création/édition ──────────────────────────────────────────────────
interface OppModalProps {
  open: boolean
  onClose: () => void
  editing?: Opportunity | null
  defaultStage?: string
  pipelineId?: string
  stages: PipelineStage[]
  contacts: Contact[]
  companies: Company[]
  users: UserType[]
  canAssign: boolean
}

function OpportunityModal({ open, onClose, editing, defaultStage, pipelineId, stages, contacts, companies, users, canAssign }: OppModalProps) {
  const qc = useQueryClient()

  const { register, handleSubmit, reset, control, watch, setValue, formState: { errors, isSubmitting } } = useForm<OpportunityForm>({
    resolver: zodResolver(opportunitySchema) as Resolver<OpportunityForm>,
    defaultValues: {
      stage: defaultStage || 'NEW',
      probability: 20,
      value: 0,
    },
  })

  // Pré-remplir en mode édition
  const handleOpen = useCallback(() => {
    if (editing) {
      reset({
        title: editing.title,
        contactId: editing.contactId || '',
        companyId: editing.companyId || '',
        stage: editing.stage,
        value: editing.value,
        probability: editing.probability,
        expectedCloseDate: editing.expectedCloseDate
          ? editing.expectedCloseDate.split('T')[0]
          : '',
        notes: editing.notes || '',
        assignedToId: editing.assignedToId || '',
      })
    } else {
      reset({ stage: defaultStage || 'NEW', probability: 20, value: 0 })
    }
  }, [editing, defaultStage, reset])

  // Déclencher le reset quand la modale s'ouvre
  useEffect(() => { if (open) handleOpen() }, [open, handleOpen])

  const watchedCompanyId = watch('companyId')
  const filteredContacts = watchedCompanyId
    ? contacts.filter(c => c.companyId === watchedCompanyId)
    : contacts

  const createMutation = useMutation({
    mutationFn: (values: OpportunityForm) => api.post('/pipeline/opportunities', { ...values, pipelineId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      toast.success('Opportunité créée')
      onClose()
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const updateMutation = useMutation({
    mutationFn: (values: OpportunityForm) =>
      api.put(`/pipeline/opportunities/${editing!.id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      toast.success('Opportunité mise à jour')
      onClose()
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const onSubmit = (values: OpportunityForm) => {
    if (editing) updateMutation.mutate(values)
    else createMutation.mutate(values)
  }

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Modifier l\'opportunité' : 'Nouvelle opportunité'}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Titre */}
        <div className="form-group">
          <label className="label">Titre *</label>
          <input
            {...register('title')}
            className={cn('input', errors.title && 'input-error')}
            placeholder="Ex: Contrat maintenance annuel"
          />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>

        {/* Entreprise (en premier) */}
        <div className="form-group">
          <label className="label">Entreprise</label>
          <Controller
            name="companyId"
            control={control}
            render={({ field }) => (
              <select
                {...field}
                className="input"
                onChange={(e) => { field.onChange(e); setValue('contactId', '') }}
              >
                <option value="">-- Aucune --</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          />
        </div>

        {/* Contact (filtré par entreprise) */}
        <div className="form-group">
          <label className="label">Contact</label>
          <select {...register('contactId')} className="input">
            <option value="">-- Aucun --</option>
            {filteredContacts.map(c => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
                {!watchedCompanyId && c.company ? ` — ${c.company.name}` : ''}
              </option>
            ))}
          </select>
          {watchedCompanyId && filteredContacts.length === 0 && (
            <p className="text-xs text-slate-400 mt-1">Aucun contact lié à cette entreprise</p>
          )}
        </div>

        {/* Valeur + Probabilité */}
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Valeur (€) *</label>
            <input
              {...register('value')}
              type="number"
              min="0"
              step="1"
              className={cn('input', errors.value && 'input-error')}
            />
            {errors.value && <p className="form-error">{errors.value.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Probabilité (%) *</label>
            <input
              {...register('probability')}
              type="number"
              min="0"
              max="100"
              className={cn('input', errors.probability && 'input-error')}
            />
            {errors.probability && <p className="form-error">{errors.probability.message}</p>}
          </div>
        </div>

        {/* Stage + Date closing */}
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Stage *</label>
            <Controller
              name="stage"
              control={control}
              render={({ field }) => (
                <select {...field} className="input">
                  {stages.map(s => (
                    <option key={s.key} value={s.key}>{s.name}</option>
                  ))}
                </select>
              )}
            />
          </div>
          <div className="form-group">
            <label className="label">Date de closing prévue</label>
            <input {...register('expectedCloseDate')} type="date" className="input" />
          </div>
        </div>

        {/* Commercial (ADMIN/MANAGER seulement) */}
        {canAssign && (
          <div className="form-group">
            <label className="label">Commercial assigné</label>
            <select {...register('assignedToId')} className="input">
              <option value="">-- Non assigné --</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Notes */}
        <div className="form-group">
          <label className="label">Notes</label>
          <textarea {...register('notes')} className="input" rows={3} placeholder="Informations complémentaires..." />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {editing ? 'Enregistrer' : 'Créer l\'opportunité'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────
export function PipelinePage() {
  const { user, isAuthenticated } = useAuthStore()
  const qc = useQueryClient()
  const canAssign = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  const [search, setSearch] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingOpp, setEditingOpp] = useState<Opportunity | null>(null)
  const [defaultStage, setDefaultStage] = useState('NEW')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)
  const [showPipelineManager, setShowPipelineManager] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: pipelines = [] } = useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data.data ?? [] },
    enabled: isAuthenticated,
    staleTime: 60_000,
  })

  // Résoudre le pipeline effectif : sélection manuelle ou pipeline par défaut
  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId)
    ?? pipelines.find(p => p.isDefault)
    ?? pipelines[0]
  const effectivePipelineId = selectedPipeline?.id ?? ''
  const stages = selectedPipeline?.stages ?? []

  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ['pipeline-opportunities', { search, assignedFilter, effectivePipelineId }],
    queryFn: async () => {
      const { data } = await api.get('/pipeline/opportunities', {
        params: {
          search: search || undefined,
          assignedToId: assignedFilter || undefined,
          pipelineId: effectivePipelineId || undefined,
        },
      })
      return data.data ?? data
    },
    enabled: isAuthenticated && !!effectivePipelineId,
    staleTime: 30_000,
  })

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['contacts-list'],
    queryFn: async () => {
      const { data } = await api.get('/contacts', { params: { limit: 200 } })
      return data.data ?? data
    },
    staleTime: 60_000,
  })

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies-list'],
    queryFn: async () => {
      const { data } = await api.get('/companies', { params: { limit: 200 } })
      return data.data ?? data
    },
    staleTime: 60_000,
  })

  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data } = await api.get('/users')
      return data.data ?? data
    },
    enabled: canAssign,
    staleTime: 60_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────
  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api.patch(`/pipeline/opportunities/${id}/stage`, { stage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] }),
    onError: () => toast.error('Erreur lors du changement de stage'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/pipeline/opportunities/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      toast.success('Opportunité supprimée')
      setShowDeleteConfirm(null)
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const quickUpdateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      // Extract appointment creation data (not sent to API)
      const { _createAppointment, ...rest } = data as Record<string, unknown> & { _createAppointment?: { type: string; title: string; scheduledAt: string; contactId?: string } }
      await api.put(`/pipeline/opportunities/${id}`, rest)
      if (_createAppointment) {
        const start = new Date(_createAppointment.scheduledAt)
        const end = new Date(start)
        end.setMinutes(end.getMinutes() + 15)
        await api.post('/appointments', {
          title: _createAppointment.title,
          type: _createAppointment.type,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          userIds: user?.id ? [user.id] : [],
          contactIds: _createAppointment.contactId ? [_createAppointment.contactId] : [],
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const scheduleTagMutation = useMutation({
    mutationFn: async ({ oppId, tagType, scheduledAt }: { oppId: string; tagType: string; scheduledAt: string }) => {
      const opp = opportunities.find(o => o.id === oppId)
      if (!opp) return
      const cfg = TAG_CONFIG[tagType]
      const tags = parseTags(opp.tags)
      const newTags: OppTag[] = [...removeTag(tags, tagType), { type: tagType, scheduledAt }]
      // Update tags on opportunity
      await api.put(`/pipeline/opportunities/${oppId}`, {
        title: opp.title, stage: opp.stage, value: opp.value, probability: opp.probability,
        tags: JSON.stringify(newTags),
      })
      // Create appointment in calendar
      const start = new Date(scheduledAt)
      const end = new Date(start)
      end.setMinutes(end.getMinutes() + (cfg.durationMin ?? 60))
      await api.post('/appointments', {
        title: `${cfg.label} — ${opp.title}`,
        type: cfg.appointmentType ?? 'OTHER',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        userIds: user?.id ? [user.id] : [],
        contactIds: opp.contactId ? [opp.contactId] : [],
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      toast.success('Ajouté à l\'agenda')
    },
    onError: () => toast.error('Erreur lors de la planification'),
  })

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return
      const newStage = result.destination.droppableId
      const oppId = result.draggableId
      const opp = opportunities.find(o => o.id === oppId)
      if (!opp || opp.stage === newStage) return
      stageMutation.mutate({ id: oppId, stage: newStage })
    },
    [opportunities, stageMutation],
  )

  // ── Calculs stats ──────────────────────────────────────────────────────────
  const wonKeys = stages.filter(s => s.isWon).map(s => s.key)
  const lostKeys = stages.filter(s => s.isLost).map(s => s.key)
  const activeOpps = opportunities.filter(o => !wonKeys.includes(o.stage) && !lostKeys.includes(o.stage))
  const wonThisMonth = opportunities.filter(o => {
    if (!wonKeys.includes(o.stage)) return false
    if (!o.closedAt) return false
    const d = new Date(o.closedAt)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const totalPipelineValue = activeOpps.reduce((acc, o) => acc + (o.value * o.probability) / 100, 0)

  // ── Groupement par stage ──────────────────────────────────────────────────
  const byStage = (stage: string) =>
    opportunities.filter(o => o.stage === stage)

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleEdit = (opp: Opportunity) => setEditingOpp(opp)
  const handleStageChange = (id: string, stage: string) => stageMutation.mutate({ id, stage })
  const handleDelete = (id: string) => setShowDeleteConfirm(id)
  const handleQuickUpdate = (id: string, data: Record<string, unknown>) => {
    const opp = opportunities.find(o => o.id === id)
    if (!opp) return
    quickUpdateMutation.mutate({ id, data: { title: opp.title, stage: opp.stage, value: opp.value, probability: opp.probability, ...data } })
  }
  const handleScheduleTag = (oppId: string, tagType: string, scheduledAt: string) => {
    scheduleTagMutation.mutate({ oppId, tagType, scheduledAt })
  }

  if (isLoading) return <PageSpinner />

  return (
    <div className="flex flex-col h-full fade-in">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="page-title">Pipeline commercial</h1>
            <p className="page-subtitle">{activeOpps.length} opportunités en cours</p>
          </div>
          {/* Sélecteur de pipeline */}
          {pipelines.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1">
              {pipelines.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                    effectivePipelineId === p.id
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canAssign && (
            <button className="btn-secondary" onClick={() => setShowPipelineManager(true)}>
              <Settings className="w-4 h-4" /> Gérer les pipelines
            </button>
          )}
          <button
            className="btn-primary"
            onClick={() => { setDefaultStage(stages[0]?.key || 'NEW'); setEditingOpp(null); setShowCreate(true) }}
          >
            <Plus className="w-4 h-4" />
            Nouvelle opportunité
          </button>
        </div>
      </div>

      {/* ── Stats rapides ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Opportunités actives</p>
            <p className="text-xl font-bold text-slate-900">{activeOpps.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Euro className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Valeur pipeline pondérée</p>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(totalPipelineValue)}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Gagnées ce mois</p>
            <p className="text-xl font-bold text-slate-900">{wonThisMonth.length}</p>
          </div>
        </div>
      </div>

      {/* ── Filtres ────────────────────────────────────────────────────────── */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher une opportunité..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {canAssign && (
          <select
            className="input w-auto"
            value={assignedFilter}
            onChange={e => setAssignedFilter(e.target.value)}
          >
            <option value="">Tous les commerciaux</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </select>
        )}
        {(search || assignedFilter) && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={() => { setSearch(''); setAssignedFilter('') }}
          >
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* ── Board Kanban ────────────────────────────────────────────────────── */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-6 flex-1 min-h-0">
          {stages.map(stage => {
            const stageOpps = byStage(stage.key)
            const stageValue = stageOpps.reduce((acc, o) => acc + o.value, 0)

            return (
              <div
                key={stage.key}
                className="flex-shrink-0 w-72 rounded-2xl border flex flex-col"
                style={stageBg(stage.color)}
              >
                {/* En-tête colonne */}
                <div className="p-3 border-b border-current/10">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={stageDot(stage.color)} />
                      <span className="text-sm font-semibold text-slate-800">{stage.name}</span>
                      <span className="text-xs font-bold text-slate-500 bg-white/70 px-1.5 py-0.5 rounded-full">
                        {stageOpps.length}
                      </span>
                    </div>
                    {!stage.isWon && !stage.isLost && (
                      <button
                        onClick={() => { setDefaultStage(stage.key); setEditingOpp(null); setShowCreate(true) }}
                        className="p-1 rounded-lg hover:bg-white/60 text-slate-400 hover:text-slate-700 transition-colors"
                        title="Ajouter une opportunité"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{formatCurrency(stageValue)}</p>
                </div>

                {/* Liste droppable */}
                <Droppable droppableId={stage.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="flex-1 overflow-y-auto p-3 space-y-3 min-h-24 transition-colors rounded-b-2xl"
                      style={snapshot.isDraggingOver ? stageDropBg(stage.color) : undefined}
                    >
                      {stageOpps.length === 0 && !snapshot.isDraggingOver && (
                        <div className="text-center py-6 text-slate-400 text-xs">
                          Glisser une opportunité ici
                        </div>
                      )}
                      {stageOpps.map((opp, idx) => (
                        <OpportunityCard
                          key={opp.id}
                          opportunity={opp}
                          index={idx}
                          stages={stages}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onStageChange={handleStageChange}
                          onQuickUpdate={handleQuickUpdate}
                          onScheduleTag={handleScheduleTag}
                        />
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}

        </div>
      </DragDropContext>

      {/* ── Modale création/édition ────────────────────────────────────────── */}
      <OpportunityModal
        open={showCreate || !!editingOpp}
        onClose={() => { setShowCreate(false); setEditingOpp(null) }}
        editing={editingOpp}
        defaultStage={defaultStage}
        pipelineId={selectedPipelineId ?? undefined}
        stages={stages}
        contacts={contacts}
        companies={companies}
        users={users}
        canAssign={canAssign}
      />

      {/* ── Confirmation suppression ───────────────────────────────────────── */}
      <Modal
        open={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title="Supprimer l'opportunité"
        size="sm"
      >
        <p className="text-slate-600 mb-6">
          Êtes-vous sûr de vouloir supprimer cette opportunité ? Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setShowDeleteConfirm(null)}>
            Annuler
          </button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 focus:ring-red-500"
            onClick={() => showDeleteConfirm && deleteMutation.mutate(showDeleteConfirm)}
            disabled={deleteMutation.isPending}
          >
            Supprimer
          </button>
        </div>
      </Modal>

      {showPipelineManager && (
        <PipelineManagerModal
          pipelines={pipelines}
          onClose={() => setShowPipelineManager(false)}
        />
      )}
    </div>
  )
}

// ─── Modal de gestion des pipelines ─────────────────────────────────────────
interface PipelineManagerModalProps {
  pipelines: Pipeline[]
  onClose: () => void
}

const pipelineFormSchema = z.object({ name: z.string().min(1, 'Nom requis'), description: z.string().optional(), color: z.string().optional() })
const stageFormSchema = z.object({ key: z.string().min(1, 'Clé requise').regex(/^[A-Z0-9_]+$/, 'Majuscules, chiffres, _ uniquement'), name: z.string().min(1, 'Nom requis'), color: z.string().optional() })
type PipelineFormType = z.infer<typeof pipelineFormSchema>
type StageFormType = z.infer<typeof stageFormSchema>

function PipelineManagerModal({ pipelines, onClose }: PipelineManagerModalProps) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string>(pipelines.find(p => p.isDefault)?.id ?? pipelines[0]?.id ?? '')
  const [addingPipeline, setAddingPipeline] = useState(false)
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null)
  const [addingStage, setAddingStage] = useState(false)
  const [editingStage, setEditingStage] = useState<PipelineStage | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'pipeline' | 'stage'; id: string; pipelineId?: string } | null>(null)

  const selected = pipelines.find(p => p.id === selectedId)

  const pipelineForm = useForm<PipelineFormType>({
    resolver: zodResolver(pipelineFormSchema) as Resolver<PipelineFormType>,
    defaultValues: { name: '', description: '', color: '#6366f1' },
  })
  const stageForm = useForm<StageFormType>({
    resolver: zodResolver(stageFormSchema) as Resolver<StageFormType>,
    defaultValues: { key: '', name: '', color: '#94a3b8' },
  })

  const createPipelineMutation = useMutation({
    mutationFn: (v: PipelineFormType) => api.post('/pipelines', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); setAddingPipeline(false); pipelineForm.reset() },
    onError: () => toast.error('Erreur lors de la création'),
  })
  const updatePipelineMutation = useMutation({
    mutationFn: ({ id, ...v }: PipelineFormType & { id: string }) => api.put(`/pipelines/${id}`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); setEditingPipeline(null) },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })
  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/pipelines/${id}/default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipelines'] }),
    onError: () => toast.error('Erreur'),
  })
  const deletePipelineMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/pipelines/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); setDeleteConfirm(null); if (selectedId === deleteConfirm?.id) setSelectedId(pipelines[0]?.id ?? '') },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Erreur'),
  })
  const createStageMutation = useMutation({
    mutationFn: (v: StageFormType) => api.post(`/pipelines/${selectedId}/stages`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); setAddingStage(false); stageForm.reset() },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Erreur'),
  })
  const updateStageMutation = useMutation({
    mutationFn: ({ id, ...v }: StageFormType & { id: string }) => api.put(`/pipelines/${selectedId}/stages/${id}`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); setEditingStage(null) },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })
  const deleteStageMutation = useMutation({
    mutationFn: ({ pipelineId, stageId }: { pipelineId: string; stageId: string }) => api.delete(`/pipelines/${pipelineId}/stages/${stageId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); setDeleteConfirm(null) },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Erreur'),
  })

  const openEditPipeline = (p: Pipeline) => {
    setEditingPipeline(p)
    pipelineForm.reset({ name: p.name, description: p.description ?? '', color: p.color })
  }
  const openEditStage = (s: PipelineStage) => {
    setEditingStage(s)
    stageForm.reset({ key: s.key, name: s.name, color: s.color })
  }

  return (
    <Modal open onClose={onClose} title="Gestion des pipelines" size="xl">
      <div className="flex gap-6 min-h-96">
        {/* ── Liste pipelines ─────────────────────────── */}
        <div className="w-56 flex-shrink-0 border-r border-slate-100 pr-4 flex flex-col gap-1">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Pipelines</p>
          {pipelines.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                'flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                selectedId === p.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
              <span className="flex-1 truncate">{p.name}</span>
              {p.isDefault && <span className="text-[10px] font-semibold text-primary-500 bg-primary-100 px-1.5 py-0.5 rounded-full">défaut</span>}
            </button>
          ))}
          <button
            onClick={() => { setAddingPipeline(true); pipelineForm.reset({ name: '', description: '', color: '#6366f1' }) }}
            className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-600 mt-2 border border-dashed border-slate-200"
          >
            <Plus className="w-3.5 h-3.5" /> Nouveau pipeline
          </button>
        </div>

        {/* ── Détail pipeline sélectionné ─────────────── */}
        <div className="flex-1 min-w-0">
          {selected && !addingPipeline && !editingPipeline && (
            <>
              {/* Header pipeline */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full" style={{ background: selected.color }} />
                  <div>
                    <h3 className="font-semibold text-slate-900">{selected.name}</h3>
                    {selected.description && <p className="text-xs text-slate-500">{selected.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!selected.isDefault && (
                    <button
                      onClick={() => setDefaultMutation.mutate(selected.id)}
                      className="text-xs text-primary-600 hover:underline"
                    >
                      Définir par défaut
                    </button>
                  )}
                  <button onClick={() => openEditPipeline(selected)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {!selected.isDefault && (
                    <button
                      onClick={() => setDeleteConfirm({ type: 'pipeline', id: selected.id })}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Stages */}
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Étapes ({selected.stages.length})</p>
                  <button
                    onClick={() => { setAddingStage(true); stageForm.reset({ key: '', name: '', color: '#94a3b8' }) }}
                    className="flex items-center gap-1 text-xs text-primary-600 hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Ajouter
                  </button>
                </div>
                {selected.stages.map(s => (
                  <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50">
                    <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    <span className="flex-1 text-sm font-medium text-slate-700">{s.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{s.key}</span>
                    {s.isWon && <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">Gagné</span>}
                    {s.isLost && <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Perdu</span>}
                    {!s.isWon && !s.isLost && (
                      <>
                        <button onClick={() => openEditStage(s)} className="p-1 rounded hover:bg-slate-200 text-slate-400">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'stage', id: s.id, pipelineId: selected.id })}
                          className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {selected.stages.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">Aucune étape définie</p>
                )}
              </div>

              {/* Form ajout stage */}
              {addingStage && (
                <form
                  onSubmit={stageForm.handleSubmit(v => createStageMutation.mutate(v))}
                  className="mt-3 p-3 rounded-xl border border-primary-200 bg-primary-50 space-y-2"
                >
                  <p className="text-xs font-semibold text-primary-700">Nouvelle étape</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <input
                        {...stageForm.register('key')}
                        placeholder="Clé (ex: DEMO)"
                        className="input text-xs py-1.5 uppercase"
                        onChange={e => stageForm.setValue('key', e.target.value.toUpperCase().replace(/\s/g, '_'))}
                      />
                      {stageForm.formState.errors.key && <p className="text-[10px] text-red-500 mt-0.5">{stageForm.formState.errors.key.message}</p>}
                    </div>
                    <div>
                      <input {...stageForm.register('name')} placeholder="Nom affiché" className="input text-xs py-1.5" />
                      {stageForm.formState.errors.name && <p className="text-[10px] text-red-500 mt-0.5">{stageForm.formState.errors.name.message}</p>}
                    </div>
                    <input {...stageForm.register('color')} type="color" className="input py-1 px-1 h-9 cursor-pointer" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary text-xs py-1.5" onClick={() => setAddingStage(false)}>Annuler</button>
                    <button type="submit" className="btn-primary text-xs py-1.5" disabled={createStageMutation.isPending}>Ajouter</button>
                  </div>
                </form>
              )}

              {/* Form édition stage */}
              {editingStage && (
                <form
                  onSubmit={stageForm.handleSubmit(v => updateStageMutation.mutate({ ...v, id: editingStage.id }))}
                  className="mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50 space-y-2"
                >
                  <p className="text-xs font-semibold text-amber-700">Modifier l'étape</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input {...stageForm.register('name')} placeholder="Nom affiché" className="input text-xs py-1.5" />
                    <input {...stageForm.register('color')} type="color" className="input py-1 px-1 h-9 cursor-pointer" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary text-xs py-1.5" onClick={() => setEditingStage(null)}>Annuler</button>
                    <button type="submit" className="btn-primary text-xs py-1.5" disabled={updateStageMutation.isPending}>Enregistrer</button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* Form création pipeline */}
          {addingPipeline && (
            <form
              onSubmit={pipelineForm.handleSubmit(v => createPipelineMutation.mutate(v))}
              className="space-y-3"
            >
              <p className="font-semibold text-slate-900 mb-3">Nouveau pipeline</p>
              <div className="form-group">
                <label className="label">Nom *</label>
                <input {...pipelineForm.register('name')} className="input" placeholder="Ex: Pipeline Grands comptes" />
                {pipelineForm.formState.errors.name && <p className="form-error">{pipelineForm.formState.errors.name.message}</p>}
              </div>
              <div className="form-group">
                <label className="label">Description</label>
                <input {...pipelineForm.register('description')} className="input" placeholder="Optionnel" />
              </div>
              <div className="form-group">
                <label className="label">Couleur</label>
                <input {...pipelineForm.register('color')} type="color" className="input py-1 px-1 h-9 w-20 cursor-pointer" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setAddingPipeline(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={createPipelineMutation.isPending}>Créer</button>
              </div>
            </form>
          )}

          {/* Form édition pipeline */}
          {editingPipeline && (
            <form
              onSubmit={pipelineForm.handleSubmit(v => updatePipelineMutation.mutate({ ...v, id: editingPipeline.id }))}
              className="space-y-3"
            >
              <p className="font-semibold text-slate-900 mb-3">Modifier le pipeline</p>
              <div className="form-group">
                <label className="label">Nom *</label>
                <input {...pipelineForm.register('name')} className="input" />
                {pipelineForm.formState.errors.name && <p className="form-error">{pipelineForm.formState.errors.name.message}</p>}
              </div>
              <div className="form-group">
                <label className="label">Description</label>
                <input {...pipelineForm.register('description')} className="input" />
              </div>
              <div className="form-group">
                <label className="label">Couleur</label>
                <input {...pipelineForm.register('color')} type="color" className="input py-1 px-1 h-9 w-20 cursor-pointer" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setEditingPipeline(null)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={updatePipelineMutation.isPending}>Enregistrer</button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Confirmation suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80">
            <h3 className="font-semibold text-slate-900 mb-2">Confirmer la suppression</h3>
            <p className="text-sm text-slate-600 mb-6">
              {deleteConfirm.type === 'pipeline'
                ? 'Supprimer ce pipeline ? Les opportunités associées ne seront pas supprimées.'
                : 'Supprimer cette étape ? Impossible si des opportunités y sont associées.'}
            </p>
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Annuler</button>
              <button
                className="btn-primary bg-red-600 hover:bg-red-700 focus:ring-red-500"
                disabled={deletePipelineMutation.isPending || deleteStageMutation.isPending}
                onClick={() => {
                  if (deleteConfirm.type === 'pipeline') deletePipelineMutation.mutate(deleteConfirm.id)
                  else if (deleteConfirm.pipelineId) deleteStageMutation.mutate({ pipelineId: deleteConfirm.pipelineId, stageId: deleteConfirm.id })
                }}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
