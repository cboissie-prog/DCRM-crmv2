import { cn, getInitials } from '../../lib/utils'

interface AvatarProps {
  firstName: string
  lastName: string
  src?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { xs: 'w-5 h-5 text-[10px]', sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-12 h-12 text-base' }

const colors = [
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
]

function getColor(name: string) {
  const idx = name.charCodeAt(0) % colors.length
  return colors[idx]
}

export function Avatar({ firstName, lastName, src, size = 'md', className }: AvatarProps) {
  if (src) return <img src={src} alt={`${firstName} ${lastName}`} className={cn('rounded-full object-cover', sizes[size], className)} />
  return (
    <div className={cn('rounded-full flex items-center justify-center font-semibold flex-shrink-0', sizes[size], getColor(firstName), className)}>
      {getInitials(firstName, lastName)}
    </div>
  )
}
