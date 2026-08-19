import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { ListTodo, Plus, Pencil, Trash2, Lock, Check } from 'lucide-react'
import api from '../../lib/api'
import { useList, useUsersList } from '../../hooks/useApi'
import { usePermission } from '../../hooks/usePermission'
import { useAuthStore } from '../../store/authStore'
import { PageIcon } from '../../components/ui/PageIcon'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { toast } from '../../components/ui/Toast'
import { formatDate } from '../../lib/utils'
import type { Todo } from '../../types'

// ─── Constantes ─────────────────────────────────────────────────────────────

const PRIORITY_INFO: Record<string, { label: string; variant: string }> = {
  HIGH:   { label: 'Haute',   variant: 'badge-red' },
  NORMAL: { label: 'Normale', variant: 'badge-blue' },
  LOW:    { label: 'Basse',   variant: 'badge-gray' },
}

type StatusFilter = 'todo' | 'done' | 'all'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'todo', label: 'À faire' },
  { key: 'done', label: 'Terminées' },
  { key: 'all',  label: 'Toutes' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function dueDateBadge(dueDate: string | undefined, isDone: boolean) {
  if (!dueDate) return null
  const days = differenceInCalendarDays(parseISO(dueDate), new Date())
  let variant = 'badge-gray'
  if (!isDone && days < 0) variant = 'badge-red'
  else if (!isDone && days <= 1) variant = 'badge-orange'
  return <Badge variant={variant}>{formatDate(dueDate)}</Badge>
}

function TodoDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 140
  const shown = expanded || !isLong ? text : `${text.slice(0, 140)}…`
  return (
    <div className="mt-1">
      <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed">{shown}</p>
      {isLong && (
        <button
          type="button"
          className="text-xs text-primary-600 hover:text-primary-700 mt-0.5 font-medium"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Réduire' : 'Voir plus'}
        </button>
      )}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function TodosPage() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canReadAll = usePermission('todos:read_all')
  const canWriteAll = usePermission('todos:write_all')

  // '' = ma liste ; sinon id de l'utilisateur consulté
  const [selectedUserId, setSelectedUserId] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todo')
  const [showModal, setShowModal] = useState(false)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [deletingTodo, setDeletingTodo] = useState<Todo | null>(null)

  const { data: usersData } = useUsersList({ enabled: canReadAll })
  const otherUsers = (usersData ?? []).filter(u => u.id !== user?.id)

  const viewingUserId = selectedUserId || user?.id || ''
  const isOwnList = viewingUserId === user?.id
  const canEditList = isOwnList || canWriteAll

  const { data: todos, isLoading } = useList<Todo[]>(
    ['todos'],
    '/todos',
    { userId: selectedUserId || undefined, status: statusFilter }
  )

  // Requête légère dédiée au compteur « à faire », indépendante du filtre affiché
  const { data: pendingTodos } = useList<Todo[]>(
    ['todos'],
    '/todos',
    { userId: selectedUserId || undefined, status: 'todo' }
  )
  const pendingCount = pendingTodos?.length ?? 0

  const invalidate = () => qc.invalidateQueries({ queryKey: ['todos'] })

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/todos', payload),
    onSuccess: () => { invalidate(); setShowModal(false); toast.success('Tâche créée') },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) => api.patch(`/todos/${id}`, payload),
    onSuccess: () => { invalidate(); setShowModal(false); setEditingTodo(null); toast.success('Tâche modifiée') },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const toggleMutation = useMutation({
    mutationFn: (todo: Todo) => api.patch(`/todos/${todo.id}`, { isDone: !todo.isDone }),
    onSuccess: invalidate,
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/todos/${id}`),
    onSuccess: () => { invalidate(); setDeletingTodo(null); toast.success('Tâche supprimée') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openCreate = () => { setEditingTodo(null); setShowModal(true) }
  const openEdit = (todo: Todo) => { setEditingTodo(todo); setShowModal(true) }

  const list = todos ?? []

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <PageIcon module="todo" icon={<ListTodo className="w-5 h-5" />} />
          <div>
            <h1 className="page-title">Todo</h1>
            <p className="page-subtitle">{pendingCount} tâche{pendingCount !== 1 ? 's' : ''} à faire</p>
          </div>
        </div>
        {canEditList && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Nouvelle tâche
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="flex gap-3 flex-wrap items-center justify-between">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                statusFilter === f.key ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {canReadAll && (
          <select
            className="input w-56"
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
          >
            <option value="">Ma liste</option>
            {otherUsers.map(u => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
            ))}
          </select>
        )}
      </div>

      {/* Liste */}
      {isLoading ? <PageSpinner /> : list.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <ListTodo className="w-12 h-12 mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-medium">
            {statusFilter === 'done' ? 'Aucune tâche terminée' : statusFilter === 'todo' ? 'Aucune tâche à faire — tout est fait !' : 'Aucune tâche'}
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {list.map(todo => (
            <div
              key={todo.id}
              className={`group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50 ${todo.isDone ? 'opacity-60' : ''}`}
            >
              <button
                type="button"
                className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                  todo.isDone ? 'bg-primary-600 border-primary-600' : 'border-slate-300 hover:border-primary-400'
                } ${canEditList ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                disabled={!canEditList || toggleMutation.isPending}
                onClick={() => canEditList && toggleMutation.mutate(todo)}
                title={canEditList ? (todo.isDone ? 'Marquer comme à faire' : 'Marquer comme terminée') : undefined}
              >
                {todo.isDone && <Check className="w-3.5 h-3.5 text-white" />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-medium ${todo.isDone ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                    {todo.title}
                  </p>
                  {todo.isPrivate && (
                    <span title="Tâche privée">
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                    </span>
                  )}
                  <Badge variant={PRIORITY_INFO[todo.priority]?.variant ?? 'badge-gray'}>
                    {PRIORITY_INFO[todo.priority]?.label ?? todo.priority}
                  </Badge>
                  {dueDateBadge(todo.dueDate, todo.isDone)}
                </div>
                {todo.description && <TodoDescription text={todo.description} />}
              </div>

              {canEditList && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    className="btn-ghost p-1.5 rounded-lg"
                    onClick={() => openEdit(todo)}
                    title="Modifier"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="btn-ghost p-1.5 rounded-lg text-red-400 hover:text-red-600"
                    onClick={() => setDeletingTodo(todo)}
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Création / édition */}
      <TodoFormModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditingTodo(null) }}
        todo={editingTodo}
        targetOwnerId={viewingUserId}
        currentUserId={user?.id ?? ''}
        onSubmitCreate={payload => createMutation.mutate(payload)}
        onSubmitUpdate={(id, payload) => updateMutation.mutate({ id, payload })}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      {/* Suppression */}
      <Modal open={!!deletingTodo} onClose={() => setDeletingTodo(null)} title="Supprimer la tâche" size="sm">
        <p className="text-slate-600 mb-6">
          Êtes-vous sûr de vouloir supprimer la tâche <strong>{deletingTodo?.title}</strong> ?
          Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingTodo(null)}>Annuler</button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
            disabled={deleteMutation.isPending}
            onClick={() => deletingTodo && deleteMutation.mutate(deletingTodo.id)}
          >
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Modal création / édition ─────────────────────────────────────────────────

const todoSchema = z.object({
  title: z.string().min(1, 'Titre requis').max(200, 'Titre trop long (200 caractères max)'),
  description: z.string().max(2000, 'Description trop longue (2000 caractères max)').optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']),
  dueDate: z.string().optional(),
  isPrivate: z.boolean().optional(),
})
type TodoFormData = z.infer<typeof todoSchema>

const emptyTodoForm: TodoFormData = { title: '', description: '', priority: 'NORMAL', dueDate: '', isPrivate: false }

function todoToFormValues(todo: Todo): TodoFormData {
  return {
    title: todo.title,
    description: todo.description ?? '',
    priority: (todo.priority as TodoFormData['priority']) ?? 'NORMAL',
    dueDate: todo.dueDate ? todo.dueDate.slice(0, 10) : '',
    isPrivate: todo.isPrivate,
  }
}

interface TodoFormModalProps {
  open: boolean
  onClose: () => void
  todo: Todo | null
  /** Propriétaire ciblé à la création (liste consultée) */
  targetOwnerId: string
  currentUserId: string
  onSubmitCreate: (payload: Record<string, unknown>) => void
  onSubmitUpdate: (id: string, payload: Record<string, unknown>) => void
  isPending: boolean
}

function TodoFormModal({
  open, onClose, todo, targetOwnerId, currentUserId, onSubmitCreate, onSubmitUpdate, isPending,
}: TodoFormModalProps) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<TodoFormData>({
    resolver: zodResolver(todoSchema) as Resolver<TodoFormData>,
    defaultValues: emptyTodoForm,
  })

  // Réinitialise le formulaire à chaque ouverture (création ou édition d'une autre tâche)
  useEffect(() => {
    if (open) reset(todo ? todoToFormValues(todo) : emptyTodoForm)
  }, [open, todo, reset])

  const showPrivateOption = todo ? todo.ownerId === currentUserId : targetOwnerId === currentUserId

  const onSubmit = (values: TodoFormData) => {
    const payload: Record<string, unknown> = {
      title: values.title,
      description: values.description?.trim() ? values.description.trim() : undefined,
      priority: values.priority,
      dueDate: values.dueDate ? new Date(`${values.dueDate}T00:00:00`).toISOString() : null,
    }
    if (showPrivateOption) payload.isPrivate = !!values.isPrivate
    if (todo) {
      onSubmitUpdate(todo.id, payload)
    } else {
      if (targetOwnerId && targetOwnerId !== currentUserId) payload.ownerId = targetOwnerId
      onSubmitCreate(payload)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={todo ? 'Modifier la tâche' : 'Nouvelle tâche'} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="form-group">
          <label className="label">Titre *</label>
          <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} autoFocus />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Description</label>
          <textarea {...register('description')} className={`input ${errors.description ? 'input-error' : ''}`} rows={3} />
          {errors.description && <p className="form-error">{errors.description.message}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Priorité</label>
            <select {...register('priority')} className="input">
              <option value="LOW">Basse</option>
              <option value="NORMAL">Normale</option>
              <option value="HIGH">Haute</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">Échéance</label>
            <input {...register('dueDate')} type="date" className="input" />
          </div>
        </div>
        {showPrivateOption && (
          <div className="form-group flex items-center gap-3">
            <input {...register('isPrivate')} type="checkbox" id="todo-isPrivate" className="w-4 h-4 rounded text-primary-600" />
            <label htmlFor="todo-isPrivate" className="label mb-0 cursor-pointer">Tâche privée (visible de vous seul·e)</label>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {todo ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
