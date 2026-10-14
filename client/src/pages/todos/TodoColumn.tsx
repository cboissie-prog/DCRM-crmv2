import { useEffect, useRef, useState } from 'react'
import { Droppable } from '@hello-pangea/dnd'
import { MoreHorizontal, Pencil, Users, Trash2, Plus } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { todoColorBar, todoListLabel } from '../../lib/todoColors'
import { useAuthStore } from '../../store/authStore'
import { cn } from '../../lib/utils'
import type { Todo, TodoList } from '../../types'
import { TodoCard } from './TodoCard'

const MAX_AVATARS = 3

interface TodoColumnProps {
  list: TodoList
  todos: Todo[]
  onOpenTodo: (todo: Todo) => void
  onToggleTodo: (todo: Todo) => void
  onQuickAdd: (listId: string, title: string) => void
  onEditList: (list: TodoList) => void
  onDeleteList: (list: TodoList) => void
}

export function TodoColumn({ list, todos, onOpenTodo, onToggleTodo, onQuickAdd, onEditList, onDeleteList }: TodoColumnProps) {
  const me = useAuthStore(s => s.user)
  const label = todoListLabel(list, me?.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // Ferme le menu ⋯ au clic extérieur
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const isOwner = list.access === 'own'
  const canAdd = list.access !== 'view'
  // Membres affichés : le propriétaire en tête (s'il n'est pas l'utilisateur de la liste personnelle), puis les invités
  const people = list.isPersonal ? [] : [list.owner, ...list.members.map(m => m.user)]
  const shown = people.slice(0, MAX_AVATARS)
  const extra = people.length - shown.length

  const submitDraft = () => {
    const title = draft.trim()
    if (!title) return
    onQuickAdd(list.id, title)
    setDraft('')
  }

  return (
    <div className="w-80 flex-shrink-0 flex flex-col max-h-[calc(100vh-15rem)] min-h-48 bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
      <div className={cn('h-1.5 flex-shrink-0', todoColorBar(list.color))} />

      <div className="flex items-center gap-2 px-3 pt-3 pb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-slate-800 truncate flex-1 min-w-0" title={label}>{label}</h3>

        {shown.length > 0 && (
          <div className="flex items-center -space-x-1.5 flex-shrink-0">
            {shown.map(u => (
              <span key={u.id} title={`${u.firstName} ${u.lastName}`} className="rounded-full ring-2 ring-slate-50">
                <Avatar firstName={u.firstName} lastName={u.lastName} size="xs" />
              </span>
            ))}
            {extra > 0 && (
              <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-semibold flex items-center justify-center ring-2 ring-slate-50">
                +{extra}
              </span>
            )}
          </div>
        )}

        <span className="badge badge-gray flex-shrink-0">{list.pendingCount}</span>

        {isOwner && (
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              type="button"
              className="btn-ghost p-1 rounded-lg text-slate-400 hover:text-slate-700"
              aria-label="Options de la liste"
              onClick={() => setMenuOpen(v => !v)}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg border border-slate-200 shadow-lg py-1 z-20">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => { setMenuOpen(false); onEditList(list) }}
                >
                  <Pencil className="w-3.5 h-3.5" /> Renommer
                </button>
                {!list.isPersonal && (
                  <>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => { setMenuOpen(false); onEditList(list) }}
                    >
                      <Users className="w-3.5 h-3.5" /> Membres
                    </button>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      onClick={() => { setMenuOpen(false); onDeleteList(list) }}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Supprimer
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Droppable droppableId={list.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 overflow-y-auto px-3 pb-2 space-y-2 min-h-16 transition-colors',
              snapshot.isDraggingOver && 'bg-primary-50/60',
            )}
          >
            {todos.length === 0 && !snapshot.isDraggingOver && (
              <p className="text-center py-4 text-xs text-slate-400">Aucune tâche</p>
            )}
            {todos.map((todo, idx) => (
              <TodoCard key={todo.id} todo={todo} index={idx} onOpen={onOpenTodo} onToggle={onToggleTodo} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {canAdd && (
        <div className="px-3 pb-3 pt-1 flex-shrink-0">
          <div className="relative">
            <Plus className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="input pl-8 bg-white/70"
              placeholder="Ajouter une tâche"
              value={draft}
              maxLength={200}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submitDraft() }
                else if (e.key === 'Escape') setDraft('')
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
