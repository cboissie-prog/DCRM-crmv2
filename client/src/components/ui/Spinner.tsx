import { cn } from '../../lib/utils'

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('animate-spin rounded-full border-2 border-slate-200 border-t-primary-600 w-5 h-5', className)} />
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner className="w-8 h-8" />
    </div>
  )
}
