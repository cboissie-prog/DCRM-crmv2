import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { Plus } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { TodoColumn } from './TodoColumn'

interface TodoBoardProps {
  lists: TodoList[]
  todos: Todo[]
  onMoveTodo: (todoId: string, targetListId: string) => void
  onOpenTodo: (todo: Todo) => void
  onToggleTodo: (todo: Todo) => void
  onQuickAdd: (listId: string, title: string) => void
  onEditList: (list: TodoList) => void
  onDeleteList: (list: TodoList) => void
  onCreateList: () => void
}

/** Tableau horizontal : une colonne par liste, glisser-déposer entre colonnes. */
export function TodoBoard({
  lists, todos, onMoveTodo, onOpenTodo, onToggleTodo, onQuickAdd, onEditList, onDeleteList, onCreateList,
}: TodoBoardProps) {
  const onDragEnd = (result: DropResult) => {
    const { destination, draggableId } = result
    if (!destination) return
    const todo = todos.find(t => t.id === draggableId)
    if (!todo || todo.listId === destination.droppableId) return
    onMoveTodo(todo.id, destination.droppableId)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 items-start">
        {lists.map(list => (
          <TodoColumn
            key={list.id}
            list={list}
            todos={todos.filter(t => t.listId === list.id)}
            onOpenTodo={onOpenTodo}
            onToggleTodo={onToggleTodo}
            onQuickAdd={onQuickAdd}
            onEditList={onEditList}
            onDeleteList={onDeleteList}
          />
        ))}

        <button
          type="button"
          onClick={onCreateList}
          className="w-80 flex-shrink-0 h-20 rounded-2xl border-2 border-dashed border-slate-200 text-sm font-medium text-slate-400 hover:text-primary-600 hover:border-primary-300 hover:bg-white transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Nouvelle liste
        </button>
      </div>
    </DragDropContext>
  )
}
