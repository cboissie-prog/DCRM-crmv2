import { cloneElement, isValidElement, type ReactElement } from 'react'
import { cn } from '../../lib/utils'

interface TooltipProps {
  /** Texte de la bulle. Si vide/absent, les enfants sont rendus sans infobulle. */
  content?: string | null
  children: ReactElement
  className?: string
}

/**
 * Infobulle CSS pure (group / group-hover), sans librairie ni gestion de
 * position en JS. Utilisée pour les valeurs tronquées de la colonne
 * « Informations » du détail ticket.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const hasContent = !!content

  // aria-label porté par l'enfant plutôt que par un `title` natif (qui double l'affichage au survol).
  const child = hasContent && isValidElement(children)
    ? cloneElement(children, { 'aria-label': content } as Record<string, unknown>)
    : children

  if (!hasContent) return child

  return (
    <span className={cn('relative inline-block group min-w-0 max-w-full align-middle', className)}>
      {child}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-xs -translate-x-1/2 whitespace-normal rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 delay-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  )
}
