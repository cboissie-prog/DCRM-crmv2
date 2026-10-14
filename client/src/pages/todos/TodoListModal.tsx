import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Check } from 'lucide-react'
import api from '../../lib/api'
import { useTodoUsers } from './useTodoUsers'
import { useAuthStore } from '../../store/authStore'
import { Modal } from '../../components/ui/Modal'
import { Avatar } from '../../components/ui/Avatar'
import { toast } from '../../components/ui/Toast'
import { TODO_COLORS, TODO_COLOR_KEYS } from '../../lib/todoColors'
import { cn } from '../../lib/utils'
import type { TodoList, TodoMemberRole } from '../../types'

type MemberChoice = '' | TodoMemberRole

interface TodoListModalProps {
  open: boolean
  onClose: () => void
  /** null = création */
  list: TodoList | null
  /** Demande de suppression (la confirmation est portée par la page) */
  onRequestDelete: (list: TodoList) => void
}

export function TodoListModal({ open, onClose, list, onRequestDelete }: TodoListModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={list ? 'Modifier la liste' : 'Nouvelle liste'} size="md">
      {/* Monté à chaque ouverture (Modal ne rend rien fermée) : l'état initial vient donc toujours de `list` */}
      <ListForm list={list} onClose={onClose} onRequestDelete={onRequestDelete} />
    </Modal>
  )
}

function ListForm({ list, onClose, onRequestDelete }: Omit<TodoListModalProps, 'open'>) {
  const qc = useQueryClient()
  const me = useAuthStore(s => s.user)
  const isPersonal = !!list?.isPersonal

  const [name, setName] = useState(list?.name ?? '')
  const [color, setColor] = useState<string | null>(list?.color ?? null)
  const [members, setMembers] = useState<Record<string, MemberChoice>>(() => {
    const init: Record<string, MemberChoice> = {}
    for (const m of list?.members ?? []) init[m.userId] = m.role
    return init
  })
  const [nameError, setNameError] = useState('')

  const { data: users } = useTodoUsers(!isPersonal)
  const candidates = (users ?? []).filter(u => u.id !== me?.id)

  const memberPayload = () =>
    Object.entries(members)
      .filter((entry): entry is [string, TodoMemberRole] => entry[1] !== '')
      .map(([userId, role]) => ({ userId, role }))

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim()
      if (!list) {
        await api.post('/todos/lists', { name: trimmed, color, members: memberPayload() })
        return
      }
      if (trimmed !== list.name || color !== (list.color ?? null)) {
        await api.patch(`/todos/lists/${list.id}`, { name: trimmed, color })
      }
      if (!isPersonal) {
        const before = list.members.map(m => `${m.userId}:${m.role}`).sort().join('|')
        const after = memberPayload().map(m => `${m.userId}:${m.role}`).sort().join('|')
        if (before !== after) await api.put(`/todos/lists/${list.id}/members`, memberPayload())
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] })
      toast.success(list ? 'Liste modifiée' : 'Liste créée')
      onClose()
    },
    onError: () => toast.error("Erreur lors de l'enregistrement de la liste"),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setNameError('Nom requis'); return }
    setNameError('')
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="form-group">
        <label className="label" htmlFor="todo-list-name">Nom *</label>
        <input
          id="todo-list-name"
          className={cn('input', nameError && 'input-error')}
          value={name}
          maxLength={80}
          autoFocus
          onChange={e => setName(e.target.value)}
        />
        {nameError && <p className="form-error">{nameError}</p>}
      </div>

      <div>
        <p className="label">Couleur</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setColor(null)}
            aria-label="Aucune couleur"
            title="Aucune"
            className={cn(
              'w-7 h-7 rounded-full border-2 flex items-center justify-center text-slate-400 bg-white',
              color === null ? 'border-slate-700' : 'border-slate-200 hover:border-slate-400',
            )}
          >
            <Ban className="w-3.5 h-3.5" />
          </button>
          {TODO_COLOR_KEYS.map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setColor(key)}
              aria-label={TODO_COLORS[key].label}
              title={TODO_COLORS[key].label}
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-white ring-offset-2',
                TODO_COLORS[key].bar,
                color === key && 'ring-2 ring-slate-700',
              )}
            >
              {color === key && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {!isPersonal && (
        <div>
          <p className="label">Membres</p>
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun autre utilisateur actif.</p>
          ) : (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {candidates.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar firstName={u.firstName} lastName={u.lastName} size="sm" />
                  <span className="flex-1 min-w-0 truncate text-sm text-slate-700">{u.firstName} {u.lastName}</span>
                  <select
                    className="input w-32 py-1"
                    aria-label={`Droits de ${u.firstName} ${u.lastName}`}
                    value={members[u.id] ?? ''}
                    onChange={e => setMembers(prev => ({ ...prev, [u.id]: e.target.value as MemberChoice }))}
                  >
                    <option value="">Aucun</option>
                    <option value="VIEWER">Lecture</option>
                    <option value="EDITOR">Édition</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <div>
          {list && !isPersonal && (
            <button
              type="button"
              className="btn-ghost text-red-600 hover:bg-red-50"
              onClick={() => { onClose(); onRequestDelete(list) }}
            >
              Supprimer la liste
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {list ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </form>
  )
}
