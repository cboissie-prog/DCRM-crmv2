import { create } from 'zustand'
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
}

interface ToastStore {
  toasts: Toast[]
  add: (toast: Omit<Toast, 'id'>) => void
  remove: (id: string) => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// eslint-disable-next-line react-refresh/only-export-components
export const toast = {
  success: (title: string, message?: string) => useToast.getState().add({ type: 'success', title, message }),
  error: (title: string, message?: string) => useToast.getState().add({ type: 'error', title, message }),
  warning: (title: string, message?: string) => useToast.getState().add({ type: 'warning', title, message }),
  info: (title: string, message?: string) => useToast.getState().add({ type: 'info', title, message }),
}

const icons = {
  success: <CheckCircle className="w-5 h-5 text-emerald-500" />,
  error: <XCircle className="w-5 h-5 text-red-500" />,
  warning: <AlertCircle className="w-5 h-5 text-amber-500" />,
  info: <AlertCircle className="w-5 h-5 text-blue-500" />,
}

const styles = {
  success: 'border-emerald-200 bg-emerald-50',
  error: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  info: 'border-blue-200 bg-blue-50',
}

export function ToastContainer() {
  const { toasts, remove } = useToast()
  return (
    <div className="fixed bottom-4 right-4 z-[1200] flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((t) => (
        <div key={t.id} className={cn('fade-in flex items-start gap-3 p-4 rounded-xl border shadow-lg', styles[t.type])}>
          <div className="mt-0.5 flex-shrink-0">{icons[t.type]}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">{t.title}</p>
            {t.message && <p className="text-xs text-slate-600 mt-0.5">{t.message}</p>}
          </div>
          <button onClick={() => remove(t.id)} className="btn-ghost p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
