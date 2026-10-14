import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Check, RotateCcw, Send, Trash2 } from 'lucide-react'
import api from '../../lib/api'
import { useItem, useUsersList } from '../../hooks/useApi'
import { useAuthStore } from '../../store/authStore'
import { Drawer } from '../../components/ui/Drawer'
import { Avatar } from '../../components/ui/Avatar'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import { buildTodoThread, type UserNameResolver } from '../../lib/todoThread'
import { cn, formatDateTime, formatRelative } from '../../lib/utils'
import type { TodoDetail, TodoList, TodoUserRef } from '../../types'

interface TodoDrawerProps {
  /** Identifiant de la tâche ouverte ; null = panneau fermé */
  taskId: string | null
  onClose: () => void
  lists: TodoList[]
}

export function TodoDrawer({ taskId, onClose, lists }: TodoDrawerProps) {
  const { data: detail, isLoading, isError } = useItem<TodoDetail>(['todos'], '/todos', taskId ?? undefined)

  return (
    <Drawer open={!!taskId} onClose={onClose} title={detail?.list.name ?? 'Tâche'} width="w-[560px]">
      {!taskId ? null : isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : isError || !detail ? (
        <p className="p-6 text-sm text-slate-500">Cette tâche est introuvable ou n'est plus accessible.</p>
      ) : (
        <DrawerBody key={detail.id} detail={detail} lists={lists} onClose={onClose} />
      )}
    </Drawer>
  )
}

// ─── Corps ──────────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Basse' },
  { value: 'NORMAL', label: 'Normale' },
  { value: 'HIGH', label: 'Haute' },
]

function toDateInput(iso?: string | null): string {
  return iso ? format(parseISO(iso), 'yyyy-MM-dd') : ''
}

function DrawerBody({ detail, lists, onClose }: { detail: TodoDetail; lists: TodoList[]; onClose: () => void }) {
  const qc = useQueryClient()
  const me = useAuthStore(s => s.user)
  const canEdit = detail.canEdit

  const [title, setTitle] = useState(detail.title)
  const [editingTitle, setEditingTitle] = useState(false)
  const [description, setDescription] = useState(detail.description ?? '')
  const [comment, setComment] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const commentRef = useRef<HTMLTextAreaElement>(null)

  const { data: users } = useUsersList()

  const invalidate = () => qc.invalidateQueries({ queryKey: ['todos'] })

  const patch = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(`/todos/${detail.id}`, payload),
    onSuccess: invalidate,
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const addComment = useMutation({
    mutationFn: (content: string) => api.post(`/todos/${detail.id}/comments`, { content }),
    onSuccess: () => { invalidate(); setComment('') },
    onError: () => toast.error("Erreur lors de l'envoi de la mise à jour"),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/todos/${detail.id}`),
    onSuccess: () => {
      invalidate()
      setConfirmDelete(false)
      toast.success('Tâche supprimée')
      onClose()
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // Zone de saisie auto-grandissante
  useEffect(() => {
    const el = commentRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [comment])

  // Liste courante et utilisateurs assignables (propriétaire + membres de la liste)
  const currentList = lists.find(l => l.id === detail.listId)
  const assignable = new Map<string, TodoUserRef>()
  if (currentList) {
    assignable.set(currentList.owner.id, currentList.owner)
    for (const m of currentList.members) assignable.set(m.user.id, m.user)
  } else {
    assignable.set(detail.owner.id, detail.owner)
  }
  if (detail.assignee) assignable.set(detail.assignee.id, detail.assignee)

  const nameById = new Map<string, string>()
  for (const l of lists) {
    nameById.set(l.owner.id, `${l.owner.firstName} ${l.owner.lastName}`)
    for (const m of l.members) nameById.set(m.user.id, `${m.user.firstName} ${m.user.lastName}`)
  }
  for (const u of users ?? []) nameById.set(u.id, `${u.firstName} ${u.lastName}`)
  for (const u of assignable.values()) nameById.set(u.id, `${u.firstName} ${u.lastName}`)
  const resolveName: UserNameResolver = id => nameById.get(id)

  const thread = buildTodoThread(detail, resolveName)

  const commitTitle = () => {
    setEditingTitle(false)
    const next = title.trim()
    if (!next) { setTitle(detail.title); return }
    if (next !== detail.title) patch.mutate({ title: next })
  }

  const commitDescription = () => {
    const next = description.trim()
    if (next !== (detail.description ?? '').trim()) patch.mutate({ description: next || null })
  }

  const sendComment = () => {
    const content = comment.trim()
    if (!content || addComment.isPending) return
    addComment.mutate(content)
  }

  const movableLists = lists.filter(l => l.access !== 'view' || l.id === detail.listId)
  const showPrivate = detail.list.isPersonal && detail.ownerId === me?.id

  return (
    <div className="min-h-full flex flex-col">
      <div className="p-5 space-y-5 flex-1">
        {/* Titre + action principale */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {editingTitle && canEdit ? (
              <input
                className="input text-base font-semibold"
                value={title}
                maxLength={200}
                autoFocus
                onChange={e => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitTitle() }
                  else if (e.key === 'Escape') { e.stopPropagation(); setTitle(detail.title); setEditingTitle(false) }
                }}
              />
            ) : (
              <h3
                className={cn(
                  'text-base font-semibold break-words rounded-lg px-1 -mx-1',
                  detail.isDone ? 'line-through text-slate-400' : 'text-slate-900',
                  canEdit && 'cursor-text hover:bg-slate-50',
                )}
                onClick={() => canEdit && setEditingTitle(true)}
                title={canEdit ? 'Cliquer pour modifier' : undefined}
              >
                {detail.title}
              </h3>
            )}
          </div>
          <button
            type="button"
            className={detail.isDone ? 'btn-secondary btn-sm flex-shrink-0' : 'btn-primary btn-sm flex-shrink-0'}
            disabled={!canEdit || patch.isPending}
            onClick={() => patch.mutate({ isDone: !detail.isDone })}
          >
            {detail.isDone ? <><RotateCcw className="w-3.5 h-3.5" /> Rouvrir</> : <><Check className="w-3.5 h-3.5" /> Terminer</>}
          </button>
        </div>

        {/* Champs */}
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label mb-0" htmlFor="todo-f-list">Liste</label>
            <select
              id="todo-f-list"
              className="input"
              disabled={!canEdit}
              value={detail.listId}
              onChange={e => patch.mutate({ listId: e.target.value })}
            >
              {movableLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              {!movableLists.some(l => l.id === detail.listId) && <option value={detail.listId}>{detail.list.name}</option>}
            </select>
          </div>
          <div className="form-group">
            <label className="label mb-0" htmlFor="todo-f-priority">Priorité</label>
            <select
              id="todo-f-priority"
              className="input"
              disabled={!canEdit}
              value={detail.priority}
              onChange={e => patch.mutate({ priority: e.target.value })}
            >
              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label mb-0" htmlFor="todo-f-due">Échéance</label>
            <input
              id="todo-f-due"
              type="date"
              className="input"
              disabled={!canEdit}
              value={toDateInput(detail.dueDate)}
              onChange={e => patch.mutate({
                dueDate: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null,
              })}
            />
          </div>
          <div className="form-group">
            <label className="label mb-0" htmlFor="todo-f-assignee">Assigné</label>
            <select
              id="todo-f-assignee"
              className="input"
              disabled={!canEdit}
              value={detail.assigneeId ?? ''}
              onChange={e => patch.mutate({ assigneeId: e.target.value || null })}
            >
              <option value="">Personne</option>
              {[...assignable.values()].map(u => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
          </div>
        </div>

        {showPrivate && (
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded text-primary-600"
              disabled={!canEdit}
              checked={detail.isPrivate}
              onChange={e => patch.mutate({ isPrivate: e.target.checked })}
            />
            Tâche privée (visible de vous seul·e)
          </label>
        )}

        <div className="form-group">
          <label className="label mb-0" htmlFor="todo-f-desc">Description</label>
          <textarea
            id="todo-f-desc"
            className="input"
            rows={3}
            maxLength={2000}
            disabled={!canEdit}
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={commitDescription}
          />
        </div>

        {/* Fil */}
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">Activité</h4>
          <ol className="space-y-4">
            {thread.map(item => {
              if (item.type === 'comment') {
                const c = item.comment
                const first = c.author?.firstName ?? c.authorName.split(' ')[0] ?? '?'
                const last = c.author?.lastName ?? c.authorName.split(' ').slice(1).join(' ')
                return (
                  <li key={item.id} className="flex gap-3">
                    <Avatar firstName={first} lastName={last} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium text-slate-800">{c.authorName}</span>
                        <span className="text-xs text-slate-400 ml-2" title={formatDateTime(c.createdAt)}>{formatRelative(c.createdAt)}</span>
                      </p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mt-0.5">{c.content}</p>
                    </div>
                  </li>
                )
              }
              const who = item.author ? `${item.author.firstName} ${item.author.lastName}` : 'Quelqu\'un'
              if (item.type === 'created') {
                return (
                  <li key={item.id} className="flex gap-3">
                    {item.author
                      ? <Avatar firstName={item.author.firstName} lastName={item.author.lastName} size="sm" />
                      : <span className="w-7 h-7 rounded-full bg-slate-100 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium text-slate-800">{who}</span>
                        <span className="text-slate-500"> a créé la tâche</span>
                        <span className="text-xs text-slate-400 ml-2" title={formatDateTime(item.date)}>{formatRelative(item.date)}</span>
                      </p>
                      {item.text && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mt-0.5">{item.text}</p>}
                    </div>
                  </li>
                )
              }
              return (
                <li key={item.id} className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="w-7 flex justify-center flex-shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-slate-300" /></span>
                  <p className="min-w-0">
                    <span className="font-medium">{who}</span> {item.text}
                    <span className="text-slate-400 ml-2" title={formatDateTime(item.date)}>{formatRelative(item.date)}</span>
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      {/* Pied */}
      {canEdit && (
        <div className="sticky bottom-0 bg-white border-t border-slate-100 p-4 space-y-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={commentRef}
              className="input resize-none"
              rows={1}
              maxLength={2000}
              placeholder="Ajouter une mise à jour…"
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComment() }
              }}
            />
            <button
              type="button"
              className="btn-primary flex-shrink-0"
              disabled={!comment.trim() || addComment.isPending}
              onClick={sendComment}
              title="Envoyer (Ctrl+Entrée)"
            >
              <Send className="w-4 h-4" /> Envoyer
            </button>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-ghost btn-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Supprimer la tâche
            </button>
          </div>
        </div>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Supprimer la tâche" size="sm">
        <p className="text-slate-600 mb-6">
          Êtes-vous sûr de vouloir supprimer la tâche <strong>{detail.title}</strong> ? Son fil d'activité sera perdu.
          Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Annuler</button>
          <button className="btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Supprimer</button>
        </div>
      </Modal>
    </div>
  )
}
