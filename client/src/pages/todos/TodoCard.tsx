import { Draggable } from '@hello-pangea/dnd'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Check, Lock, MessageSquare } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { cn, formatDate } from '../../lib/utils'
import type { Todo } from '../../types'

function dueVariant(dueDate: string, isDone: boolean): string {
  const days = differenceInCalendarDays(parseISO(dueDate), new Date())
  if (!isDone && days < 0) return 'badge-red'
  if (!isDone && days <= 1) return 'badge-orange'
  return 'badge-gray'
}

interface TodoCardProps {
  todo: Todo
  index: number
  onOpen: (todo: Todo) => void
  onToggle: (todo: Todo) => void
}

/** Carte minimaliste : titre + une ligne de méta (échéance, priorité, assigné, commentaires, cadenas). */
export function TodoCard({ todo, index, onOpen, onToggle }: TodoCardProps) {
  const hasPriority = todo.priority === 'HIGH' || todo.priority === 'LOW'
  const hasMeta = !!todo.dueDate || hasPriority || !!todo.assignee || todo.commentCount > 0 || todo.isPrivate

  return (
    <Draggable draggableId={todo.id} index={index} isDragDisabled={!todo.canEdit}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onOpen(todo)}
          className={cn(
            'bg-white rounded-xl border border-slate-200 p-3 cursor-pointer transition-shadow hover:shadow-md',
            todo.isDone && 'opacity-60',
            snapshot.isDragging && 'shadow-2xl rotate-1 ring-2 ring-primary-400',
          )}
        >
          <div className="flex items-start gap-2.5">
            <button
              type="button"
              disabled={!todo.canEdit}
              aria-label={todo.isDone ? 'Marquer comme à faire' : 'Marquer comme terminée'}
              onClick={e => { e.stopPropagation(); onToggle(todo) }}
              className={cn(
                'mt-0.5 flex-shrink-0 w-[18px] h-[18px] rounded-md border-2 flex items-center justify-center transition-colors',
                todo.isDone ? 'bg-primary-600 border-primary-600' : 'border-slate-300 hover:border-primary-400',
                !todo.canEdit && 'cursor-not-allowed opacity-60',
              )}
            >
              {todo.isDone && <Check className="w-3 h-3 text-white" />}
            </button>
            <p className={cn('text-sm font-medium min-w-0 break-words', todo.isDone ? 'line-through text-slate-400' : 'text-slate-800')}>
              {todo.title}
            </p>
          </div>

          {hasMeta && (
            <div className="flex items-center gap-2 flex-wrap mt-2 pl-[28px]">
              {todo.dueDate && <Badge variant={dueVariant(todo.dueDate, todo.isDone)}>{formatDate(todo.dueDate)}</Badge>}
              {todo.priority === 'HIGH' && <Badge variant="badge-red">Haute</Badge>}
              {todo.priority === 'LOW' && <Badge variant="badge-gray">Basse</Badge>}
              {todo.assignee && (
                <span title={`${todo.assignee.firstName} ${todo.assignee.lastName}`}>
                  <Avatar firstName={todo.assignee.firstName} lastName={todo.assignee.lastName} size="xs" />
                </span>
              )}
              {todo.commentCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs text-slate-400">
                  <MessageSquare className="w-3.5 h-3.5" /> {todo.commentCount}
                </span>
              )}
              {todo.isPrivate && (
                <span title="Tâche privée"><Lock className="w-3.5 h-3.5 text-slate-400" /></span>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}
