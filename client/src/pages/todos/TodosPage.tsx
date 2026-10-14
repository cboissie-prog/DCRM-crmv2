import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ListTodo, Plus } from 'lucide-react'
import api from '../../lib/api'
import { useList } from '../../hooks/useApi'
import { PageIcon } from '../../components/ui/PageIcon'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import type { Todo, TodoList } from '../../types'
import { TodoBoard } from './TodoBoard'
import { TodoDrawer } from './TodoDrawer'
import { TodoListModal } from './TodoListModal'

type StatusFilter = 'todo' | 'done' | 'all'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'todo', label: 'À faire' },
  { key: 'done', label: 'Terminées' },
  { key: 'all',  label: 'Toutes' },
]

/** Message d'erreur renvoyé par l'API, à défaut le message de repli */
function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return message || fallback
}

export function TodosPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const taskId = searchParams.get('task')

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todo')
  const [onlyMine, setOnlyMine] = useState(false)
  // undefined = modale fermée ; null = création ; TodoList = édition
  const [listModal, setListModal] = useState<TodoList | null | undefined>(undefined)
  const [deletingList, setDeletingList] = useState<TodoList | null>(null)

  const params = {
    status: statusFilter === 'all' ? undefined : statusFilter,
    assigneeId: onlyMine ? 'me' : undefined,
  }
  const todosKey = ['todos', params]

  const { data: lists, isLoading: listsLoading } = useList<TodoList[]>(['todos', 'lists'], '/todos/lists')
  const { data: todos, isLoading: todosLoading } = useList<Todo[]>(['todos'], '/todos', params)

  const pendingTotal = (lists ?? []).reduce((sum, l) => sum + l.pendingCount, 0)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['todos'] })

  const openTask = (id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('task', id)
    setSearchParams(next)
  }
  const closeTask = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('task')
    setSearchParams(next, { replace: true })
  }

  const quickAdd = useMutation({
    mutationFn: ({ listId, title }: { listId: string; title: string }) => api.post('/todos', { listId, title }),
    onSuccess: invalidate,
    onError: err => toast.error(apiErrorMessage(err, 'Erreur lors de la création')),
  })

  const toggle = useMutation({
    mutationFn: (todo: Todo) => api.patch(`/todos/${todo.id}`, { isDone: !todo.isDone }),
    onSuccess: invalidate,
    onError: err => toast.error(apiErrorMessage(err, 'Erreur lors de la mise à jour')),
  })

  // Déplacement par glisser-déposer : mise à jour optimiste du cache, rollback sur erreur
  const move = useMutation({
    mutationFn: ({ id, listId }: { id: string; listId: string }) => api.patch(`/todos/${id}`, { listId }),
    onMutate: async ({ id, listId }) => {
      await qc.cancelQueries({ queryKey: ['todos'] })
      const previous = qc.getQueryData<Todo[]>(todosKey)
      qc.setQueryData<Todo[]>(todosKey, old => old?.map(t => (t.id === id ? { ...t, listId } : t)))
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(todosKey, context.previous)
      toast.error(apiErrorMessage(err, 'Erreur lors du déplacement'))
    },
    onSettled: invalidate,
  })

  const deleteList = useMutation({
    mutationFn: (id: string) => api.delete(`/todos/lists/${id}`),
    onSuccess: () => { invalidate(); setDeletingList(null); toast.success('Liste supprimée') },
    onError: err => toast.error(apiErrorMessage(err, 'Erreur lors de la suppression')),
  })

  const loading = listsLoading || todosLoading

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <PageIcon module="todo" icon={<ListTodo className="w-5 h-5" />} />
          <div>
            <h1 className="page-title">Todo</h1>
            <p className="page-subtitle">{pendingTotal} tâche{pendingTotal !== 1 ? 's' : ''} à faire</p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setListModal(null)}>
          <Plus className="w-4 h-4" /> Nouvelle liste
        </button>
      </div>

      {/* Filtres */}
      <div className="flex gap-4 flex-wrap items-center">
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
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 rounded text-primary-600"
            checked={onlyMine}
            onChange={e => setOnlyMine(e.target.checked)}
          />
          Assignées à moi
        </label>
      </div>

      {loading ? <PageSpinner /> : (
        <TodoBoard
          lists={lists ?? []}
          todos={todos ?? []}
          onMoveTodo={(id, listId) => move.mutate({ id, listId })}
          onOpenTodo={t => openTask(t.id)}
          onToggleTodo={t => toggle.mutate(t)}
          onQuickAdd={(listId, title) => quickAdd.mutate({ listId, title })}
          onEditList={l => setListModal(l)}
          onDeleteList={l => setDeletingList(l)}
          onCreateList={() => setListModal(null)}
        />
      )}

      <TodoDrawer taskId={taskId} onClose={closeTask} lists={lists ?? []} />

      <TodoListModal
        open={listModal !== undefined}
        onClose={() => setListModal(undefined)}
        list={listModal ?? null}
        onRequestDelete={l => setDeletingList(l)}
      />

      {/* Suppression d'une liste */}
      <Modal open={!!deletingList} onClose={() => setDeletingList(null)} title="Supprimer la liste" size="sm">
        <p className="text-slate-600 mb-6">
          Êtes-vous sûr de vouloir supprimer la liste <strong>{deletingList?.name}</strong> ?
          Toutes les tâches qu'elle contient seront supprimées avec elle. Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingList(null)}>Annuler</button>
          <button
            className="btn-danger"
            disabled={deleteList.isPending}
            onClick={() => deletingList && deleteList.mutate(deletingList.id)}
          >
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}
