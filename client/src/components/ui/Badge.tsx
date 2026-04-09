import { cn } from '../../lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: string
  className?: string
}

export function Badge({ children, variant = 'badge-gray', className }: BadgeProps) {
  return <span className={cn('badge', variant, className)}>{children}</span>
}
